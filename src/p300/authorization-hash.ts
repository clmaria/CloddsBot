import { createHash } from 'node:crypto';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, stable(val)])
    );
  }
  return value;
}

export function hashAuthorizationProfile(profile: unknown): string {
  const canonical = JSON.stringify(stable(profile));
  return createHash('sha256').update(canonical).digest('hex');
}

export function verifyAuthorizationProfileHash(profile: unknown, expectedHash: string): boolean {
  return hashAuthorizationProfile(profile) === expectedHash;
}
