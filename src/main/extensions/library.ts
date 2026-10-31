import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {cp,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectFolder,inspectZip,assertNoLinks} from './package';
import {parseStoreLink,readCrxZip,resolveExtensionName,storeDownloadUrl} from './store';
import type {ExtensionSource,ExtensionSummary} from '../../shared/extension';
// ExtensionSummary is used by StagedEntry below.

export type ExtensionEntry = {id: string; name: string; version: string; source: ExtensionSource; storeId?: string; addedAt: string; updatedAt: string};
export type ExtensionDownload = (url: string, destination: string) => Promise<void>;

const MAX_PACKAGE_BYTES=100*1024*1024;

type StagedEntry = {summary: ExtensionSummary; source: ExtensionSource; storeId?: string};

export class ExtensionLibrary {
  private download?: ExtensionDownload;
  private engineVersion: string;
  constructor(private root: string, private db: Database.Database, download?: ExtensionDownload, engineVersion='156.0.8078.80') {
    this.download=download;this.engineVersion=engineVersion;
  }

  private get extensionsRoot() {return join(this.root, 'extensions');}
  directoryFor(id: string) {return join(this.extensionsRoot, id);}

  list(): ExtensionEntry[] {
    return (this.db.prepare('SELECT id,data FROM extensions ORDER BY rowid').all() as {id: string; data: string}[])
      .map(row => ({source:'folder' as ExtensionSource, ...JSON.parse(row.data), id: row.id}));
  }

  exists(id: string) {return !!this.db.prepare('SELECT 1 FROM extensions WHERE id=?').get(id);}

  async addFromFolder(source: string): Promise<ExtensionEntry> {
    return this.stage(async staging => {
      await assertNoLinks(source);await cp(source, staging, {recursive: true});
      return {summary: await inspectFolder(staging), source: 'folder' as const};
    }, null);
  }

  async addFromZip(file: string): Promise<ExtensionEntry> {
    return this.stage(async staging => ({summary: await inspectZip(file, staging), source: 'zip' as const}), null);
  }

  async addFromStore(link: string, engineVersion=this.engineVersion): Promise<ExtensionEntry> {
    const {id: storeId}=parseStoreLink(link);
    if(this.list().some(entry=>entry.storeId===storeId))throw Error('EXTENSION_ALREADY_IN_LIBRARY');
    return this.installFromStore(storeId, engineVersion, null);
  }

  async updateFromFolder(id: string, source: string): Promise<ExtensionEntry> {
    return this.stage(async staging => {
      await assertNoLinks(source);await cp(source, staging, {recursive: true});
      return {summary: await inspectFolder(staging), source: 'folder' as const};
    }, id);
  }

  async updateFromZip(id: string, file: string): Promise<ExtensionEntry> {
    return this.stage(async staging => ({summary: await inspectZip(file, staging), source: 'zip' as const}), id);
  }

  async updateFromStore(id: string, engineVersion=this.engineVersion): Promise<ExtensionEntry> {
    const entry=this.list().find(item=>item.id===id);
    if(!entry)throw Error('EXTENSION_NOT_FOUND');
    if(!entry.storeId)throw Error('EXTENSION_NOT_FOUND');
    return this.installFromStore(entry.storeId, engineVersion, id);
  }

  async remove(id: string): Promise<void> {
    if (!this.exists(id)) throw Error('EXTENSION_NOT_FOUND');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM extensions WHERE id=?').run(id);
      const rows = this.db.prepare('SELECT id,data FROM profiles').all() as {id: string; data: string}[];
      for (const row of rows) {
        const data = JSON.parse(row.data);
        if (Array.isArray(data.extensionIds) && data.extensionIds.includes(id)) {
          const next = {...data, extensionIds: data.extensionIds.filter((item: string) => item !== id)};
          this.db.prepare('UPDATE profiles SET data=? WHERE id=?').run(JSON.stringify(next), row.id);
        }
      }
    })();
    await rm(this.directoryFor(id), {recursive: true, force: true});
  }

  private async installFromStore(storeId: string, engineVersion: string, existingId: string|null): Promise<ExtensionEntry> {
    if(!this.download)throw Error('EXTENSION_DOWNLOAD_FAILED');
    await mkdir(this.extensionsRoot, {recursive: true});
    const crxFile=join(this.extensionsRoot, '.crx-' + randomUUID());
    try {
      await this.download(storeDownloadUrl(storeId, engineVersion), crxFile);
      const payload=await readFile(crxFile);
      if(payload.byteLength>MAX_PACKAGE_BYTES)throw Error('EXTENSION_TOO_LARGE');
      const zip=readCrxZip(payload);
      return await this.stage(async staging => {
        const zipFile=staging + '.zip';
        try {
          await writeFile(zipFile, zip, {flag: 'wx'});
          const summary=await inspectZip(zipFile, staging);
          return {summary:{...summary, name:await resolveExtensionName(summary.name, staging)}, source:'store' as const, storeId};
        } finally {
          await rm(zipFile, {force: true});
        }
      }, existingId);
    } finally {
      await rm(crxFile, {force: true});
    }
  }

  private async stage(inspect: (staging: string) => Promise<StagedEntry>, id: string | null): Promise<ExtensionEntry> {
    await mkdir(this.extensionsRoot, {recursive: true});
    const staging = join(this.extensionsRoot, '.staging-' + randomUUID());
    try {
      const staged = await inspect(staging);
      const now = new Date().toISOString();
      if (id === null) {
        const entryId = randomUUID();
        await rename(staging, this.directoryFor(entryId));
        try {
          const entry = {name: staged.summary.name, version: staged.summary.version, source: staged.source, ...(staged.storeId?{storeId: staged.storeId}:{}), addedAt: now, updatedAt: now};
          this.db.prepare('INSERT INTO extensions VALUES(?,?)').run(entryId, JSON.stringify(entry));
          return {id: entryId, ...entry};
        } catch (error) {
          await rm(this.directoryFor(entryId), {recursive: true, force: true});
          throw error;
        }
      }
      const existing = this.list().find(item => item.id === id);
      if (!existing) throw Error('EXTENSION_NOT_FOUND');
      const previous = join(this.extensionsRoot, '.previous-' + randomUUID());
      await rename(this.directoryFor(id), previous);
      try {
        await rename(staging, this.directoryFor(id));
      } catch (error) {
        await rename(previous, this.directoryFor(id));
        throw error;
      }
      const entry = {name: staged.summary.name, version: staged.summary.version, source: staged.source, ...(staged.storeId?{storeId: staged.storeId}:{}), addedAt: existing.addedAt, updatedAt: now};
      this.db.prepare('UPDATE extensions SET data=? WHERE id=?').run(JSON.stringify(entry), id);
      await rm(previous, {recursive: true, force: true});
      return {id, ...entry};
    } finally {
      await rm(staging, {recursive: true, force: true});
    }
  }
}
