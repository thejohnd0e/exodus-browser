import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {cp,mkdir,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectFolder,inspectZip,assertNoLinks} from './package';
import type {ExtensionSummary} from '../../shared/extension';

export type ExtensionEntry = {id: string; name: string; version: string; addedAt: string; updatedAt: string};

export class ExtensionLibrary {
  constructor(private root: string, private db: Database.Database) {}

  private get extensionsRoot() {return join(this.root, 'extensions');}
  directoryFor(id: string) {return join(this.extensionsRoot, id);}

  list(): ExtensionEntry[] {
    return (this.db.prepare('SELECT id,data FROM extensions ORDER BY rowid').all() as {id: string; data: string}[])
      .map(row => ({id: row.id, ...JSON.parse(row.data)}));
  }

  exists(id: string) {
    return !!this.db.prepare('SELECT 1 FROM extensions WHERE id=?').get(id);
  }

  async addFromFolder(source: string): Promise<ExtensionEntry> {
    return this.stage(async staging => {
      await assertNoLinks(source);
      await cp(source, staging, {recursive: true});
      return inspectFolder(staging);
    }, null);
  }

  async addFromZip(file: string): Promise<ExtensionEntry> {
    return this.stage(staging => inspectZip(file, staging), null);
  }

  async updateFromFolder(id: string, source: string): Promise<ExtensionEntry> {
    return this.stage(async staging => {
      await assertNoLinks(source);
      await cp(source, staging, {recursive: true});
      return inspectFolder(staging);
    }, id);
  }

  async updateFromZip(id: string, file: string): Promise<ExtensionEntry> {
    return this.stage(staging => inspectZip(file, staging), id);
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

  private async stage(inspect: (staging: string) => Promise<ExtensionSummary>, id: string | null): Promise<ExtensionEntry> {
    await mkdir(this.extensionsRoot, {recursive: true});
    const staging = join(this.extensionsRoot, '.staging-' + randomUUID());
    try {
      const summary = await inspect(staging);
      const now = new Date().toISOString();
      if (id === null) {
        const entryId = randomUUID();
        await rename(staging, this.directoryFor(entryId));
        try {
          const entry = {name: summary.name, version: summary.version, addedAt: now, updatedAt: now};
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
      const entry = {name: summary.name, version: summary.version, addedAt: existing.addedAt, updatedAt: now};
      this.db.prepare('UPDATE extensions SET data=? WHERE id=?').run(JSON.stringify(entry), id);
      await rm(previous, {recursive: true, force: true});
      return {id, ...entry};
    } finally {
      await rm(staging, {recursive: true, force: true});
    }
  }
}
