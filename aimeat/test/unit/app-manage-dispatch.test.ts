/**
 * @file test/unit/app-manage-dispatch.test.ts
 * @description aimeat_app_manage on the connector and the CLI dispatch: every action reaches its
 *   REST endpoint with every field it takes, and a wrong call is refused in ONE answer naming every
 *   missing and every foreign field, before anything is sent. The node MCP surface is proved end to
 *   end by test/e2e-app-manage.ts.
 * @usage pnpm test -- app-manage-dispatch
 * @version-history
 *   v1.6.0 — 2026-10-02 — spec, spec_set and spec_clear, and the markdown and expected_revision fields.
 *   v1.5.0 — 2026-10-02 — builders, builder_set and builder_remove, and the dev_level field.
 *   v1.4.0 — 2026-10-01 — year on audit, and audit_archive and audit_keep.
 *   v1.3.0 — 2026-10-01 — IAM round 2: email on member_set, q/limit/offset on members, manage_roles
 *     on member_plan_set, and member_audit and member_invite_cancel.
 *   v1.2.0 — 2026-10-01 — The member actions and their fields, and how snake_case tool fields reach
 *     the member routes' camelCase body.
 *   v1.1.0 — 2026-09-28 — config_get and config_set, and the `values` field.
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appManageCall } from '../../src/tool-dispatch/app-manage-call.js';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { AimeatClient } from '../../src/cli/connect/api-client.js';
import {
    APP_MANAGE_ACTIONS, APP_MANAGE_ACTION_NAMES, APP_MANAGE_FIELDS, checkAppManageInput, appManageTools,
} from '../../src/mcp/catalog/definitions/app-manage.js';
import { appManageShape } from '../../src/mcp/app-manage-shape.js';
import { TOOL_ACTION_SCOPES } from '../../src/mcp/catalog/action-scopes.js';
import { fileURLToPath } from 'node:url';
import { readVocabulary } from '../../scripts/inventory/scope-vocabulary.js';

type Sent = { method: string; path: string; body?: unknown };

function recorder(answer: (s: Sent) => { ok: boolean; data?: unknown; error?: { code: string; message: string } } = () => ({ ok: true, data: {} })) {
    const sent: Sent[] = [];
    const push = (method: string, path: string, body?: unknown) => { const s = { method, path, body }; sent.push(s); return Promise.resolve(answer(s)); };
    const client = {
        get: (p: string) => push('GET', p),
        post: (p: string, b?: unknown) => push('POST', p, b),
        put: (p: string, b?: unknown) => push('PUT', p, b),
        patch: (p: string, b?: unknown) => push('PATCH', p, b),
        delete: (p: string) => push('DELETE', p),
    } as unknown as AimeatClient;
    return { client, sent };
}

/** One distinctive value per field, so its arrival on the wire can be found. */
const VALUE: Record<string, unknown> = {
    filename: 'shop.html', owner: 'alice', index: true, title: 'zqxtitle', description: 'zqxdesc', keywords: ['zqxkw'],
    image: 'https://x/zqximg.png', lang: 'fi', badge: false, install: true, kind: 'privacy', format: 'markdown',
    content: 'zqxcontent', remove: true, limit: 7, playtest: true, days: 9, on: true, geo: 'region', detail: ['zqxdetail'],
    layout: { v: 1, blocks: [] }, note: 'zqxnote', version: 3, name: 'zqxname', descriptions: { fi: 'zqxfi' }, parked: true,
    forkable: true, access_code: 'zqxcode', protection: { obfuscate: true }, screenshot: 'zqxb64', screenshot_mime_type: 'image/webp',
    subdomain: 'zqxsub', target: 'alice/shop.html', subdomain_kind: 'redirect', enabled: false, bundled_agent: 'zqxagent',
    runner_agent: 'zqxrunner', organism_id: 'zqxorg', values: { zqxfield: 'zqxvalue' },
    account: 'zqxacct', role: 'zqxrole', level: 4, offerings: ['zqxoff'], expires_at: '2027-01-02T03:04:05Z',
    roles: { zqxrole: ['zqxoff'] }, seats: { zqxrole: 2 }, terms: { zqxrole: { days: 30, renewal: 'manual' } },
    access: 'members-only', roster_visibility: 'members',
    email: 'zqx@example.com', locale: 'fi', q: 'zqxq', offset: 11, before: '2026-09-01T00:00:00Z', invite_id: 'zqxinv',
    manage_roles: ['zqxmgr'], year: '2026', keep: '12345', dev_level: 'publisher',
    markdown: '# zqxspec', expected_revision: 4,
};

