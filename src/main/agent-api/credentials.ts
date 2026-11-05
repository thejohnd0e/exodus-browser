import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Secrets } from '../security/secrets';

const credentialSchema = z.object({
  id: z.uuid(), label: z.string().trim().min(1).max(100), digest: z.string().regex(/^[a-f0-9]{64}$/),
  revoked: z.boolean(), profileIds: z.array(z.uuid()).max(10000), proxyIds: z.array(z.uuid()).max(10000),
}).strict();
const stateSchema = z.object({ version: z.literal(1), credentials: z.array(credentialSchema).max(100) }).strict();
type State = z.infer<typeof stateSchema>;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
export type AgentIdentity = { id: string; label: string; profileIds: string[]; proxyIds: string[] };

/** Manager-only provisioning. Tokens are returned once, never persisted in plaintext. */
export class CredentialAuthority {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private file: string, private secrets: Secrets, private state: State) {}

  static async open(root: string, secrets: Secrets): Promise<CredentialAuthority> {
    const file = join(root, 'agent-api-credentials.bin');
    let state: State = { version: 1, credentials: [] };
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STORAGE_BYTES) throw Error('AGENT_API_STORAGE_INVALID');
      state = stateSchema.parse(JSON.parse(secrets.open(await readFile(file))));
      if (new Set(state.credentials.map(c => c.id)).size !== state.credentials.length) throw Error('AGENT_API_STORAGE_INVALID');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new CredentialAuthority(file, secrets, state);
      // Stable public code: the underlying parser or cipher message must not leak details.
      throw Error('AGENT_API_STORAGE_INVALID');
    }
    return new CredentialAuthority(file, secrets, state);
  }

  list(): Array<{ id: string; label: string; revoked: boolean; profileIds: string[]; proxyIds: string[] }> {
    return this.state.credentials.map(({ id, label, revoked, profileIds, proxyIds }) => ({ id, label, revoked, profileIds: [...profileIds], proxyIds: [...proxyIds] }));
  }

  authenticate(token: string): AgentIdentity | null {
    if (!/^exa_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const digest = createHash('sha256').update(token).digest();
    const credential = this.state.credentials.find(c => !c.revoked && timingSafeEqual(Buffer.from(c.digest, 'hex'), digest));
    if (!credential) return null;
    const { id, label, profileIds, proxyIds } = credential;
    return { id, label, profileIds: [...profileIds], proxyIds: [...proxyIds] };
  }

  create(label: string): Promise<{ id: string; token: string }> {
    const checkedLabel = credentialSchema.shape.label.parse(label);
    return this.mutate(state => {
      const id = randomUUID(); const token = 'exa_' + randomBytes(32).toString('base64url');
      state.credentials.push({ id, label: checkedLabel, digest: createHash('sha256').update(token).digest('hex'), revoked: false, profileIds: [], proxyIds: [] });
      return { id, token };
    });
  }

  revoke(id: string): Promise<void> {
    return this.mutate(state => { this.find(state, id).revoked = true; });
  }

  grant(id: string, kind: 'profile' | 'proxy', resourceId: string): Promise<void> {
    const checked = z.uuid().parse(resourceId);
    return this.mutate(state => {
      const credential = this.find(state, id);
      if (credential.revoked) throw Error('AGENT_CREDENTIAL_REVOKED');
      const grants = kind === 'profile' ? credential.profileIds : credential.proxyIds;
      if (!grants.includes(checked)) grants.push(checked);
    });
  }

  revokeGrant(id: string, kind: 'profile' | 'proxy', resourceId: string): Promise<void> {
    const checked = z.uuid().parse(resourceId);
    return this.mutate(state => {
      const credential = this.find(state, id);
      if (credential.revoked) throw Error('AGENT_CREDENTIAL_REVOKED');
      const field = kind === 'profile' ? 'profileIds' : 'proxyIds';
      credential[field] = credential[field].filter(granted => granted !== checked);
    });
  }

  private find(state: State, id: string) {
    const credential = state.credentials.find(c => c.id === id);
    if (!credential) throw Error('AGENT_CREDENTIAL_NOT_FOUND');
    return credential;
  }

  private mutate<T>(change: (state: State) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const result = change(next);
      stateSchema.parse(next);
      const bytes = this.secrets.seal(JSON.stringify(next));
      if (bytes.length > MAX_STORAGE_BYTES) throw Error('AGENT_API_STORAGE_TOO_LARGE');
      const partial = this.file + '.partial-' + randomUUID();
      try {
        await writeFile(partial, bytes, { flag: 'wx', mode: 0o600 });
        await rename(partial, this.file);
        this.state = next;
        return result;
      } finally { await rm(partial, { force: true }); }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
