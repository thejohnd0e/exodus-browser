import {closeSync, openSync, readSync, statSync} from 'node:fs';

const PREFIX_BYTES = 16;

export function fileOffset(base, entry) {
  return base + Number(entry.offset ?? 0);
}

export function readAsarIndex(asarPath) {
  let index;
  let base;
  let size;
  const fd = openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(PREFIX_BYTES);
    readSync(fd, prefix, 0, PREFIX_BYTES, 0);
    const headerSize = prefix.readUInt32LE(12);
    const header = Buffer.alloc(headerSize);
    readSync(fd, header, 0, headerSize, PREFIX_BYTES);
    index = JSON.parse(header.toString('utf8'));
    base = PREFIX_BYTES + Math.ceil(headerSize / 4) * 4;
    size = statSync(asarPath).size;
  } finally {
    closeSync(fd);
  }
  const find = (name) => {
    let node = index;
    for (const part of name.split('/')) {
      node = node?.files?.[part];
      if (!node) return null;
    }
    return node;
  };
  return {
    has: (name) => Boolean(find(name)),
    read: (name) => {
      const entry = find(name);
      if (!entry || entry.unpacked) return null;
      const start = fileOffset(base, entry);
      const length = Number(entry.size);
      if (start + length > size) return null;
      const buffer = Buffer.alloc(length);
      const handle = openSync(asarPath, 'r');
      try {
        readSync(handle, buffer, 0, length, start);
      } finally {
        closeSync(handle);
      }
      return buffer;
    },
  };
}

export function checkPackagedApp({asarPath, expectedVersion, nativeModulePath}) {
  const errors = [];
  let asar;
  try {
    asar = readAsarIndex(asarPath);
  } catch (error) {
    return [`cannot read ${asarPath}: ${error.message}`];
  }
  const raw = asar.read('package.json');
  if (!raw) {
    errors.push('package.json is missing from app.asar');
  } else {
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (parsed.main !== 'dist/main.cjs') errors.push(`package.json main is ${String(parsed.main)}, expected dist/main.cjs`);
      if (expectedVersion && parsed.version !== expectedVersion) errors.push(`package.json version is ${String(parsed.version)}, expected ${expectedVersion}`);
    } catch {
      errors.push(`package.json inside app.asar is not valid JSON (starts with ${JSON.stringify(raw.subarray(0, 40).toString())})`);
    }
  }
  for (const required of ['dist/main.cjs', 'dist/preload.cjs', 'dist/ui/index.html', 'dist/resources/geoip/dbip-country-lite.mmdb']) {
    const entry = asar.read(required);
    if (!entry || entry.length === 0) errors.push(`${required} is missing or empty in app.asar`);
  }
  const native = asar.read('node_modules/better-sqlite3/package.json') ?? null;
  if (!native && !nativeModulePath) errors.push('better-sqlite3 is missing from the package');
  if (nativeModulePath) {
    try {
      const handle = openSync(nativeModulePath, 'r');
      closeSync(handle);
    } catch {
      errors.push(`native module is missing: ${nativeModulePath}`);
    }
  }
  return errors;
}