/** Where each action goes: method and path. The body is checked field by field below. */
const EXPECT: Record<string, [string, string]> = {
    settings: ['PATCH', '/v1/apps/shop.html'],
    seo: ['PATCH', '/v1/apps/shop.html'],
    marks: ['PATCH', '/v1/apps/shop.html'],
    legal: ['PATCH', '/v1/apps/shop.html'],
    audit: ['GET', '/v1/apps/me/shop.html/audit?limit=7&playtest=true&archive=2026'],
    audit_archive: ['POST', '/v1/apps/me-owner/shop.html/audit/archive'],
    audit_keep: ['PUT', '/v1/audit/apps/settings'],
    versions: ['GET', '/v1/apps/alice/shop.html/versions'],
    lineage: ['GET', '/v1/apps/alice/shop.html/lineage'],
    screenshot: ['POST', '/v1/apps/alice/shop.html/screenshot/capture'],
    screenshot_upload: ['POST', '/v1/apps/alice/shop.html/screenshot'],
    screenshot_clear: ['DELETE', '/v1/apps/alice/shop.html/screenshot'],
    preview_link: ['POST', '/v1/apps/alice/shop.html/draft/preview-token'],
    visitors: ['GET', '/v1/apps/visitors?filename=shop.html&days=9'],
    visitors_measure: ['PUT', '/v1/apps/visitors/measurement'],
    ui_get: ['GET', '/v1/apps/me-owner/shop.html/ui?catalogue=index&detail=zqxdetail'],
    ui_set: ['PUT', '/v1/apps/me-owner/shop.html/ui'],
    ui_restore: ['POST', '/v1/apps/me-owner/shop.html/ui/restore'],
    config_get: ['GET', '/v1/apps/alice/shop.html/config'],
    config_set: ['PUT', '/v1/apps/me-owner/shop.html/config'],
    cost: ['GET', '/v1/apps/cost?app_id=alice%2Fshop.html'],
    agent_deploy: ['POST', '/v1/apps/alice/shop.html/agents/zqxagent/deploy'],
    agent_undeploy: ['POST', '/v1/apps/alice/shop.html/agents/zqxagent/undeploy'],
    agent_instances: ['GET', '/v1/apps/alice/shop.html/agents/zqxagent/instances'],
    agent_status: ['GET', '/v1/apps/alice/shop.html/agents/zqxagent/status?runner_agent=zqxrunner'],
    grants: ['GET', '/v1/app-grants'],
    backup_export: ['GET', '/v1/apps/backup?to=storage'],
    subdomain_list: ['GET', '/v1/admin/subdomains'],
    subdomain_set: ['PATCH', '/v1/admin/subdomains/zqxsub'],
    subdomain_delete: ['DELETE', '/v1/admin/subdomains/zqxsub'],
    members: ['GET', '/v1/apps/alice/shop.html/members?q=zqxq&limit=7&offset=11'],
    member_set: ['POST', '/v1/apps/alice/shop.html/members'],
    member_remove: ['DELETE', '/v1/apps/alice/shop.html/members/zqxacct'],
    member_decline: ['DELETE', '/v1/apps/alice/shop.html/members/requests/zqxacct'],
    member_dismiss: ['DELETE', '/v1/apps/alice/shop.html/members/seen/zqxacct'],
    member_plan_get: ['GET', '/v1/apps/alice/shop.html/members/plan'],
    member_plan_set: ['PUT', '/v1/apps/alice/shop.html/members/plan'],
    member_sweep: ['POST', '/v1/apps/alice/shop.html/members/sweep'],
    member_me: ['GET', '/v1/apps/alice/shop.html/members/me'],
    member_request: ['POST', '/v1/apps/alice/shop.html/members/requests'],
    member_audit: ['GET', '/v1/apps/alice/shop.html/members/audit?limit=7&before=2026-09-01T00%3A00%3A00Z'],
    member_invite_cancel: ['DELETE', '/v1/apps/alice/shop.html/members/invites/zqxinv'],
    // The development right has no owner field: its routes take the owner alone, so it is the caller.
    builders: ['GET', '/v1/apps/me-owner/shop.html/dev-grants'],
    builder_set: ['PUT', '/v1/apps/me-owner/shop.html/dev-grants/zqxacct'],
    builder_remove: ['DELETE', '/v1/apps/me-owner/shop.html/dev-grants/zqxacct'],
    // The design spec takes an owner: a builder reads and writes it on somebody else's app.
    spec: ['GET', '/v1/apps/alice/shop.html/design-spec'],
    spec_set: ['PUT', '/v1/apps/alice/shop.html/design-spec'],
    spec_clear: ['DELETE', '/v1/apps/alice/shop.html/design-spec'],
};

