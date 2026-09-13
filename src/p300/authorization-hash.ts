import { createHash } from 'node:crypto';

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('authorization profile contains non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === 'undefined') throw new Error('authorization profile contains undefined');
  if (typeof value === 'bigint') throw new Error('authorization profile contains bigint');
  if (typeof value === 'function') throw new Error('authorization profile contains function');
  if (typeof value === 'symbol') throw new Error('authorization profile contains symbol');

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('authorization profile contains circular reference');
    seen.add(value);
    try {
      return value.map((item) => canonicalize(item, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (typeof value === 'object') {
    const object = value as object;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('authorization profile contains non-plain object');
    }
    if (seen.has(object)) throw new Error('authorization profile contains circular reference');
    seen.add(object);
    try {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonicalize(item, seen)])
      );
    } finally {
      seen.delete(object);
    }
  }

  throw new Error('authorization profile contains unsupported value');
}

export function hashAuthorizationProfile(profile: unknown): string {
  const canonicalValue = canonicalize(profile, new WeakSet<object>());
  const canonical = JSON.stringify(canonicalValue);
  if (canonical === undefined) throw new Error('authorization profile cannot be serialized');
  return createHash('sha256').update(canonical).digest('hex');
}

export function verifyAuthorizationProfileHash(profile: unknown, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  return hashAuthorizationProfile(profile) === expectedHash.toLowerCase();
}
