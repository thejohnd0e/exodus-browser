import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { Profile, ProfileInput, ProfileState, SavedProxy } from '../../shared/contracts';
import type { AgentIdentity } from './credentials';
import { AgentApiError } from './errors';
import { DEFAULT_FINGERPRINT, fingerprintSchema } from '../../shared/fingerprint';
import { newFingerprint } from '../../shared/fingerprint-presets';
import type { BrowserController } from './browser/controller';

type ProfileReader = { list(): Promise<Profile[]>; listProxies(): SavedProxy[] };
type ProfileWriter = {
  create(input: ProfileInput): Promise<Profile>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  states(): Record<string, ProfileState>;
  grantProfile(credentialId: string, profileId: string): Promise<void>;
  engineVersion(): Promise<string | null>;
  /** Optional facts about this computer that make a generated fingerprint fit it. */
  hostHints?(): Promise<{ hostGpuVendors?: readonly string[]; hostGpuModels?: readonly string[]; hostScreen?: { width: number; height: number } }>;
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  note: z.string().max(2000).default(''),
  startUrls: z.array(z.string().max(2048)).max(20).default(['about:blank']),
  languages: z.array(z.string().max(35)).min(1).max(1).default(['en-US']),
  proxyId: z.uuid().nullable().default(null),
  fingerprint: fingerprintSchema.optional(),
  fingerprintSeed: z.number().int().min(0).max(0xffffffff).optional(),
}).strict();
const fingerprintSchemaInput = z.object({ os: z.enum(['windows11', 'windows10', 'macos', 'linux']).default('windows11') }).strict();

/** Read and profile lifecycle operations share the manager's services; no second database is opened. */
export class AgentManagement {
  private writer?: ProfileWriter;
  constructor(private profiles: ProfileReader & Partial<ProfileWriter>, writer?: ProfileWriter, private browser?: BrowserController) {
    this.writer = writer ?? (typeof this.profiles.create === 'function' ? this.profiles as ProfileWriter : undefined);
  }

  async dispatch(identity: AgentIdentity, method: string, path: string, body: unknown): Promise<unknown> {
    if (path === '/api/v1/status' && method === 'GET') {
      return { apiVersion: '1', capabilities: this.capabilities() };
    }
    if (path === '/api/v1/proxies' && method === 'GET') {
      return this.profiles.listProxies().filter(proxy => identity.proxyIds.includes(proxy.id)).map(proxy => this.proxyDto(proxy, identity));
    }
    if (path === '/api/v1/profiles') {
      if (method === 'GET') return (await this.authorizedProfiles(identity)).map(profile => this.profileDto(profile, identity));
      if (method === 'POST') return this.createProfile(identity, body);
    }
    if (path === '/api/v1/fingerprints' && method === 'POST') return this.generateFingerprint(body);
    const tabs = /^\/api\/v1\/profiles\/([^/]+)\/tabs(?:\/([^/]+)(?:\/(navigate|snapshot|click|fill|upload|press|screenshot|close))?)?$/.exec(path);
    if (tabs) return this.browserOperation(identity, method, tabs[1]!, tabs[2], tabs[3], body);
    const match = /^\/api\/v1\/profiles\/([^/]+)(?:\/(start|stop))?$/.exec(path);
    if (match) {
      const id = match[1]!;
      if (!match[2]) {
        if (method !== 'GET') throw new AgentApiError(404, 'NOT_FOUND');
        const profile = (await this.authorizedProfiles(identity)).find(entry => entry.id === id);
        if (!profile) throw new AgentApiError(404, 'NOT_FOUND');
        return this.profileDto(profile, identity);
      }
      if (method !== 'POST' || !identity.profileIds.includes(id)) throw new AgentApiError(404, 'NOT_FOUND');
      const writer = this.writer;
      if (!writer) throw new AgentApiError(404, 'NOT_FOUND');
      await (match[2] === 'start' ? writer.start(id) : writer.stop(id));
      return { id, state: writer.states()[id] ?? 'stopped' };
    }
    throw new AgentApiError(404, 'NOT_FOUND');
  }

