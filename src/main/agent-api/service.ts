import type { Profile, ProfileInput, ProfileState, SavedProxy } from '../../shared/contracts';
import type { AgentApiStatus } from '../../shared/agent-api';
import type { EngineBrowser } from '../engines/types';
import type { Secrets } from '../security/secrets';
import { CredentialAuthority, type AgentIdentity } from './credentials';
import { AgentManagement } from './management';
import { BrowserController } from './browser/controller';
import { startAgentHttp, type AgentHttp } from './http';
import { AgentApiSettingsStore } from './settings';
import { IdempotencyStore } from './idempotency';

type Reader = { list(): Promise<Profile[]>; listProxies(): SavedProxy[] };
type Writer = {
  create(input: ProfileInput): Promise<Profile>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  states(): Record<string, ProfileState>;
  engineVersion(): Promise<string | null>;
  browser(id: string): EngineBrowser | null;
};

/**
 * Manager-owned facade: credentials, enablement and the loopback listener share one lifetime.
 * Nothing listens until `enable()` and everything closes on `disable()`/`close()`.
 * Toggle operations are serialized so a double click or an in-flight enable cannot leave a
 * listener alive after the user disabled the API.
 */
export class AgentApiService {
  private http: AgentHttp | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private authority: CredentialAuthority | null,
    private authorityError: Error | null,
    private settings: AgentApiSettingsStore,
    private management: AgentManagement,
    private idempotency: IdempotencyStore | null,
  ) {}

  static async open(options: { root: string; secrets: Secrets; profiles: Reader; writer?: Writer }): Promise<AgentApiService> {
    const settings = await AgentApiSettingsStore.open(options.root);
    let authority: CredentialAuthority | null = null;
    let authorityError: Error | null = null;
    try { authority = await CredentialAuthority.open(options.root, options.secrets); }
    catch (error) { authorityError = error instanceof Error ? error : Error('AGENT_API_STORAGE_INVALID'); }
    const writer = options.writer && authority ? {
      ...options.writer,
      grantProfile: (credentialId: string, profileId: string) => authority!.grant(credentialId, 'profile', profileId),
    } : undefined;
    const management = new AgentManagement(options.profiles, writer, options.writer ? new BrowserController(id => options.writer!.browser(id)) : undefined);
    return new AgentApiService(authority, authorityError, settings, management, writer ? await IdempotencyStore.open(options.root, options.secrets) : null);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private requireAuthority(): CredentialAuthority {
    if (!this.authority) throw this.authorityError ?? Error('AGENT_API_STORAGE_INVALID');
    return this.authority;
  }

  private async dispatch(identity: AgentIdentity, method: string, path: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    const replayable = path === '/api/v1/profiles' || /\/(start|stop)$/.test(path);
    if (method !== 'POST' || !idempotencyKey || !this.idempotency || !replayable) return this.management.dispatch(identity, method, path, body);
    return this.idempotency.run(identity.id, method, path, idempotencyKey, body, () => this.management.dispatch(identity, method, path, body));
  }

  status(): AgentApiStatus {
    return { enabled: this.http !== null, origin: this.http?.origin ?? null, credentials: this.authority?.list() ?? [] };
  }

  /** Startup: restore the manager's last explicit choice. A failed start stays disabled. */
  async resume(): Promise<void> {
    await this.serial(async () => {
      if (await this.settings.disablePending()) {
        await this.settings.set(false).catch(() => undefined);
        await this.settings.clearDisablePending().catch(() => undefined);
        return;
      }
      if (!this.settings.get().enabled || !this.authority) return;
      await this.enableLocked().catch(() => this.settings.set(false).catch(() => undefined));
    });
  }

  async enable(): Promise<{ origin: string }> {
    return this.serial(() => this.enableLocked());
  }

  private async enableLocked(): Promise<{ origin: string }> {
    this.requireAuthority();
    if (this.http) return { origin: this.http.origin };
    const http = await startAgentHttp({
      authenticate: token => this.authority?.authenticate(token) ?? null,
      dispatch: (identity: AgentIdentity, method, path, body, idempotencyKey) => this.dispatch(identity, method, path, body, idempotencyKey),
    });
    try {
      await this.settings.set(true);
      await this.settings.clearDisablePending();
    } catch (error) {
      await http.close().catch(() => undefined);
      throw error;
    }
    this.http = http;
    return { origin: http.origin };
  }

  async disable(): Promise<void> {
    return this.serial(async () => {
      await this.settings.markDisablePending().catch(() => undefined);
      let failure: unknown = null;
      try { await this.settings.set(false); } catch (error) { failure = error; }
      await this.closeListener();
      if (failure) throw failure;
      await this.settings.clearDisablePending().catch(() => undefined);
    });
  }

  /** Shutdown: stop listening without changing the manager's saved preference. */
  async close(): Promise<void> {
    return this.serial(() => this.closeListener());
  }

  private async closeListener(): Promise<void> {
    const http = this.http; this.http = null;
    await http?.close();
  }

  createCredential(label: string): Promise<{ id: string; token: string }> { return this.serial(async () => this.requireAuthority().create(label)); }
  revoke(id: string): Promise<void> { return this.serial(async () => this.requireAuthority().revoke(id)); }
  grant(kind: 'profile' | 'proxy', credentialId: string, resourceId: string): Promise<void> {
    return this.serial(async () => this.requireAuthority().grant(credentialId, kind, resourceId));
  }
  revokeGrant(kind: 'profile' | 'proxy', credentialId: string, resourceId: string): Promise<void> {
    return this.serial(async () => this.requireAuthority().revokeGrant(credentialId, kind, resourceId));
  }
}
