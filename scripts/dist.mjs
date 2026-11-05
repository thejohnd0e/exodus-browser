import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPackagedApp } from './check-artifacts.mjs';

const env = { ...process.env, EXODUS_RELEASE: '1' };
for (const command of [['node', ['scripts/build.mjs']], ['npx', ['electron-builder', '--win', 'nsis']]]) {
  const result = spawnSync(command[0], command[1], { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const unpacked = join('dist-install', 'win-unpacked');
const errors = checkPackagedApp({
  asarPath: join(unpacked, 'resources', 'app.asar'),
  expectedVersion: version,
  nativeModulePath: join(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node'),
});
if (errors.length > 0) {
  console.error('Packaged application failed verification:');
  for (const error of errors) console.error(' - ' + error);
  process.exit(1);
}
console.log(`Packaged application verified: version ${version}, app.asar intact.`);
