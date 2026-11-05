import { spawnSync } from 'node:child_process';
for (const args of [['node_modules/typescript/bin/tsc','--noEmit'], ['node_modules/vitest/vitest.mjs','run','tests/unit'], ['scripts/build.mjs']]) {
  const r = spawnSync(process.execPath,args,{stdio:'inherit'});
  if (r.status !== 0) process.exit(r.status ?? 1);
}
