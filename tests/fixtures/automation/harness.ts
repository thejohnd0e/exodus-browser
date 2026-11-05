import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ChromiumAdapter } from '../../../src/main/engines/chromium';
import { CdpClient } from '../../../src/main/cdp/client';
import type { Fingerprint } from '../../../src/shared/fingerprint';
import type { SessionSnapshot } from '../../../src/shared/session';
import type { EngineProcess } from '../../../src/main/engines/types';

export type ManagedHarness = {
  client: CdpClient;
  process: EngineProcess;
  snapshots: SessionSnapshot[];
  close(): Promise<void>;
};

export async function cleanupManagedProcess(process_: { stop(): Promise<void>; exit: Promise<unknown> }, remove: () => Promise<void>, timeoutMs: number): Promise<void> {
  await process_.stop();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([process_.exit, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('EXIT_TIMEOUT')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
  await remove();
}

// Preferred scratch area for this environment; falls back to the system temp directory.
function spikeTempRoot(): string {
  const preferred = join(process.env.TEMP ?? tmpdir(), 'opencode');
  return existsSync(preferred) ? preferred : tmpdir();
}

export async function launchManagedHarness(options: {
  executable: string;
  profileId: string;
  fingerprint: Fingerprint;
  seed: number;
  startUrls: string[];
}): Promise<ManagedHarness> {
  const root = mkdtempSync(join(spikeTempRoot(), 'agent-spike-'));
  const userDataDir = join(root, randomUUID());
  const snapshots: SessionSnapshot[] = [];
  let client: CdpClient | null = null;
  const engine = new ChromiumAdapter(options.executable, (inStream, outStream) => {
    if (client) throw Error('only one CdpClient per harness is allowed');
    client = CdpClient.fromPipe(inStream, outStream);
    if (process.env.AGENT_SPIKE_DIAGNOSTICS === '1') {
      outStream.once('end', () => console.log('SPIKE pipe ended'));
      client.onEvent(message => {
        if (message.method === 'Target.attachedToTarget' || message.method === 'Target.detachedFromTarget') {
          const params = message.params as { sessionId?: string; targetInfo?: { targetId: string; type: string; url?: string } };
          console.log('SPIKE', message.method, 'outer', message.sessionId ?? 'root', 'inner', params?.sessionId, params?.targetInfo ? `${params.targetInfo.type}:${params.targetInfo.targetId}:${params.targetInfo.url ?? ''}` : '');
        }
      });
      const send = client.send.bind(client);
      client.send = async <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs?: number): Promise<T> => {
        if (method === 'Target.closeTarget' || method === 'Browser.close') console.log('SPIKE close caller', method, new Error().stack?.split('\n').slice(2, 5).join('\n'));
        try { return await send<T>(method, params, sessionId, timeoutMs); }
        catch (error) { console.log('SPIKE command failed', method, error instanceof Error ? error.message : 'unknown'); throw error; }
      };
    }
    return client;
  });
  let proc: EngineProcess;
  try {
    proc = await engine.launch({
      profileId: options.profileId,
      userDataDir,
      languages: ['en-US'],
      startUrls: options.startUrls,
      fingerprint: options.fingerprint,
      fingerprintSeed: options.seed,
      onSessionSnapshot: async snapshot => { snapshots.push(snapshot); },
    });
  } catch (error) {
    // A failed launch does not prove the spawned browser has exited. Preserve its data.
    throw error;
  }
  const process_ = proc;
  if (process.env.AGENT_SPIKE_DIAGNOSTICS === '1') void process_.exit.then(result => console.log('SPIKE process exited', result.code, result.signal));
  return {
    client: client!,
    process: process_,
    snapshots,
    close: async () => {
      try { await cleanupManagedProcess(process_, () => rm(root, { recursive: true, force: true }), 20000); }
      catch (error) { throw Error(`harness cleanup failed; temporary root retained at ${root}`, { cause: error }); }
    },
  };
}
