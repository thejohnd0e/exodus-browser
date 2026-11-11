/** The list a default Chrome installation uses for one UI language: the code, then its base language. */
export function browserLanguages(code: string): string[] {
  const base = code.split('-')[0];
  return base && base !== code ? [code, base] : [code];
}
