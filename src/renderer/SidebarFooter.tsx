import {AppSettings} from './AppSettings';
import {UpdateButton} from './UpdateButton';
import type {ProfileApi} from '../shared/contracts';

export const PROJECT_URL='https://github.com/thejohnd0e/exodus-browser';

export function SidebarFooter({disabled=false,api}:{disabled?:boolean;api?:ProfileApi}){
  return <footer className="sidebar-footer">
    <AppSettings disabled={disabled}/>
    <span className="footer-divider" aria-hidden="true"/>
    <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.07c-3.1.68-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.61 1.22 3.25.93.1-.73.39-1.22.71-1.5-2.47-.28-5.07-1.24-5.07-5.5 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.14 3.05-1.14.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.27-2.6 5.21-5.08 5.49.4.34.76 1.02.76 2.06v3.05c0 .3.2.64.76.53A11.1 11.1 0 0 0 12 .9Z"/></svg>GitHub</a>
    <UpdateButton disabled={disabled} api={api}/>
  </footer>;
}