/** A field that travels in the path or query, or shapes the request rather than appearing in it. */
const IN_PATH = new Set(['filename', 'owner', 'bundled_agent', 'subdomain', 'limit', 'playtest', 'days', 'detail', 'runner_agent',
    'q', 'offset', 'before', 'invite_id', 'year']);

function fullInput(action: string): Record<string, unknown> {
    const input: Record<string, unknown> = { action };
    for (const f of Object.keys(APP_MANAGE_ACTIONS[action]!.fields)) input[f] = VALUE[f];
    // One legal page per call: `remove` and a format/content pair are two different requests.
    if (action === 'legal') delete input.remove;
    return input;
}

describe('aimeat_app_manage: every action reaches its endpoint with its fields', () => {
    it('covers every action in the table', () => {
        expect(Object.keys(EXPECT).sort()).toEqual([...APP_MANAGE_ACTION_NAMES].sort());
    });

    for (const action of APP_MANAGE_ACTION_NAMES) {
        it(action, async () => {
            const { client, sent } = recorder();
            const out = await appManageCall(client, 'me-owner', fullInput(action));
            expect(out.ok, JSON.stringify(out)).toBe(true);
            expect(sent[0]?.method).toBe(EXPECT[action]![0]);
            expect(sent[0]?.path).toBe(EXPECT[action]![1]);
            const wire = JSON.stringify(sent);
            for (const f of Object.keys(APP_MANAGE_ACTIONS[action]!.fields)) {
                if (IN_PATH.has(f) || (action === 'legal' && f === 'remove')) continue;
                // A layout travels merged with the note, so its own first key is what to look for.
                if (f === 'layout') { expect(wire, `${action}.layout`).toContain('"layout":{"v":1,"blocks":[]'); continue; }
                const v = VALUE[f];
                const probe = typeof v === 'string' ? v : JSON.stringify(v);
                expect(wire.includes(probe.replace(/^"|"$/g, '')) || wire.includes(`"${f}":${JSON.stringify(v)}`) || (f === 'subdomain_kind' && wire.includes('"kind":"redirect"')),
                    `${action}.${f} did not reach the wire: ${wire}`).toBe(true);
            }
        });
    }

    it('legal with remove sends remove inside the kind, and no kind reads the state', async () => {
        const a = recorder();
        await appManageCall(a.client, 'me', { action: 'legal', filename: 'shop.html', kind: 'terms', remove: true });
        expect(a.sent[0]).toEqual({ method: 'PATCH', path: '/v1/apps/shop.html', body: { legal: { terms: { remove: true } } } });
        const b = recorder();
        await appManageCall(b.client, 'me', { action: 'legal', filename: 'shop.html' });
        expect(b.sent[0]).toEqual({ method: 'GET', path: '/v1/apps/me/shop.html/legal', body: undefined });
    });

    it('legal and ui_set carry the provenance declaration in the body; the route records it', async () => {
        const declared = { level: 'ai-generated' };
        const a = recorder();
        await appManageCall(a.client, 'me', { action: 'ui_set', filename: 'shop.html', layout: { v: 1 }, ai_provenance: declared });
        expect((a.sent[0]!.body as Record<string, unknown>).ai_provenance).toEqual(declared);
    });

    it('member_set and member_plan_set send the route\'s own body, camelCase included', async () => {
        const a = recorder();
        await appManageCall(a.client, 'me', fullInput('member_set'));
        expect(a.sent[0]!.body).toEqual({
            account: 'zqxacct', email: 'zqx@example.com', locale: 'fi', role: 'zqxrole', level: 4, note: 'zqxnote', offerings: ['zqxoff'], days: 9,
            expiresAt: '2027-01-02T03:04:05Z',
        });
        const b = recorder();
        await appManageCall(b.client, 'me', fullInput('member_plan_set'));
        expect(b.sent[0]!.body).toEqual({
            roles: { zqxrole: ['zqxoff'] }, seats: { zqxrole: 2 }, terms: { zqxrole: { days: 30, renewal: 'manual' } },
            access: 'members-only', rosterVisibility: 'members', manageRoles: ['zqxmgr'],
        });
    });

    it('builder_set sends dev_level as the route\'s level, with the note, and needs a level', async () => {
        expect(checkAppManageInput({ action: 'builder_set', filename: 'shop.html', account: 'bob' }).ok).toBe(false);
        const { client, sent } = recorder();
        await appManageCall(client, 'me', fullInput('builder_set'));
        expect(sent[0]!.body).toEqual({ level: 'publisher', note: 'zqxnote' });
    });

    it('member_set takes an email instead of an account, and needs one of the two', async () => {
        expect(checkAppManageInput({ action: 'member_set', filename: 'shop.html', role: 'member' }).ok).toBe(false);
        const { client, sent } = recorder();
        await appManageCall(client, 'me', { action: 'member_set', filename: 'shop.html', email: 'bob@example.com', role: 'member' });
        expect(sent[0]).toEqual({ method: 'POST', path: '/v1/apps/me/shop.html/members', body: { email: 'bob@example.com', role: 'member' } });
    });

    it('members without search or paging sends no query', async () => {
        const { client, sent } = recorder();
        await appManageCall(client, 'me', { action: 'members', filename: 'shop.html' });
        expect(sent[0]).toEqual({ method: 'GET', path: '/v1/apps/me/shop.html/members', body: undefined });
    });

    it('member_set with an empty expires_at sends null, the route\'s "does not end"', async () => {
        const { client, sent } = recorder();
        await appManageCall(client, 'me', { action: 'member_set', filename: 'shop.html', account: 'bob', role: 'member', expires_at: '' });
        expect(sent[0]).toEqual({ method: 'POST', path: '/v1/apps/me/shop.html/members', body: { account: 'bob', role: 'member', expiresAt: null } });
    });

    it('member_request needs the owner of the app being asked, and sends the note alone', async () => {
        expect(checkAppManageInput({ action: 'member_request', filename: 'shop.html' }).ok).toBe(false);
        const { client, sent } = recorder();
        await appManageCall(client, 'me', { action: 'member_request', filename: 'shop.html', owner: 'carol', note: 'hi' });
        expect(sent[0]).toEqual({ method: 'POST', path: '/v1/apps/carol/shop.html/members/requests', body: { note: 'hi' } });
    });

    it('subdomain_set creates the entry when there is none to change', async () => {
        const { client, sent } = recorder(s => (s.method === 'PATCH' ? { ok: false, error: { code: 'NOT_FOUND', message: 'none' } } : { ok: true, data: {} }));
        const out = await appManageCall(client, 'me', { action: 'subdomain_set', subdomain: 'shop', target: 'alice/shop.html', subdomain_kind: 'app' });
        expect(out.ok).toBe(true);
        expect(sent.map(s => `${s.method} ${s.path}`)).toEqual(['PATCH /v1/admin/subdomains/shop', 'POST /v1/admin/subdomains']);
        expect(sent[1]!.body).toEqual({ subdomain: 'shop', target: 'alice/shop.html', kind: 'app' });
    });
});

