import {it,expect} from 'vitest';
import {timeZoneOptions,utcOffset} from '../../src/shared/timezones';

it('lists canonical IANA zones once, sorted, including Tallinn',()=>{
  const ids=timeZoneOptions(new Date('2026-01-15T12:00:00Z')).map(option=>option.id);
  expect(ids).toContain('Europe/Tallinn');
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([...ids].sort());
});

it('shows the UTC offset for the requested date, including daylight saving time',()=>{
  expect(utcOffset('Europe/Paris',new Date('2026-01-15T12:00:00Z'))).toBe('UTC+01:00');
  expect(utcOffset('Europe/Paris',new Date('2026-07-15T12:00:00Z'))).toBe('UTC+02:00');
  expect(utcOffset('UTC',new Date('2026-07-15T12:00:00Z'))).toBe('UTC+00:00');
});
