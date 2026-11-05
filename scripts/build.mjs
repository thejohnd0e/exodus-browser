import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { resolveBuildInfo, withBuildVersion } from './build-version.mjs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const packageVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
await withBuildVersion({root:process.cwd(),run:async counterInfo=>{
  const info = resolveBuildInfo({counterInfo, packageVersion, release: process.env.EXODUS_RELEASE === '1'});
 const define={__BUILD_INFO__:JSON.stringify(info)};
 await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'better-sqlite3'], sourcemap: true, loader: { '.png': 'file' }, assetNames: 'assets/[name]', define });
 await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define });
  await viteBuild({define});
  const resources=join(process.cwd(),'dist','resources');
  await mkdir(join(resources,'geoip'),{recursive:true});
  await copyFile('resources/geoip/dbip-country-lite.mmdb',join(resources,'geoip','dbip-country-lite.mmdb'));
}});
