import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

const schema = z.object({ version: z.literal(1), enabled: z.boolean(), port: z.number().int().min(1).max(65535).optional() }).strict();
export type AgentApiSettings = z.infer<typeof schema>;

/**
 * Separate from settings.json so corrupt agent state cannot reset the manager language.
 * An optional feature must never prevent the manager from starting, so unreadable or
 * invalid state is treated as "disabled" instead of throwing.
 */
export class AgentApiSettingsStore {
  private state: AgentApiSettings = { version: 1, enabled: false };
  private constructor(private file: string, private marker: string) {}
  static async open(root: string): Promise<AgentApiSettingsStore> {
    const store = new AgentApiSettingsStore(join(root, 'agent-api-settings.json'), join(root, 'agent-api-disabled.marker'));
    try {
      const info = await lstat(store.file);
      if (info.isSymbolicLink() || !info.isFile() || info.size > 4096) return store;
      const parsed = schema.safeParse(JSON.parse(await readFile(store.file, 'utf8')));
      if (parsed.success) store.state = parsed.data;
    } catch { /* missing, unreadable or corrupt: stay disabled */ }
    return store;
  }
  get(): AgentApiSettings { return { ...this.state }; }
  /** Persists the enabled flag and keeps the remembered port. */
  async set(enabled: boolean): Promise<AgentApiSettings> {
    return this.write(schema.parse({ version: 1, enabled, ...(this.state.port ? { port: this.state.port } : {}) }));
  }
  /** The loopback port is remembered so MCP client configs survive restarts. */
  async setPort(port: number): Promise<AgentApiSettings> {
    return this.write(schema.parse({ ...this.state, port }));
  }
  private async write(next: AgentApiSettings): Promise<AgentApiSettings> {
    await mkdir(join(this.file, '..'), { recursive: true });
    const temporary = `${this.file}.partial-${randomUUID()}`;
    try { await writeFile(temporary, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, this.file); }
    finally { await rm(temporary, { force: true }); }
    this.state = next;
    return this.get();
  }

  /**
   * A disable that cannot be persisted must not resurrect on the next launch. The marker is
   * written first and cleared only after the settings write succeeds.
   */
  async markDisablePending(): Promise<void> {
    await mkdir(join(this.marker, '..'), { recursive: true });
    await writeFile(this.marker, '1', { flag: 'w', mode: 0o600 });
  }
  async clearDisablePending(): Promise<void> { await rm(this.marker, { force: true }); }
  async disablePending(): Promise<boolean> {
    try { return (await lstat(this.marker)).isFile(); } catch { return false; }
  }
}
