/**
 * @file src/storage/providers/mongodb/methods/helpers.ts
 * @description Module-level pattern-matching helpers (wildcard/glob/consent) used by PrismaStorage memory & consent methods. Extracted from mongodb/index.ts to satisfy max-file-lines; bodies verbatim.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from providers/mongodb/index.ts (max-file-lines)
 */
/**
 * Wildcard pattern matching: supports '*' (one segment) and '**' (multiple segments)
 */
export function mongoMatchWildcardPattern(pattern: string, key: string): boolean {
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
 * Glob-style pattern matching: converts a pattern like "recipe:*" to a regex.
 * Supports '*' as a wildcard that matches any characters.
 */
export function mongoMatchGlobPattern(pattern: string, key: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.+') + '$';
    try {
        return new RegExp(regexStr).test(key);
    } catch {
        return false;
    }
}

/**
 * Glob pattern matching for consent data patterns.
 * Supports '*' (one segment) and '**' (multiple segments).
 */
export function mongoConsentMatchPattern(pattern: string, key: string): boolean {
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

/**
 * MongoDB-backed storage. Thin subclass of {@link PrismaStorage} kept so existing
 * imports (`new MongoStorage(url)`) keep working; the MongoDB defaults
 * (`schema.prisma` + `@prisma/client`) live in the base class.
 */
