// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {I18nProvider,useI18n,translate} from '../../src/renderer/i18n/provider';

it('uses English fallback for missing catalog entries and substitutes parameters',()=>{
 expect(translate('ru','language.label')).toBe('Interface language');
 expect(translate('ru','settings.saved',{language:'Russian'})).toBe('Settings saved: Russian');
 expect(translate('en','missing.key')).toBe('missing.key');
});

it('exposes the selected language and translator through its provider',()=>{
 const setLanguage=vi.fn();
 function Probe(){const {language,t}=useI18n();return <p>{language}:{t('language.label')}</p>;}
 render(<I18nProvider language="ru" onLanguageChange={setLanguage}><Probe/></I18nProvider>);
 expect(screen.getByText('ru:Interface language')).toBeTruthy();
});
