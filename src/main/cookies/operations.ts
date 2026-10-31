import type {CookieFormat,CookieOperationResult} from '../../shared/contracts';
import type {CookieService} from './service';

type Filters = Array<{name: string; extensions: string[]}>;
type OpenOptions = {title: string; properties: string[]; filters: Filters};
type SaveOptions = {defaultPath: string; filters: Filters};
type OpenResult = {canceled: boolean; filePaths: string[]};
type SaveResult = {canceled: boolean; filePath?: string};

export function createCookieOperations({
  cookies,
  showOpen,
  showSave,
  showClearConfirm,
}: {
  cookies: Pick<CookieService, 'importFile' | 'exportFile' | 'clear'>;
  showOpen: (options: OpenOptions) => Promise<OpenResult>;
  showSave: (options: SaveOptions) => Promise<SaveResult>;
  showClearConfirm?:(id:string)=>Promise<boolean>;
}) {
  return {
    async importCookies(id: string): Promise<CookieOperationResult | null> {
      const result = await showOpen({
        title: 'Import cookies',
        properties: ['openFile'],
        filters: [{name: 'Cookies', extensions: ['json', 'txt', 'cookies']}],
      });
      const filePath = result.filePaths[0];
      if (result.canceled || !filePath) return null;
      return cookies.importFile(id, filePath);
    },
    async exportCookies(id: string, format: CookieFormat): Promise<CookieOperationResult | null> {
      const extension = format === 'json' ? 'json' : 'txt';
      const result = await showSave({
        defaultPath: `cookies.${extension}`,
        filters: [{name: format === 'json' ? 'JSON (Dolphin)' : 'Netscape cookies.txt', extensions: [extension]}],
      });
      if (result.canceled || !result.filePath) return null;
      return cookies.exportFile(id, result.filePath, format);
    },
    async clearCookies(id:string):Promise<{cleared:true}|null>{
      if(!showClearConfirm||!await showClearConfirm(id))return null;
      return cookies.clear(id);
    },
  };
}
