import {it,expect} from 'vitest';
import {buildSync} from 'esbuild';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import electronPath from 'electron';

const SUMS_URL = 'https://github.com/thejohnd0e/exodus-browser/releases/download/v1.1.81/SHA256SUMS';

it('reports a GitHub redirect as a response inside Electron instead of failing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'exodus-netfetch-'));
  const verbose = process.env.EXODUS_NETFETCH_VERBOSE === '1';
  try {
    const shim = join(dir, 'net-fetch.cjs');
    buildSync({entryPoints: ['src/main/update/net-fetch.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: shim});
    const out = join(dir, 'result.json');
    const runner = join(dir, 'runner.cjs');
    writeFileSync(runner, `
const {app, net} = require('electron');
const fs = require('node:fs');
const {createNetFetch} = require(${JSON.stringify(shim)});
const write = (value) => fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(value));
app.whenReady().then(async () => {
  const fetchImpl = createNetFetch(net);
  try {
    const first = await fetchImpl(${JSON.stringify(SUMS_URL)}, {signal: AbortSignal.timeout(30000), redirect: 'manual'});
    const location = first.headers.get('location');
    if (!location) { write({error: 'no location header', status: first.status}); app.quit(); return; }
    const second = await fetchImpl(location, {signal: AbortSignal.timeout(30000), redirect: 'manual'});
    const body = await second.text();
    write({firstStatus: first.status, secondStatus: second.status, body: body.trim()});
  } catch (error) {
    write({error: String(error && error.message)});
  }
  app.quit();
});
`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(electronPath as unknown as string, [runner], {stdio: verbose ? 'inherit' : 'ignore'});
      const timer = setTimeout(() => { child.kill(); reject(new Error('electron probe timed out')); }, 90000);
      child.on('exit', () => { clearTimeout(timer); resolve(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(existsSync(out)).toBe(true);
    const result = JSON.parse(readFileSync(out, 'utf8'));
    expect(result.error).toBeUndefined();
    expect(result.firstStatus).toBe(302);
    expect(result.secondStatus).toBe(200);
    expect(result.body).toMatch(/^[0-9a-f]{64}\s+ExodusBrowser-Setup-1\.1\.81\.exe$/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}, 120000);