  private capabilities(): string[] {
    return this.writer
      ? ['profiles.read', 'profiles.create', 'profiles.start', 'profiles.stop', 'fingerprints.generate', 'proxies.read', 'tabs.read', 'page.navigate', 'page.snapshot', 'page.click', 'page.fill', 'page.upload', 'page.press', 'page.screenshot']
      : ['profiles.read', 'proxies.read'];
  }

  private async browserOperation(identity: AgentIdentity, method: string, profileId: string, targetId?: string, action?: string, body?: unknown): Promise<unknown> {
    const controller = this.browser;
    if (!controller || !identity.profileIds.includes(profileId) || !(await this.profiles.list()).some(profile => profile.id === profileId)) throw new AgentApiError(404, 'NOT_FOUND');
    if (!targetId) {
      if (method !== 'GET') throw new AgentApiError(404, 'NOT_FOUND');
      try { return await controller.tabs(profileId); }
      catch (error) { throw this.browserError(error); }
    }
    if (method !== 'POST' || !action) throw new AgentApiError(404, 'NOT_FOUND');
    const input = (body ?? {}) as Record<string, unknown>;
    try {
      if (action === 'navigate') {
        if (typeof input.url !== 'string') throw new AgentApiError(400, 'INVALID_INPUT');
        return await controller.navigate(profileId, targetId, input.url);
      }
      if (action === 'snapshot') return await controller.snapshot(profileId, targetId);
      if (action === 'click') {
        if (typeof input.ref !== 'string') throw new AgentApiError(400, 'INVALID_INPUT');
        await controller.click(profileId, targetId, input.ref);
        return { ok: true };
      }
      if (action === 'fill') {
        if (typeof input.ref !== 'string' || typeof input.text !== 'string') throw new AgentApiError(400, 'INVALID_INPUT');
        await controller.fill(profileId, targetId, input.ref, input.text);
        return { ok: true };
      }
      if (action === 'upload') {
        if (typeof input.ref !== 'string' || !Array.isArray(input.files)) throw new AgentApiError(400, 'INVALID_INPUT');
        await controller.upload(profileId, targetId, input.ref, input.files);
        return { ok: true };
      }
      if (action === 'press') {
        if (typeof input.key !== 'string' || (input.ref !== undefined && typeof input.ref !== 'string')) throw new AgentApiError(400, 'INVALID_INPUT');
        await controller.press(profileId, targetId, input.key, input.ref);
        return { ok: true };
      }
      if (action === 'screenshot') {
        const png = await controller.screenshot(profileId, targetId);
        return { mimeType: 'image/png', dataBase64: png.toString('base64') };
      }
      if (action === 'close') { await controller.closeTab(profileId, targetId); return { ok: true }; }
    } catch (error) {
      throw this.browserError(error);
    }
    throw new AgentApiError(404, 'NOT_FOUND');
  }

  /** Maps controller error codes to stable HTTP statuses for every browser route. */
  private browserError(error: unknown): Error {
    if (error instanceof AgentApiError) return error;
    const code = (error as { code?: string }).code;
    if (code === 'PROFILE_NOT_RUNNING') return new AgentApiError(409, 'PROFILE_NOT_RUNNING');
    if (code === 'TAB_NOT_FOUND') return new AgentApiError(404, 'TAB_NOT_FOUND');
    if (code === 'TIMEOUT') return new AgentApiError(504, 'TIMEOUT');
    if (code === 'CANCELLED') return new AgentApiError(499, 'CANCELLED');
    if (code === 'INVALID_URL') return new AgentApiError(400, 'INVALID_URL');
    if (code === 'INVALID_INPUT') return new AgentApiError(400, 'INVALID_INPUT');
    if (code === 'SELECTOR_NOT_FOUND' || code === 'ELEMENT_NOT_VISIBLE' || code === 'ELEMENT_DISABLED' || code === 'OPTION_NOT_FOUND' || code === 'FILE_INPUT_NOT_FOUND' || code === 'ARTIFACT_TOO_LARGE') return new AgentApiError(409, code);
    if (code === 'CONNECTION_LOST' || code === 'BROWSER_ERROR' || code === 'NAVIGATION_FAILED' || code === 'EVALUATION_FAILED' || code === 'SCREENSHOT_FAILED') return new AgentApiError(502, code);
    return new AgentApiError(500, 'INTERNAL_ERROR');
  }

