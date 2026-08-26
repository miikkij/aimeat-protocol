/**
 * @file connections-mail-providers.test.ts
 * @description The four mail providers, and the traps each of them is one field away from.
 *
 *   Everything here is a property that fails SILENTLY and LATE if it is wrong, which is why it is
 *   pinned in a test rather than left to a code review:
 *
 *   1. `offline_access` IS A SCOPE ON MICROSOFT, NOT A PARAMETER. Google needs
 *      `access_type=offline&prompt=consent` in the authorize URL, which is what `offlineAccess: true`
 *      emits. Microsoft needs the scope. Set the Google field on a Microsoft provider and the
 *      connection authorises, works for an hour, and cannot renew — with nothing in any response to
 *      say so. It is YouTube's 2026-08 trap, exactly inverted.
 *   2. THE TENANT IS IN THE URL PATH, and it comes from the CLIENT rather than from the request.
 *      A single-tenant Entra app — which is the portal's DEFAULT for a new registration — must use
 *      its own directory id, or Microsoft refuses with a message about the application that names
 *      nothing anyone can act on.
 *   3. A SEND PROVIDER CARRIES NO READ CAPABILITY AND VICE VERSA. The pairing is the whole consent
 *      model: a person who granted "send as me" has not granted "read my mail", and a capability
 *      list that blurred the two would offer surfaces neither consent covers.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connections-mail-providers.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */

import { describe, it, expect } from 'vitest';
import { buildOutboundProviders, findProvider } from '../../src/services/connections/providers.js';
import type { AimeatConfig } from '../../src/config.js';

function cfg(over: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        connectionsEnabled: true,
        connectGoogleClientId: 'g-id',
        connectGoogleClientSecret: 'g-secret',
        connectMicrosoftClientId: 'ms-id',
        connectMicrosoftClientSecret: 'ms-secret',
        connectMicrosoftTenant: 'common',
        connectLinkedinClientId: '',
        connectLinkedinClientSecret: '',
        connectXClientId: '',
        connectXClientSecret: '',
        connectRedirectUri: '',
        connectFakeBaseUrl: '',
        ...over,
    } as unknown as AimeatConfig;
}

const build = (over: Partial<AimeatConfig> = {}) => buildOutboundProviders(cfg(over));
const get = (id: string, over: Partial<AimeatConfig> = {}) => {
    const p = findProvider(build(over), id);
    if (!p) throw new Error(`no provider ${id}`);
    return p;
};

describe('the four mail providers exist and are enabled by their own credentials', () => {
    it('registers both halves of Gmail and both halves of Outlook', () => {
        const ids = build().map(p => p.id);
        expect(ids).toContain('google-mail');
        expect(ids).toContain('google-mail-send');
        expect(ids).toContain('microsoft-mail');
        expect(ids).toContain('microsoft-mail-send');
    });

    it('shares one Google client between reading and sending', () => {
        expect(get('google-mail').client?.id).toBe('g-id');
        expect(get('google-mail-send').client?.id).toBe('g-id');
    });

    it('leaves Microsoft disabled with an actionable reason when it has no credentials', () => {
        const p = get('microsoft-mail', { connectMicrosoftClientId: '', connectMicrosoftClientSecret: '' });
        expect(p.enabled).toBe(false);
        expect(p.disabledReason).toMatch(/AIMEAT_CONNECT_MICROSOFT_CLIENT_ID/);
    });

    it('turns everything off when the capability switch is off, whoever brought what', () => {
        for (const id of ['google-mail', 'google-mail-send', 'microsoft-mail', 'microsoft-mail-send']) {
            const p = get(id, { connectionsEnabled: false });
            expect(p.enabled).toBe(false);
            expect(p.capabilityOn).toBe(false);
        }
    });
});

describe('offline_access is a scope on Microsoft, not a parameter', () => {
    it('asks for the scope and does NOT set the Google offline flag', () => {
        for (const id of ['microsoft-mail', 'microsoft-mail-send']) {
            const p = get(id);
            expect(p.scopes).toContain('offline_access');
            // If this ever flips to true the authorize URL grows Google's parameters, Microsoft
            // ignores them, and the connection dies on day two.
            expect(p.offlineAccess).toBe(false);
        }
    });

    it('is the other way round on Google: the flag, and no such scope', () => {
        for (const id of ['google-mail', 'google-mail-send']) {
            const p = get(id);
            expect(p.offlineAccess).toBe(true);
            expect(p.scopes).not.toContain('offline_access');
        }
    });
});

