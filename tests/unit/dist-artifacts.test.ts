import {describe, expect, it} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {checkPackagedApp} from '../../scripts/check-artifacts.mjs';

type AsarNode = { files: Record<string, AsarNode | { size: number; offset: string }> };

function writeAsar(path: string, entries: Record<string, string>) {
  const root: AsarNode = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const parts = name.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const next = node.files[part];
      if (!next || !('files' in next)) node.files[part] = { files: {} };
      node = node.files[part] as AsarNode;
    }
    node.files[parts[parts.length - 1]] = { size: data.length, offset: String(offset) };
    chunks.push(data);
    offset += data.length;
  }
  const header = Buffer.from(JSON.stringify(root));
  const padded = Buffer.alloc(Math.ceil(header.length / 4) * 4, 0x20);
  header.copy(padded);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(header.length, 12);
  writeFileSync(path, Buffer.concat([prefix, padded, ...chunks, Buffer.from(createHash('sha256').update(header).digest())]));
}

const valid = {
  'package.json': JSON.stringify({name: 'exodus-browser', version: '1.1.78', main: 'dist/main.cjs'}),
  'dist/main.cjs': 'main',
  'dist/preload.cjs': 'preload',
  'dist/ui/index.html': '<html></html>',
  'dist/resources/geoip/dbip-country-lite.mmdb': 'mmdb',
  'node_modules/better-sqlite3/package.json': '{}',
};

function run(entries: Record<string, string>, expectedVersion = '1.1.78') {
  const dir = mkdtempSync(join(tmpdir(), 'exodus-artifacts-'));
  const path = join(dir, 'app.asar');
  writeAsar(path, entries);
  return checkPackagedApp({asarPath: path, expectedVersion});
}

describe('packaged application verification', () => {
  it('accepts a complete package', () => {
    expect(run(valid)).toEqual([]);
  });
  it('rejects a corrupted package.json, which makes the application fail to start', () => {
    const errors = run({...valid, 'package.json': 's-icon.png"><title>Exodus Browser</title>'});
    expect(errors.join(' ')).toContain('not valid JSON');
  });
  it('rejects a wrong main entry or version', () => {
    expect(run({...valid, 'package.json': JSON.stringify({main: 'dist/other.cjs', version: '1.1.78'})}).join(' ')).toContain('main is dist/other.cjs');
    expect(run({...valid, 'package.json': JSON.stringify({main: 'dist/main.cjs', version: '1.1.77'})}).join(' ')).toContain('expected 1.1.78');
  });
  it('rejects a package that lost required runtime files', () => {
    const errors = run({...valid, 'dist/ui/index.html': ''});
    expect(errors.join(' ')).toContain('dist/ui/index.html');
  });
  it('rejects a package without the native sqlite module', () => {
    const {['node_modules/better-sqlite3/package.json']: _removed, ...rest} = valid;
    expect(run(rest).join(' ')).toContain('better-sqlite3');
  });
});
