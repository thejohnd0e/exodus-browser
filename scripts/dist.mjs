import { spawnSync } from 'node:child_process';

const env = { ...process.env, EXODUS_RELEASE: '1' };
for (const command of [['node', ['scripts/build.mjs']], ['npx', ['electron-builder', '--win', 'nsis']]]) {
  const result = spawnSync(command[0], command[1], { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
