import type {CookieFormat,CookieOperationResult} from '../../shared/contracts';
import type {CookieService} from './service';
import type {AppLanguage} from '../../shared/settings';
import {nativeMessage} from '../../shared/i18n/messages';

type Filters = Array<{name: string; extensions: string[]}>;
type OpenOptions = {title: string; properties: string[]; filters: Filters};
type SaveOptions = {defaultPath: string; filters: Filters};
type OpenResult = {canceled: boolean; filePaths: string[]};
type SaveResult = {canceled: boolean; filePath?: string};

export function createCookieOperations({
  cookies,
  showOpen,
  showSave,
  language='en',
}: {
  cookies: Pick<CookieService, 'importFile' | 'exportFile' | 'clear'>;
  showOpen: (options: OpenOptions) => Promise<OpenResult>;
  showSave: (options: SaveOptions) => Promise<SaveResult>;
  language?:AppLanguage|(()=>AppLanguage);
}) {
  const currentLanguage=()=>typeof language==='function'?language():language;
  return {
    async importCookies(id: string): Promise<CookieOperationResult | null> {
      const result = await showOpen({
        title: nativeMessage('cookie.import.title',currentLanguage()),
        properties: ['openFile'],
        filters: [{name: nativeMessage('cookie.filter',currentLanguage()), extensions: ['json', 'txt', 'cookies']}],
      });
      const filePath = result.filePaths[0];
      if (result.canceled || !filePath) return null;
      return cookies.importFile(id, filePath);
    },
    async exportCookies(id: string, format: CookieFormat): Promise<CookieOperationResult | null> {
      const extension = format === 'json' ? 'json' : 'txt';
      const result = await showSave({
        defaultPath: `cookies.${extension}`,
          filters: [{name: nativeMessage(format === 'json'?'cookie.export.json':'cookie.export.netscape',currentLanguage()), extensions: [extension]}],
      });
      if (result.canceled || !result.filePath) return null;
      return cookies.exportFile(id, result.filePath, format);
    },
    async clearCookies(id:string):Promise<{cleared:true}|null>{
      return cookies.clear(id);
    },
  };
}
