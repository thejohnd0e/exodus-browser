import {z} from 'zod';

export const appLanguageSchema=z.enum(['en','ru']);
export const appSettingsSchema=z.object({language:appLanguageSchema}).strict();
export type AppLanguage=z.infer<typeof appLanguageSchema>;
export type AppSettings=z.infer<typeof appSettingsSchema>;
export const DEFAULT_APP_SETTINGS:AppSettings={language:'en'};
