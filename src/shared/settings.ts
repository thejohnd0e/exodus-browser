import {z} from 'zod';

export const appLanguageSchema=z.enum(['en','ru']);
// minimizeToTray and autoCheckUpdates are optional so settings files written before the options existed stay valid.
// autoCheckUpdates is off unless the user turns it on (DECISIONS #71): the application makes no background network call otherwise.
export const appSettingsSchema=z.object({language:appLanguageSchema,minimizeToTray:z.boolean().optional(),autoCheckUpdates:z.boolean().optional()}).strict();
export type AppLanguage=z.infer<typeof appLanguageSchema>;
export type AppSettings=z.infer<typeof appSettingsSchema>;
export const DEFAULT_APP_SETTINGS:AppSettings={language:'en'};
