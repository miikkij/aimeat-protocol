/**
 * @file test/unit/field-reach.test.ts
 * @description Proof that the field-reach join catches the shape it exists for, without CodeQL: the
 *   facts are written by hand in the CSV form `codeql bqrs decode` produces, and the join, the path
 *   matcher and the CSV reader are the real ones.
 *
 *   THE FAIL-FIRST MEASUREMENT, recorded because a green test says nothing about what it prevents.
 *   On 2026-09-14 the same facts from the real tree were joined BY NAME first: a record field counted
 *   as agent-reachable when any tool declared it. organism_id did not appear, because dozens of
 *   workspace tools take a parameter of that name. The case below keeps that condition
 *   (aimeat_workspace_read declares organism_id) and asserts the door join still reports the field
 *   on PUT /v1/companies/:id, which is Kalle's report.
 * @usage cd aimeat && pnpm exec vitest run test/unit/field-reach.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-14 — Written with field-reach.ts v2 (wish-kenttien-tavoitettavuus-portiksi).
 */
import { describe, it, expect } from 'vitest';
import { doorReach, pathMatches, canonical, isPlumbing, GENERIC_CALLERS } from '../../scripts/inventory/field-reach.js';
import { factsFromCsv, parseCsv } from '../../scripts/inventory/field-reach-facts.js';