describe('aimeat_app_manage: a wrong call is refused whole, before anything is sent', () => {
    it('names every missing and every foreign field in one answer', async () => {
        const { client, sent } = recorder();
        const out = await appManageCall(client, 'me', { action: 'visitors_measure', geo: 'city', layout: {}, badge: true });
        expect(sent).toEqual([]);
        expect(out.ok).toBe(false);
        expect(out.error?.code).toBe('INVALID_INPUT');
        expect(out.error?.message).toContain('is missing: filename, on');
        expect(out.error?.message).toContain('does not take: layout, badge');
        expect(out.error?.message).toContain('Its fields: filename (required), on (required), geo');
    });

    it('refuses an unknown action and lists the real ones', () => {
        const r = checkAppManageInput({ action: 'park' });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.message).toContain('settings');
    });

    it('settings needs something to change', () => {
        const r = checkAppManageInput({ action: 'settings', filename: 'shop.html' });
        expect(!r.ok && r.message).toContain('needs at least one of: name');
    });

    it('ignores the connector\'s own agent_name only when the surface says so', () => {
        expect(checkAppManageInput({ action: 'grants', agent_name: 'bot' }, ['agent_name']).ok).toBe(true);
        expect(checkAppManageInput({ action: 'grants', agent_name: 'bot' }).ok).toBe(false);
    });
});

