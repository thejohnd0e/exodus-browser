import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], sourcemap: true });
await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await viteBuild();