describe('the tenant is in the URL path, and it comes from the client', () => {
    it('uses the configured tenant when the node speaks for itself', () => {
        const e = get('microsoft-mail', { connectMicrosoftTenant: 'organizations' }).endpoints(null);
        expect(e?.authorize).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
        expect(e?.token).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    });

    it("lets a principal's own single-tenant app override it", () => {
        const guid = '72f988bf-86f1-41af-91ab-2d7cd011db47';
        const e = get('microsoft-mail').endpoints(null, guid);
        expect(e?.authorize).toBe(`https://login.microsoftonline.com/${guid}/oauth2/v2.0/authorize`);
    });

    it('falls back to common rather than interpolating something unsafe into the path', () => {
        // The route refuses a malformed tenant before it is stored, so this is the second line: a
        // value that reached the builder anyway must not become part of a URL this node sends a
        // token to.
        for (const nasty of ['../../evil.com', 'a/b', 'https://evil.com', 'x'.repeat(200)]) {
            const e = get('microsoft-mail').endpoints(null, nasty);
            expect(e?.authorize).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        }
    });

    it('has no revoke endpoint, and says so with null rather than pointing at a logout', () => {
        // Microsoft's logout ends a SESSION; it does not retire a refresh token the way Google's
        // revoke does. Naming one here would make "disconnect" claim more than it does.
        expect(get('microsoft-mail').endpoints(null)?.revoke).toBeNull();
        expect(get('google-mail').endpoints(null)?.revoke).toBe('https://oauth2.googleapis.com/revoke');
    });
});

describe('reading and sending are separate consent', () => {
    it('gives a read provider read-mail and no send', () => {
        for (const id of ['google-mail', 'microsoft-mail']) {
            expect(get(id).capabilities).toEqual(['read-mail']);
        }
    });

    it('gives a send provider send-mail and no read', () => {
        for (const id of ['google-mail-send', 'microsoft-mail-send']) {
            expect(get(id).capabilities).toEqual(['send-mail']);
        }
    });

    it('asks for exactly the scope each half needs, and not the other', () => {
        expect(get('google-mail').scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
        expect(get('google-mail').scopes.join()).not.toMatch(/gmail\.send/);
        expect(get('google-mail-send').scopes).toContain('https://www.googleapis.com/auth/gmail.send');
        expect(get('google-mail-send').scopes.join()).not.toMatch(/gmail\.readonly/);
        expect(get('microsoft-mail').scopes).toContain('Mail.Read');
        expect(get('microsoft-mail').scopes).not.toContain('Mail.Send');
        expect(get('microsoft-mail-send').scopes).toContain('Mail.Send');
        expect(get('microsoft-mail-send').scopes).not.toContain('Mail.Read');
    });

    it('asks for the identity scope each half can actually use', () => {
        // gmail.send cannot read users.getProfile, so the send provider identifies the account
        // through userinfo.email instead. Without it the connection has no dedupe key and no label,
        // and it fails at the last step of somebody's first attempt.
        expect(get('google-mail-send').scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
        expect(get('microsoft-mail').scopes).toContain('User.Read');
        expect(get('microsoft-mail-send').scopes).toContain('User.Read');
    });

    it('gives only the READ provider things to read', () => {
        expect(Object.keys(get('google-mail').resources ?? {}).sort())
            .toEqual(['attachment', 'message', 'messages', 'profile', 'sendAs']);
        expect(Object.keys(get('microsoft-mail').resources ?? {}).sort())
            .toEqual(['attachment', 'message', 'messages', 'profile']);
        expect(get('google-mail-send').resources).toBeUndefined();
        expect(get('microsoft-mail-send').resources).toBeUndefined();
    });
});

describe('the node builds every read URL, and a caller only supplies parameters', () => {
    const gmail = () => get('google-mail').resources!;
    const graph = () => get('microsoft-mail').resources!;

    it('lists the send-as aliases without asking for a scope beyond the read one', () => {
        const r = gmail().sendAs;
        expect(r.url({}, null)).toBe('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs');
        // gmail.readonly is one of the scopes Google accepts for settings.sendAs.list, which is what
        // makes the alias picker free: no second consent, no extra permission on the screen.
        expect(r.requiresScopes).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
    });

    it('clamps a silly limit instead of refusing it', () => {
        expect(gmail().messages.url({ limit: 5000 }, null)).toContain('maxResults=100');
        expect(gmail().messages.url({ limit: -3 }, null)).toContain('maxResults=25');
        expect(graph().messages.url({ limit: 5000 }, null)).toContain('%24top=100');
    });

    it('refuses an id that could walk the URL somewhere else', () => {
        for (const bad of ['../../evil', 'a/b', '', 'x'.repeat(600)]) {
            expect(() => gmail().message.url({ id: bad }, null)).toThrow();
            expect(() => graph().message.url({ id: bad }, null)).toThrow();
        }
    });

    it('keeps a caller from asking Graph for a search and a filter at once', () => {
        // $search and $filter are mutually exclusive in Graph and asking for both is a 400 naming
        // neither, so the builder picks the search and drops the filter rather than sending both.
        const u = graph().messages.url({ query: 'invoice', filter: "from/emailAddress/address eq 'x@y'" }, null);
        expect(u).toContain('%24search');
        expect(u).not.toContain('%24filter');
    });
});