const csv = (header: string, rows: string[][]): string =>
    [header, ...rows.map(r => r.map(c => /^\d+$/.test(c) ? c : `"${c.replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';

const ROUTE_UPDATE = 'src/routes/companies.ts:249:91';
const ROUTE_SMTP = 'src/routes/companies.ts:337:91';
const TOOL_UPDATE = 'src/mcp/companies.ts:156:9';
const TOOL_WORKSPACE = 'src/mcp/workspaces.ts:40:9';
const CONNECTOR_UPDATE = 'src/cli/connect/mcp/tools/companies.ts:95:47';
const SERVICE_UPDATE = 'src/services/company/company-service.ts#134';
const EVENT_BUS = 'src/services/event-bus.ts#44';

function facts(extra: { calls?: string[][]; tools?: string[][]; http?: string[][] } = {}) {
    return factsFromCsv({
        reads: csv('"kind","field","naming","file","line","handler"', [
            ['body', 'organism_id', 'resolved', 'src/routes/companies.ts', '134', ROUTE_UPDATE],
            ['body', 'business_id', 'resolved', 'src/routes/companies.ts', '134', ROUTE_UPDATE],
            ['body', 'from_address', 'constant', 'src/routes/companies.ts', '346', ROUTE_SMTP],
            ['body', '', 'unnamed', 'src/routes/organisms/intake.ts', '282', 'src/routes/organisms/intake.ts:250:60'],
        ]),
        routes: csv('"handler","method","path"', [
            [ROUTE_UPDATE, 'PUT', '/v1/companies/:id'],
            [ROUTE_SMTP, 'PUT', '/v1/companies/:id/smtp'],
        ]),
        tools: csv('"surface","name","handler"', [
            ['mcp.node', 'aimeat_company_update', TOOL_UPDATE],
            ['mcp.node', 'aimeat_workspace_read', TOOL_WORKSPACE],
            ...(extra.tools ?? []),
        ]),
        calls: csv('"unitName","callee"', [
            [ROUTE_UPDATE, SERVICE_UPDATE],
            [TOOL_UPDATE, SERVICE_UPDATE],
            ...(extra.calls ?? []),
        ]),
        http: csv('"unitName","method","path"', extra.http ?? []),
    });
}

const FIELDS = new Map([
    ['organismId', ['CompanyRecord', 'WorkspaceRowRecord']],
    ['businessId', ['CompanyRecord']],
    ['fromAddress', ['CompanySmtpRecord']],
]);

const declared = (update: string[]) => ({
    'mcp.node': new Map([
        ['aimeat_company_update', update],
        ['aimeat_workspace_read', ['organism_id', 'ws']],
    ]),
    'mcp.connector': new Map([['aimeat_company_update', ['company_id', 'business_id', 'organism_id']]]),
    'cli.dispatch': new Map<string, string[]>(),
});

describe('field reach, door by door', () => {
    it("reports organism_id on PUT /v1/companies/:id even though another tool takes a parameter of that name (Kalle's report)", () => {
        const m = doorReach(FIELDS, facts(), declared(['company_id', 'name', 'business_id']));
        const keys = m.findings.map(f => f.key);
        expect(keys).toContain('rest-only:organismId PUT /v1/companies/:id');
        expect(keys).not.toContain('rest-only:businessId PUT /v1/companies/:id');
        const door = m.doors.find(d => d.route === 'PUT /v1/companies/:id')!;
        expect(door.twins).toEqual(['mcp.node:aimeat_company_update']);
    });

    it('stops reporting it once the twin declares the field', () => {
        const m = doorReach(FIELDS, facts(), declared(['company_id', 'name', 'business_id', 'organism_id']));
        expect(m.findings.map(f => f.key)).not.toContain('rest-only:organismId PUT /v1/companies/:id');
    });

    it('does not make a twin out of plumbing every tool calls', () => {
        const busCallers = Array.from({ length: GENERIC_CALLERS + 1 }, (_, i) => [`src/mcp/t${i}.ts:1:1`, EVENT_BUS]);
        const busTools = busCallers.map(([h], i) => ['mcp.node', `aimeat_t${i}`, h]);
        const m = doorReach(FIELDS, facts({
            calls: [[ROUTE_SMTP, EVENT_BUS], [TOOL_WORKSPACE, EVENT_BUS], ...busCallers],
            tools: busTools,
        }), declared(['company_id']));
        expect(m.generic.map(([c]) => c)).toContain(EVENT_BUS);
        expect(m.findings.map(f => f.key)).toContain('no-twin:PUT /v1/companies/:id/smtp');
    });

    it('pairs a connector tool with the route its REST call matches, and lends it its declared input', () => {
        const m = doorReach(FIELDS, facts({
            tools: [['mcp.connector', 'aimeat_company_update', CONNECTOR_UPDATE]],
            http: [[CONNECTOR_UPDATE, 'PUT', '/v1/companies/*']],
        }), declared(['company_id', 'business_id']));
        const door = m.doors.find(d => d.route === 'PUT /v1/companies/:id')!;
        expect(door.twins).toContain('mcp.connector:aimeat_company_update');
        expect(m.findings.map(f => f.key)).not.toContain('rest-only:organismId PUT /v1/companies/:id');
    });

    it('holds a read it cannot name as a blind spot of its file', () => {
        const m = doorReach(FIELDS, facts(), declared([]));
        expect([...m.blind.unnamed.keys()]).toEqual(['src/routes/organisms/intake.ts']);
    });
});

describe('pathMatches', () => {
    it('reads a hole after a slash as one segment', () => {
        expect(pathMatches('/v1/companies/*', '/v1/companies/:id')).toBe(true);
        expect(pathMatches('/v1/companies/*', '/v1/companies/:id/smtp')).toBe(false);
    });
    it('reads a hole after literal text as a query string', () => {
        expect(pathMatches('/v1/agents/*/activity*', '/v1/agents/:name/activity')).toBe(true);
    });
    it('matches nothing when the literal part stops before the first real segment', () => {
        expect(pathMatches('/v1/*', '/v1/companies')).toBe(false);
        expect(pathMatches('*', '/v1/companies')).toBe(false);
    });
    it('never lets a computed segment stand for a literal one', () => {
        expect(pathMatches('/v1/organisms/*/*', '/v1/organisms/:id/approvals')).toBe(false);
        expect(pathMatches('/v1/agents/me/tasks', '/v1/agents/:name/tasks')).toBe(true);
    });
});

describe('isPlumbing', () => {
    it('sets aside lookups and utilities, and keeps services and writes', () => {
        expect(isPlumbing('storage.getAgent')).toBe(true);
        expect(isPlumbing('src/utils/gaii.ts#80')).toBe(true);
        expect(isPlumbing('storage.updateCompany')).toBe(false);
        expect(isPlumbing('src/services/company/company-service.ts#134')).toBe(false);
    });
});

describe('the CodeQL CSV', () => {
    it('reads quoted cells with commas and doubled quotes', () => {
        expect(parseCsv('"a","b"\n"x, y","say ""hi"""\n')).toEqual([['x, y', 'say "hi"']]);
    });
    it('refuses a row it does not understand rather than dropping it', () => {
        expect(() => factsFromCsv({
            reads: '"kind","field","naming","file","line","handler"\n"header","x","constant","f",1,"h"\n',
            routes: '"h","m","p"\n', tools: '"s","n","h"\n', calls: '"u","c"\n', http: '"u","m","p"\n',
        })).toThrow(/does not understand/);
    });
    it('treats spellings as one field', () => {
        expect(canonical('organism_id')).toBe(canonical('organismId'));
    });
});
