import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * @file password.ts
 * @description Password hashing with scrypt. Uses versioned hash format for forward
 *   compatibility: v2 hashes use stronger parameters (N=32768), legacy hashes (no prefix)
 *   use Node.js defaults (N=16384). Transparent upgrade on successful login.
 * @version-history
 *   v1.0.0 -- 2026-03-01 -- Initial implementation with Node.js default scrypt params
 *   v2.0.0 -- 2026-05-21 -- Versioned hash format with stronger N=32768 params
 */

const SCRYPT_V2 = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, SCRYPT_V2, (err, derivedKey) => {
            if (err) reject(err);
            else resolve('v2:' + salt.toString('hex') + ':' + derivedKey.toString('hex'));
        });
    });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const isV2 = hash.startsWith('v2:');
    const parts = isV2 ? hash.slice(3).split(':') : hash.split(':');
    const salt = Buffer.from(parts[0], 'hex');
    const storedKey = Buffer.from(parts[1], 'hex');
    const opts = isV2 ? SCRYPT_V2 : {};
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, opts, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(timingSafeEqual(storedKey, derivedKey));
        });
    });
}

export function isLegacyHash(hash: string): boolean {
    return !hash.startsWith('v2:');
}
