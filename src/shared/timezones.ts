export type TimeZoneOption = {id: string; offset: string};

const intlWithZones = Intl as typeof Intl & {supportedValuesOf(key: 'timeZone'): string[]};

export function utcOffset(zone: string, date: Date): string {
  const name = new Intl.DateTimeFormat('en-US', {timeZone: zone, timeZoneName: 'longOffset'})
    .formatToParts(date).find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  return name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
}

export function timeZoneOptions(date: Date = new Date()): TimeZoneOption[] {
  return intlWithZones.supportedValuesOf('timeZone').map(id => ({id, offset: utcOffset(id, date)}));
}