describe('aimeat_app_manage: one table, three surfaces', () => {
    it('the zod shape and the catalog list the same fields', () => {
        const catalog = Object.keys(appManageTools[0]!.input).filter(f => !f.startsWith('ai_provenance')).sort();
        expect(Object.keys(appManageShape).sort()).toEqual(catalog);
        expect(Object.keys(APP_MANAGE_FIELDS).length + 1).toBe(catalog.length);
    });

    it('every action field is a declared field, and every action has its permission word', () => {
        for (const [action, spec] of Object.entries(APP_MANAGE_ACTIONS)) {
            for (const f of Object.keys(spec.fields)) expect(APP_MANAGE_FIELDS[f], `${action}.${f}`).toBeDefined();
            expect(action in TOOL_ACTION_SCOPES.aimeat_app_manage!).toBe(true);
        }
    });

    it('every permission word is one the owner can grant', () => {
        const vocabulary = readVocabulary(fileURLToPath(new URL('../..', import.meta.url)));
        for (const word of new Set(Object.values(TOOL_ACTION_SCOPES.aimeat_app_manage!).filter(Boolean))) {
            expect(vocabulary.has(word!), `${word} is not in the scope vocabulary`).toBe(true);
        }
    });

    it('the CLI dispatch carries the tool and sends through the same function', async () => {
        const def = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_app_manage');
        expect(def).toBeDefined();
        const { client, sent } = recorder();
        await def!.handler({ client, config: { owner: 'cli-owner' } as never, agentPath: '' }, { action: 'versions', filename: 'a.html' });
        expect(sent[0]?.path).toBe('/v1/apps/cli-owner/a.html/versions');
    });
});
