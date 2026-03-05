/**
 * Wildcard pattern matching for schema key patterns.
 * Supports '*' (one segment) and '**' (rest of key).
 * Example: 'profile.*.interests' matches 'profile.alice.interests'
 *          'iot.**' matches 'iot.temperature.living-room'
 */
export function matchWildcardPattern(pattern: string, key: string): boolean {
  const patternParts = pattern.split('.');
  const keyParts = key.split('.');

  let pi = 0, ki = 0;
  while (pi < patternParts.length && ki < keyParts.length) {
    if (patternParts[pi] === '**') {
      return true;
    }
    if (patternParts[pi] === '*') {
      pi++;
      ki++;
      continue;
    }
    if (patternParts[pi] !== keyParts[ki]) {
      return false;
    }
    pi++;
    ki++;
  }
  return pi === patternParts.length && ki === keyParts.length;
}

/**
 * Glob pattern matching for consent data patterns.
 * Supports '*' (one segment) and '**' (multiple segments).
 */
export function consentMatchPattern(pattern: string, key: string): boolean {
  const regex = pattern
    .split('.')
    .map(segment => {
      if (segment === '**') return '.*';
      if (segment === '*') return '[^.]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\.');
  return new RegExp(`^${regex}$`).test(key);
}
