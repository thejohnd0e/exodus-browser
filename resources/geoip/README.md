# GeoIP data provenance and refresh

The application bundles the DB-IP Country Lite MMDB database for offline country estimates. It performs no GeoIP network requests.

## Shipped data

- Publisher: DB-IP.com (Eris Networks S.A.S.)
- Product/release: IP to Country Lite, October 2026
- Official source page: <https://db-ip.com/db/download/ip-to-country-lite>
- Official compressed URL: <https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz>
- License: Creative Commons Attribution 4.0 International (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>
- Required attribution: "IP geolocation data by DB-IP.com" with a link to <https://db-ip.com>.
- Official uncompressed MMDB SHA-1: `e515b63075ad48847f9c4332b724742e8ba15b0e`
- Verified uncompressed MMDB SHA-256: `dbd70ccfa2a13627eaf4913d19920a1a229f1b3c5439ac01c509995b6364202a`
- Verified downloaded gzip SHA-256: `4cd44536ddfd40fec7eca94a233f7d19f38d470e6522e653cb8d27001f5fe177`
- Shipped file: `dbip-country-lite.mmdb` (8,348,509 bytes)

The official page was checked on 2026-10-31. The official SHA-1 matched the decompressed file before it was added. The gzip SHA-256 is recorded for transfer integrity; the decompressed MMDB SHA-256 identifies the shipped asset.

## Reader

`maxmind` 5.0.7 (MIT) reads the MMDB with an explicit 256-entry in-memory lookup cache. `ipaddr.js` 2.2.0 (MIT) rejects non-unicast IP ranges before lookup. Exact package versions and registry integrity values are pinned in `package-lock.json`.

## Maintainer refresh procedure

1. Open the official DB-IP download page and confirm the current Country Lite edition, release date, CC BY 4.0 terms, attribution requirement, and the SHA-1 printed for the MMDB download. Do not use a mirror as the provenance source.
2. Download the linked `.mmdb.gz` over HTTPS to a temporary directory. A configured, trusted proxy may be used if the direct route is blocked; do not change project networking settings to fetch it.
3. Record the compressed file's SHA-256, decompress it, and compare the resulting MMDB SHA-1 against the official page. Stop if the release, license, official SHA-1, or provenance cannot be verified.
4. Calculate the decompressed MMDB SHA-256 and size. Replace `dbip-country-lite.mmdb` only after both official SHA-1 and local SHA-256 have been recorded.
5. Update the release date, source URL, both MMDB hashes, gzip hash, and file size in this document. Run `npx vitest run tests/unit/country.test.ts`, `npm run verify`, and `npm run test:integration`.
6. Commit the database and this inventory together. Do not download or update the dataset during ordinary builds, application startup, or tests.
