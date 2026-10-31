import type {en} from './en';
export type TranslationKey=keyof typeof en;
export type TranslationParams=Record<string,string|number>;
