import type {en} from '../../shared/i18n/en';
export type TranslationKey=keyof typeof en;
export type TranslationParams=Record<string,string|number>;
