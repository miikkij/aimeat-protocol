/**
 * @file sdk-auth-error.test.ts
 * @description A refused sign-in comes back to the front page as `?auth_error=<CODE>` (the emailed
 *   sign-in link, Google, Entra, SAML). Until 2026-09-29 nothing read it. auth/auth-error.js takes the
 *   code off the address, so a reload does not repeat it, and gives the sentence the sign-in dialog
 *   shows; a value that is not a code in our shape is shown as the general message, never echoed.
 * @version-history
 *   v1.1.0 — 2026-10-09 — readAuthStep() and SECOND_FACTOR_EXPIRED (secaudit 2026-10-09, S1).
 *   v1.0.0 — 2026-09-29 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';

let replaced: string | null = null;

beforeEach(() => {
    replaced = null;
    (globalThis as any).history = { state: null, replaceState: (_s: unknown, _t: string, url: string) => { replaced = url; } };
});

function at(href: string) {
    (globalThis as any).location = new URL(href);
}

async function lib() {
    return import('../../src/static/sdk-libs/auth/auth-error.js');
}

describe('the refused sign-in on the front page', () => {
    it('reads the code and takes it off the address', async () => {
        const { readAuthError } = await lib();
        at('https://node.test/?lang=fi&auth_error=INVALID_TOKEN#top');
        expect(readAuthError()).toBe('INVALID_TOKEN');
        expect(replaced).toBe('/?lang=fi#top');
    });

    it('answers null when there is nothing to say', async () => {
        const { readAuthError } = await lib();
        at('https://node.test/?lang=fi');
        expect(readAuthError()).toBeNull();
        expect(replaced).toBeNull();
    });

    it('never passes on a value that is not one of our codes', async () => {
        const { readAuthError, authErrorText } = await lib();
        at('https://node.test/?auth_error=%3Cscript%3E');
        const code = readAuthError();
        expect(code).toBe('UNKNOWN');
        expect(authErrorText({}, code!)).toMatch(/Sign-in did not go through/);
    });

    it('says what happened to the link, in the dialog\'s language when it has the string', async () => {
        const { authErrorText } = await lib();
        expect(authErrorText({}, 'INVALID_TOKEN')).toMatch(/already been used/);
        expect(authErrorText({}, 'EXPIRED')).toMatch(/expired/);
        expect(authErrorText({}, 'ACCOUNT_DISABLED')).toMatch(/deactivated/);
        expect(authErrorText({ authErrorExpired: 'Linkki on vanhentunut.' }, 'EXPIRED')).toBe('Linkki on vanhentunut.');
        expect(authErrorText({}, 'ENTRA_CALLBACK_FAILED')).toMatch(/Sign-in did not go through/);
    });

    // Secaudit 2026-10-09, S1: an emailed link on an account with two-step sign-in comes back as
    // `?auth_step=second_factor`, and the dialog opens on its code view.
    it('reads the second-factor step and takes it off the address', async () => {
        const { readAuthStep } = await lib();
        at('https://node.test/?auth_step=second_factor&lang=fi');
        expect(readAuthStep()).toBe('second_factor');
        expect(replaced).toBe('/?lang=fi');
    });

    it('answers null for no step and for a step it does not know', async () => {
        const { readAuthStep } = await lib();
        at('https://node.test/');
        expect(readAuthStep()).toBeNull();
        at('https://node.test/?auth_step=%3Cscript%3E');
        expect(readAuthStep()).toBeNull();
    });

    it('tells the person to ask for a new link when the code step has expired', async () => {
        const { authErrorText } = await lib();
        expect(authErrorText({}, 'SECOND_FACTOR_EXPIRED')).toMatch(/new sign-in link/);
    });
});
