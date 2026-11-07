import {z} from 'zod';

export const appLanguageSchema=z.enum(['en','ru']);
// minimizeToTray is optional so settings files written before the option existed stay valid.
export const appSettingsSchema=z.object({language:appLanguageSchema,minimizeToTray:z.boolean().optional()}).strict();
export type AppLanguage=z.infer<typeof appLanguageSchema>;
export type AppSettings=z.infer<typeof appSettingsSchema>;
export const DEFAULT_APP_SETTINGS:AppSettings={language:'en'};
