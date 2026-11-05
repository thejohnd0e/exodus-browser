import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Secrets } from '../security/secrets';
import { AgentApiError } from './errors';

const entrySchema = z.object({
  credentialId: z.string().min(1).max(100), method: z.string().max(10), path: z.string().max(500), key: z.string().min(1).max(128),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/), result: z.unknown(), completedAt: z.number().int().nonnegative(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(500) }).strict();
type Entry = z.infer<typeof entrySchema>;

const MAX_BYTES = 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Durable replay protection for state-changing agent requests. A client retry with the same key and
 * body returns the original result instead of creating a second profile or launching twice.
 * Values are encrypted with the same OS protection as credentials because results can describe profiles.
 */
export class IdempotencyStore {
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = new Map<string, Promise<unknown>>();
  private constructor(private file: string, private secrets: Secrets, private entries: Entry[]) {}

  static async open(root: string, secrets: Secrets): Promise<IdempotencyStore> {
    const file = join(root, 'agent-api-idempotency.bin');
    let entries: Entry[] = [];
    try {
      const info = await lstat(file);
      if (info.isFile() && !info.isSymbolicLink() && info.size <= MAX_BYTES) {
        const parsed = stateSchema.safeParse(JSON.parse(secrets.open(await readFile(file))));
        if (parsed.success) entries = parsed.data.entries;
      }
    } catch { /* missing or unreadable: start without replay protection rather than failing the API */ }
    const store = new IdempotencyStore(file, secrets, entries.filter(entry => Date.now() - entry.completedAt <= TTL_MS));
    return store;
  }

  /** Runs once for a (credential, method, path, key, body) tuple; concurrent duplicates wait for the first. */
  run<T>(credentialId: string, method: string, path: string, key: string, body: unknown, operation: () => Promise<T>, now = Date.now()): Promise<T> {
    const bodyHash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const id = `${credentialId}\u0000${method}\u0000${path}\u0000${key}`;
    const pending = this.inFlight.get(id);
    if (pending) return pending.then(value => value as T);
    const existing = this.entries.find(entry => `${entry.credentialId}\u0000${entry.method}\u0000${entry.path}\u0000${entry.key}` === id);
    if (existing) {
      if (existing.bodyHash !== bodyHash) return Promise.reject(new AgentApiError(409, 'IDEMPOTENCY_CONFLICT'));
      return Promise.resolve(existing.result as T);
    }
    const execution = operation().then(async result => {
      this.entries.push({ credentialId, method, path, key, bodyHash, result, completedAt: now });
      this.entries = this.entries.filter(entry => now - entry.completedAt <= TTL_MS).slice(-500);
      await this.persist().catch(() => undefined);
      return result;
    }).finally(() => { this.inFlight.delete(id); });
    this.inFlight.set(id, execution);
    return execution;
  }

  private persist(): Promise<void> {
    const operation = this.queue.then(async () => {
      const bytes = this.secrets.seal(JSON.stringify({ version: 1, entries: this.entries }));
      if (bytes.length > MAX_BYTES) { this.entries = this.entries.slice(-100); return this.persist(); }
      await mkdir(join(this.file, '..'), { recursive: true });
      const temporary = `${this.file}.partial-${randomUUID()}`;
      try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.file); }
      finally { await rm(temporary, { force: true }); }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
