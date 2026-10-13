/**
 * @file test/unit/app-scope-needs.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reading of an app's code for the scope words 4.0.0 checks (services/app-scope-needs.ts):
 *   one fixture per call shape found in the 218 apps on aimeat.io on 2026-10-13, and the shapes that
 *   look alike and are not calls (a prompt sentence, a help-text placeholder, a lib being loaded, a GET
 *   that 4.0.0 does not gate, an app that never signs in).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-scope-needs.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { scanScopeNeeds, cortexLibRefs, undeclaredScopeNeeds, undeclaredScopeFindings } from '../../src/services/app-scope-needs.js';

/** An app page that signs in, declares `scopes` (none: the default set) and runs `code`. */
function page(code: string, scopes?: string): string {
    const meta = scopes === undefined ? '' : `<meta name="aimeat-scopes" content="${scopes}">`;
    return `<!DOCTYPE html><html><head>${meta}<script src="/v1/libs/aimeat-auth.js"></script></head><body><script>${code}</script></body></html>`;
}
const words = (code: string, scopes?: string) => undeclaredScopeNeeds(page(code, scopes)).missing;

describe('a call shape the 4.0.0 gates check', () => {
    const cases: Array<[string, string, string[]]> = [
        ['an extension action by literal', "session.fetch('/v1/ext/guestbook/sign', { method: 'POST' })", ['ext:invoke']],
        ['an extension action joined to a variable', "s.fetch('/v1/ext/' + EXT + '/' + action, opts)", ['ext:invoke']],
        ['an extension action in a template', 'fetch(`${NODE}/v1/ext/ec-business/check`, { headers })', ['ext:invoke']],
        ['the IAM library with an extension gate', "AIMEAT.iam.init({ app: APP_ID, ext: 'ec-business', roles: ['member'] })", ['ext:invoke']],
        ['the webhook library', 'AIMEAT.webhook.send({ to: url, body })', ['ext:invoke']],
        ['living hooks settings', "var HOOKS_KEY = 'living-hooks.settings';", ['ext:invoke']],
        ['the agent list by SDK', 'const list = await AIMEAT.agents.list({ fresh: true });', ['agent:read']],
        ['the agent list by route', "api('/v1/agents?include=stats')", ['agent:read']],
        ['a task for an agent by SDK', "AIMEAT.agents.createTask(name, { title: 'x' })", ['task:write']],
        ['a schedule made by POST wrapper', "post('/v1/schedules', { cron })", ['task:write']],
        ['a schedule made by method POST', "api('/v1/schedules', { method: 'POST', body })", ['task:write']],
        ['a schedule triggered', "post('/v1/schedules/' + id + '/trigger', {})", ['task:write']],
        ['a schedule made by the refinery', 'var R = AIMEAT.refinery; R.schedule(PREFIX, { cron: c });', ['task:write']],
        ['a schedule edited by PATCH wrapper', "patchReq('/v1/schedules/' + id, { enabled: false })", ['workflow:write']],
        ['a schedule edited by method PATCH', 'api("/v1/schedules/" + o.scheduleId, { method: "PATCH", body })', ['workflow:write']],
        ['an organism\'s workspaces by route', "sf('/v1/organisms/' + id + '/workspaces')", ['organism:read']],
        ['an organism\'s workspaces by SDK', 'AIMEAT.organism.workspaces(org.id)', ['organism:read']],
        ['intake forms by SDK', 'AIMEAT.intake.listForms(orgId, wsId)', ['organism:read']],
        ['workspace access', "api('/v1/organisms/' + org + '/workspace-access?ws=' + ws)", ['organism:invite']],
    ];
    for (const [name, code, expected] of cases) {
        it(`${name} needs ${expected.join(', ')}`, () => {
            expect(words(code)).toEqual(expected);
        });
    }

    it('a checkout completed by an app needs the app twin contract:spend, which a grant can hold', () => {
        expect(words('AIMEAT.commerce.completeCheckout(id)')).toEqual(['contract:spend']);
    });

    it('a cortex lib the app loads counts as its code, and the evidence names the lib', () => {
        const html = page("AIMEAT.foo.run();") .replace('</head>', '<script src="/v1/cortex/foo-cortex/libs/foo.js"></script></head>');
        expect(cortexLibRefs(html)).toEqual([{ name: 'foo-cortex', file: 'foo.js', path: '/v1/cortex/foo-cortex/libs/foo.js' }]);
        const lib = { source: '/v1/cortex/foo-cortex/libs/foo.js', text: "AIMEAT.foo = { run: () => session.fetch('/v1/ext/foo/run') };" };
        const out = undeclaredScopeNeeds(html, [lib]);
        expect(out.missing).toEqual(['ext:invoke']);
        expect(out.evidence[0].source).toBe('/v1/cortex/foo-cortex/libs/foo.js');
    });
});

describe('what is not a call, or is already asked for', () => {
    it('a sentence in a prompt that names a route is not a call', () => {
        expect(words("const prompt = 'Call POST /v1/ext/name/action with the body, and GET /v1/agents for the list.';")).toEqual([]);
    });

    it('a help-text placeholder with bare braces is not a call', () => {
        expect(words("const help = '/v1/ext/{ext}/{action}';")).toEqual([]);
    });

    it('loading a cortex lib is not a catalogue read', () => {
        expect(scanScopeNeeds([{ source: 'app', text: '<script src="/v1/cortex/x/libs/y.js"></script>' }])).toEqual([]);
    });

    it('a GET of an agent\'s own task queue is not gated', () => {
        expect(words("api('/v1/agents/' + name + '/tasks')")).toEqual([]);
    });

    it('the IAM library on the node\'s own roster (app, no ext) reaches no extension', () => {
        expect(words("AIMEAT.iam.init({ app: APP_ID, roles: ['member'] })")).toEqual([]);
    });

    it('a schedule read (GET) needs nothing', () => {
        expect(words("api('/v1/schedules')")).toEqual([]);
    });

    it('an app that declares the word needs nothing more', () => {
        expect(words("session.fetch('/v1/ext/x/y')", 'memory:read ext:invoke')).toEqual([]);
        expect(words("session.fetch('/v1/ext/x/y')", 'ext:*')).toEqual([]);
    });

    it('the default set covers a memory read for an app that declares nothing', () => {
        expect(words('AIMEAT.data.discover({ q })')).toEqual([]);
    });

    it('an app that never signs in holds no grant, so nothing is missing', () => {
        const html = '<html><body><script>fetch("/v1/ext/chilikaveri/oletus/embedquery", { credentials: "include" })</script></body></html>';
        expect(undeclaredScopeNeeds(html).missing).toEqual([]);
    });
});

describe('the publish warning', () => {
    it('names each word, the line that needs it, and the pitfall that explains it', async () => {
        const findings = await undeclaredScopeFindings(page("session.fetch('/v1/ext/guestbook/sign')"), async () => null);
        expect(findings).toHaveLength(1);
        expect(findings[0].pitfall).toBe('undeclared-scope-words');
        expect(findings[0].message).toContain('`ext:invoke`');
        expect(findings[0].message).toContain('/v1/ext/guestbook/sign');
    });

    it('says nothing for an app that declares what it calls', async () => {
        expect(await undeclaredScopeFindings(page("session.fetch('/v1/ext/x/y')", 'ext:invoke'), async () => null)).toEqual([]);
    });
});
