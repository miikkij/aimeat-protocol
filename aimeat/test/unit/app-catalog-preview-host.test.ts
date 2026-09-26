/**
 * @file app-catalog-preview-host.test.ts
 * @description What the App Catalog answers the code in its preview frame (static/app-catalog/js/
 *   preview-host.js). The preview holds code nobody has published yet (a working copy, a checkpoint,
 *   an AI proposal), and it can be another person's work (a fork's author, a builder with a
 *   development right). So it gets what the app would get and nothing more: the owner's session
 *   token never, the app's own grant for the owner's own app, and nothing for another person's app
 *   until that person agrees in the consent window. Until 2026-09-26 the older road answered with the
 *   owner's session token.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-catalog-preview-host.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { answerPreview } from '../../src/static/app-catalog/js/preview-host.js';
import { forFrame } from '../../src/static/app-frame-core.js';

/** The owner's session token, which the catalog page itself holds and must never hand over. */
const OWNER_JWT = 'owner.session.jwt';
const APP_TOKEN = 'app.grant.token';

/** A grant door that behaves as the node's does: the owner's own app silently, another's not. */
async function grant(app: string): Promise<Record<string, unknown>> {
    if (app === 'alice/own.html') return { ok: true, access_token: APP_TOKEN, app, own: true, scope: 'memory:read' };
    return { ok: false, error: 'consent_required', app };
}
async function consent(app: string): Promise<Record<string, unknown> | null> {
    return app === 'bob/theirs.html' ? { ok: true, access_token: 'consented.token', app, own: false } : null;
}
const deps = {
    // Everything the page has at hand, the owner's session included: the answer may use none of it.
    getSession: () => ({ jwt: OWNER_JWT, nodeUrl: 'http://node' }),
    storedSession: () => ({ jwt: OWNER_JWT }),
    nodeUrl: 'http://node',
    origin: 'http://node',
    grant, consent,
};

describe('the older road (AIMEAT.auth.requestParentAuth)', () => {
    it('never hands the preview the owner\'s session token', async () => {
        for (const target of ['alice/own.html', 'bob/theirs.html', '']) {
            const r = await answerPreview({ type: 'aimeat-request-auth' }, target, deps);
            expect(r?.jwt).not.toBe(OWNER_JWT);
        }
    });
    it('gives the owner\'s own app its own grant, and another person\'s app nothing', async () => {
        expect((await answerPreview({ type: 'aimeat-request-auth' }, 'alice/own.html', deps))?.jwt).toBe(APP_TOKEN);
        expect((await answerPreview({ type: 'aimeat-request-auth' }, 'bob/theirs.html', deps))?.jwt).toBeNull();
        expect((await answerPreview({ type: 'aimeat-request-auth' }, '', deps))?.jwt).toBeNull();
    });
});

describe('the frame protocol aimeat-auth speaks in the preview', () => {
    const ask = (op: string, target: string, extra: Record<string, unknown> = {}) =>
        answerPreview({ type: 'aimeat_frame_req', id: 'q1', op, scope: 'memory:read', ...extra }, target, deps);

    it('a sign-in is the app\'s own grant for the owner\'s own app', async () => {
        const r = await ask('login', 'alice/own.html');
        expect(r).toMatchObject({ type: 'aimeat_frame_res', id: 'q1', op: 'login', result: { ok: true, access_token: APP_TOKEN } });
    });
    it('another person\'s app gets no token until the owner agrees in the consent window', async () => {
        const silent = await ask('login', 'bob/theirs.html');
        expect(silent?.result).toMatchObject({ ok: false, error: 'consent_required' });
        expect(JSON.stringify(silent)).not.toContain('access_token');
        const agreed = await ask('consent', 'bob/theirs.html');
        expect(agreed?.result).toMatchObject({ access_token: 'consented.token', own: false });
    });
    it('code with no published name gets nothing', async () => {
        expect((await ask('login', ''))?.result).toMatchObject({ ok: false });
        expect((await ask('consent', ''))?.result).toBeNull();
    });
    it('a preview never ends the owner\'s session', async () => {
        expect((await ask('logout', 'alice/own.html'))?.result).toMatchObject({ ok: false });
    });
    it('answers nothing that is not a request', async () => {
        expect(await answerPreview({ type: 'something-else' }, 'alice/own.html', deps)).toBeNull();
        expect(await answerPreview(null, 'alice/own.html', deps)).toBeNull();
    });
});

describe('what a frame may hold of a grant', () => {
    it('everything but the refresh token', () => {
        expect(forFrame({ ok: true, access_token: 'a', refresh_token: 'r', scope: 's' })).toEqual({ ok: true, access_token: 'a', scope: 's' });
    });
});