  private async authorizedProfiles(identity: AgentIdentity): Promise<Profile[]> {
    return (await this.profiles.list()).filter(profile => identity.profileIds.includes(profile.id));
  }

  private async assertProfile(identity: AgentIdentity, id: string): Promise<void> {
    if (!identity.profileIds.includes(id) || !(await this.profiles.list()).some(profile => profile.id === id)) throw new AgentApiError(404, 'NOT_FOUND');
  }

  private async createProfile(identity: AgentIdentity, body: unknown): Promise<Profile> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new AgentApiError(400, 'INVALID_INPUT');
    const writer = this.writer;
    if (!writer) throw new AgentApiError(404, 'NOT_FOUND');
    const input = parsed.data;
    if (input.proxyId && !identity.proxyIds.includes(input.proxyId)) throw new AgentApiError(400, 'INVALID_INPUT');
    const version = await writer.engineVersion();
    const fingerprint = input.fingerprint ?? (version ? newFingerprint({ os: 'windows11', chromeVersion: version, random: () => randomBytes(4).readUInt32BE(0) / 0x100000000, ...(await writer.hostHints?.()) }) : null);
    if (!fingerprint) throw new AgentApiError(409, 'ENGINE_UNAVAILABLE');
    const profile = await writer.create({ ...input, fingerprint, proxyId: input.proxyId });
    await writer.grantProfile(identity.id, profile.id);
    return this.profileDto(profile, { ...identity, profileIds: [...identity.profileIds, profile.id] });
  }

  private async generateFingerprint(body: unknown): Promise<ReturnType<typeof newFingerprint>> {
    const writer = this.writer;
    if (!writer) throw new AgentApiError(404, 'NOT_FOUND');
    const parsed = fingerprintSchemaInput.safeParse(body ?? {});
    if (!parsed.success) throw new AgentApiError(400, 'INVALID_INPUT');
    const version = await writer.engineVersion();
    if (!version) throw new AgentApiError(409, 'ENGINE_UNAVAILABLE');
    return newFingerprint({ os: parsed.data.os, chromeVersion: version, random: () => randomBytes(4).readUInt32BE(0) / 0x100000000, ...(await writer.hostHints?.()) });
  }

  private proxyDto(proxy: SavedProxy, identity: AgentIdentity): SavedProxy {
    return {
      id: proxy.id, name: proxy.name, kind: proxy.kind, host: proxy.host, port: proxy.port,
      ...(proxy.username ? { username: proxy.username } : {}), hasPassword: proxy.hasPassword,
      ...(proxy.requiresPassword ? { requiresPassword: true } : {}), createdAt: proxy.createdAt, updatedAt: proxy.updatedAt,
      profileIds: proxy.profileIds.filter(id => identity.profileIds.includes(id)),
    };
  }

  private profileDto(profile: Profile, identity: AgentIdentity): Profile {
    const proxy = profile.proxy && identity.proxyIds.includes(profile.proxy.id) ? this.proxyDto(profile.proxy, identity) : null;
    return {
      id: profile.id, name: profile.name, note: profile.note, startUrls: [...profile.startUrls], languages: [...profile.languages],
      proxyId: proxy?.id ?? null, proxy, fingerprint: structuredClone(profile.fingerprint ?? DEFAULT_FINGERPRINT), fingerprintSeed: profile.fingerprintSeed,
      restoreLastSession: profile.restoreLastSession, extensionIds: [...profile.extensionIds], createdAt: profile.createdAt, updatedAt: profile.updatedAt,
    };
  }
}
