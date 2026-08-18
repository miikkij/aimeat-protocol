/**
 * @file password-validation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared password strength validation used by GHII registration and admin setup.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Extracted from ghii.ts for reuse in admin.ts
 */

const WEAK_PASSWORDS = [
    'password', 'admin', 'testadminpw123', '123456', '12345678', 'letmein', 'qwerty',
    'abc123', 'TestAdminPw123!', 'secret', 'test', 'demo', 'welcome', 'login',
    'master', 'dragon', 'monkey', 'shadow', 'sunshine', 'trustno1',
];

export function validatePasswordStrength(password: string): string | null {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain a number';
    if (WEAK_PASSWORDS.includes(password.toLowerCase())) return 'Password is too common';
    return null;
}
