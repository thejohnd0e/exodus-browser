// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {I18nProvider,useI18n,translate} from '../../src/renderer/i18n/provider';
import {ru} from '../../src/shared/i18n/ru';

it('uses English fallback for missing catalog entries and substitutes parameters',()=>{
 expect(translate('ru','language.label')).toBe(ru['language.label']);
 expect(translate('ru','settings.saved',{language:ru['language.ru']})).toBe(ru['settings.saved'].replace('{{language}}',ru['language.ru']));
 expect(translate('en','missing.key')).toBe('missing.key');
});

it('exposes the selected language and translator through its provider',()=>{
 const setLanguage=vi.fn();
 function Probe(){const {language,t}=useI18n();return <p>{language}:{t('language.label')}</p>;}
 render(<I18nProvider language="ru" onLanguageChange={setLanguage}><Probe/></I18nProvider>);
  expect(screen.getByText(`ru:${ru['language.label']}`)).toBeTruthy();
});
