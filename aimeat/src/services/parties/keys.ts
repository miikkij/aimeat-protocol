/**
 * @file src/services/parties/keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A party's key (plan doc-mvwxcas3dom3, D2.1): 32 random bytes in base64url, shown once
 *   at creation and stored as its SHA-256, compared in constant time. The pattern of
 *   services/calendar-feed.ts, which keeps a reader's feed key the same way.
 * @structure newPartyKey · hashPartyKey · partyKeyMatches · newPartyKeyId · newPartyUid
 * @usage const { key, hash } = newPartyKey();  …  if (partyKeyMatches(given, stored.hash)) …
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.1).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** The SHA-256 of a key, in hex: what the `parties` record keeps. */
export function hashPartyKey(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** A new key and its hash. The key leaves the node once, in the answer that made it. */
export function newPartyKey(): { key: string; hash: string } {
    const key = randomBytes(32).toString('base64url');
    return { key, hash: hashPartyKey(key) };
}

/** Does `given` hash to `storedHash`? Constant time over the two digests, whatever `given` is. */
export function partyKeyMatches(given: string, storedHash: string): boolean {
    if (typeof given !== 'string' || typeof storedHash !== 'string') return false;
    const a = Buffer.from(hashPartyKey(given), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && b.length === 32 && timingSafeEqual(a, b);
}

/** A key's id: short, public, and what a token and a key deletion name. */
export function newPartyKeyId(): string {
    return `pk_${randomBytes(6).toString('hex')}`;
}

/** A party's uid: made at creation and never reused. */
export function newPartyUid(): string {
    return `pty_${randomUUID().replace(/-/g, '')}`;
}
