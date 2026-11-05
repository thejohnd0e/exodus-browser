import type { Fingerprint } from '../../shared/fingerprint';
import { isTimeZone } from '../../shared/fingerprint';
import type { LaunchWarning } from '../../shared/contracts';
import { allZonesForCountry, zonesForCountry } from '../../shared/country-timezones';

export type ExitLocation = { country: string | null; zone: string | null };
export type ExitLocationLookup = () => Promise<ExitLocation>;

/**
 * Turns `auto` into a concrete zone for one launch. The exit IP supplies the zone itself, so countries with
 * several zones are handled without asking the user. The report is trusted only when it agrees with the
 * country reported for the same address; otherwise the country's single zone is used. When neither is
 * available the launch continues with the host zone and a warning is reported. The stored profile is never
 * modified.
 */
export async function resolveTimezone(fingerprint: Fingerprint, exitLocation?: ExitLocationLookup): Promise<{ fingerprint: Fingerprint; warning?: LaunchWarning }> {
  const setting = fingerprint.timezone;
  if (setting.mode !== 'auto' || !exitLocation) return { fingerprint };
  let location: ExitLocation | null = null;
  try { location = await exitLocation(); } catch { location = null; }
  const country = location?.country ?? null;
  const countryZones = country ? allZonesForCountry(country) : [];
  const manual = (value: string) => ({ fingerprint: { ...fingerprint, timezone: { mode: 'manual' as const, value } } });
  const reported = location?.zone && isTimeZone(location.zone) ? location.zone : null;
  if (reported && (countryZones.length === 0 || countryZones.includes(reported))) return manual(reported);
  const single = country ? zonesForCountry(country) : [];
  if (single.length === 1) return manual(single[0]);
  return { fingerprint: { ...fingerprint, timezone: { mode: 'auto' as const } }, warning: { code: 'TIMEZONE_UNRESOLVED' } };
}
