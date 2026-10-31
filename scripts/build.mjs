import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { withBuildVersion } from './build-version.mjs';
await withBuildVersion({root:process.cwd(),run:async info=>{
 const define={__BUILD_INFO__:JSON.stringify(info)};
 await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], sourcemap: true, loader: { '.png': 'file' }, assetNames: 'assets/[name]', define });
 await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define });
 await viteBuild({define});
}});
