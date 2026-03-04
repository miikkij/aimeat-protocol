import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt.
 *
 * Shared service used by ghii.ts, setup.ts, and admin.ts
 * to avoid code duplication (Phase 1 gap closure).
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(salt.toString('hex') + ':' + derivedKey.toString('hex'));
        });
    });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const [saltHex, keyHex] = hash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const storedKey = Buffer.from(keyHex, 'hex');
    return new Promise((resolve, reject) => {
        scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(timingSafeEqual(storedKey, derivedKey));
        });
    });
}
