/**
 * @file test/unit/cold-agent-bench.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds the Atelier build bench's own measures and texts: what a page wrote by hand is
 *   found by the patterns the app repository was measured with, a build's publishes and the node's
 *   errors are read from its tool calls in order, every brief's order carries the run's own facts
 *   and tells the session to ask nothing more, each brief's proofs separate a page that uses the
 *   platform part from one that does not, and the report names a spoiled run and a missing one.
 * @structure handMade · publishTrace · briefs · renderBenchReport · compareBench
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { handMade, handMadeCount, publishTrace } from '../../scripts/cold-agent/bench-measure.js';
import { BENCH_MCP_SERVER, BRIEFS, briefPrompt } from '../../scripts/cold-agent/bench-briefs.js';
import { compareBench, renderBenchReport, type BenchMeta, type BenchRun } from '../../scripts/cold-agent/bench-report.js';
import { parseTranscript, type ToolCall } from '../../scripts/cold-agent/transcript.js';

const call = (name: string, isError = false, resultHead = ''): ToolCall => ({ name, input: {}, isError, resultHead });

describe('handMade', () => {
    it('finds each of the six habits and counts them', () => {
        const page = [
            '<style>.x{color:red}</style>',
            '<script>',
            'function t(key) { return STR[lang][key]; }',
            'const el = (tag) => document.createElement(tag);',
            'function showToast(msg) { box.innerHTML = msg; }',
            'navigator.clipboard.writeText(text);',
            'function escapeHtml(s) { return s; }',
            'fetch(\'/v1/memory/\' + key);',
            '</script>',
        ].join('\n');
        const h = handMade(page);
        expect(h).toMatchObject({ ownT: true, ownEl: true, ownToast: true, ownClipboard: true, ownEsc: true, rawFetch: true, createElement: 1, innerHtml: 1 });
        expect(handMadeCount(h)).toBe(6);
        expect(h.styleChars).toBe('<style>.x{color:red}</style>'.length);
        expect(handMade('<script>function el(tag) { return 1; }</script>').ownEl).toBe(true);
    });

    it('does not count a function that passes the work on to the kit', () => {
        // The three shapes the first baseline round's pages had, each counted as by hand at first.
        const alias = handMade('<script>var i18n = AIMEAT.atelier.i18n; var t = function (k, v) { return i18n.t(k, v); };</script>');
        const wrapper = handMade('<script>function t(key, vars) {\n  var s = i18n.t(key);\n  if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });\n  return s;\n}</script>');
        const toast = handMade('<script>function failToast(err) {\n  A.toast({ title: t("failed"), sub: String(err), tone: "err" });\n}</script>');
        const store = handMade('<script>async function saveList(items) { await AIMEAT.data.set("errands.list", items); }</script>');
        expect([alias.ownT, wrapper.ownT, toast.ownToast]).toEqual([false, false, false]);
        expect(handMadeCount(store)).toBe(0);
        // One own function among aliases is still found.
        expect(handMade('<script>function t(k) { return i18n.t(k); }\nfunction showToast(m) { document.title = m; }</script>')).toMatchObject({ ownT: false, ownToast: true });
    });

    it('answers nothing for a page that calls the kit', () => {
        const h = handMade('<script>var a = AIMEAT.atelier.app({ title: "Errands" }); AIMEAT.atelier.toast("Saved"); AIMEAT.data.set("errands.list", []);</script>');
        expect(handMadeCount(h)).toBe(0);
        expect(h.styleShare).toBe(0);
        expect(handMadeCount(handMade(''))).toBe(0);
    });
});

describe('publishTrace', () => {
    it('reads the publishes, the errors and their codes in order', () => {
        const t = publishTrace([
            call('ToolSearch'),
            call('aimeat_handbook_get'),
            call('aimeat_app_manage', true, '{"success":false,"error":{"code":"INVALID_INPUT","message":"…"}}'),
            call('Write'),
            call('aimeat_app_publish', true, 'Error: APP_OWES_ITEMS the app owes a design spec'),
            call('Bash', true, '{"success":false,"error":{"code":"VALIDATION_ERROR"}}'),
            call('Bash', true, 'Error: command not found'),
            call('aimeat_app_draft_publish'),
            call('aimeat_app_get', true, 'App "x.html" not found'),
        ]);
        expect(t.publishAttempts).toBe(2);
        expect(t.publishRefusals).toEqual(['APP_OWES_ITEMS']);
        expect(t.refusals).toEqual(['aimeat_app_manage: INVALID_INPUT', 'aimeat_app_publish: APP_OWES_ITEMS', 'aimeat_app_get: App "x.html" not found']);
        expect(t.shellRefusals).toEqual(['VALIDATION_ERROR']);
        expect(t.callsBeforeFirstPublish).toBe(2);
        expect(t.nodeCalls).toBe(5);
        expect(t.allCalls).toBe(9);
    });

    it('says so when the build never tried to publish', () => {
        expect(publishTrace([call('aimeat_handbook_get')]).callsBeforeFirstPublish).toBeNull();
    });
});

describe('the briefs', () => {
    it('are five, each with an id of its own and at least one proof', () => {
        expect(BRIEFS.map(b => b.id)).toEqual(['list', 'team', 'map', 'game', 'page']);
        for (const b of BRIEFS) expect(b.proves.length).toBeGreaterThan(0);
    });

    it('write an order that carries the node, the connection, the name and that nothing more is asked', () => {
        const team = BRIEFS.find(b => b.id === 'team')!;
        const text = briefPrompt(team, { baseUrl: 'http://localhost:40601', marker: 'kb-abc123', org: 'Harbour Street Residents kb-abc123' });
        expect(text).toContain('http://localhost:40601');
        expect(text).toContain(`"${BENCH_MCP_SERVER}"`);
        expect(text).toContain('Call it "Tool shed kb-abc123".');
        expect(text).toContain('my organism "Harbour Street Residents kb-abc123"');
        expect(text).toContain('Do not ask me anything more.');
        expect(text).not.toContain('{org}');
    });

    it('prove the platform part each order needs, and not a page without it', () => {
        const unread = { openTo: null, signedOutDraws: null };
        const proves = (id: string, html: string, app: { openTo: string | null; signedOutDraws: boolean | null } = unread) => BRIEFS.find(b => b.id === id)!.proves.map(p => p.test(html, app));
        expect(proves('list', '<script src="/v1/libs/aimeat-data.js"></script><script>A.data.set("k", 1)</script>')).toEqual([true]);
        expect(proves('list', '<script>localStorage.setItem("k", 1)</script>')).toEqual([false]);
        // A page calls the data library by a name of its own, as the fourth round's map app did.
        expect(proves('list', '<script src="/v1/libs/aimeat-data.js"></script><script>var D = window.AIMEAT.data; D.set("k", 1)</script>')).toEqual([true]);
        expect(proves('list', '<script src="/v1/libs/aimeat-data.js"></script><script>var D = window.AIMEAT.data; cache.set("k", 1)</script>')).toEqual([false]);
        // The team's list is shared in a workspace or in an extension's namespace, and never in each person's own memory.
        expect(proves('team', '<script>AIMEAT.atelier.workspacePicker({ target })</script>', { openTo: 'organism:abc', signedOutDraws: false })).toEqual([true, true]);
        expect(proves('team', '<script>AIMEAT.data.action("toolshed", "borrow", { id })</script>', { openTo: 'organism:abc', signedOutDraws: false })).toEqual([true, true]);
        expect(proves('team', '<script src="/v1/libs/aimeat-data.js"></script><script>AIMEAT.data.set("tools", [])</script>', { openTo: 'anyone', signedOutDraws: true })).toEqual([false, false]);
        expect(proves('map', '<script src="/lib/leaflet/leaflet.js"></script><script src="/v1/libs/aimeat-data.js"></script><script>L.polygon(p); L.polyline(r); A.data.set("k", 1)</script>')).toEqual([true, true, true]);
        expect(proves('map', '<script>AIMEAT.atelier.map({ pins })</script>')).toEqual([true, false, false]);
        expect(proves('game', '<script src="/v1/libs/aimeat-phaser.js"></script><div id="leaderboard"></div>')).toEqual([true, true]);
        expect(proves('game', '<canvas></canvas>')).toEqual([false, false]);
        // Whether a page opens signed out is the node's fact: a genre fork has no shell call to read it from.
        expect(proves('page', '<script src="/v1/libs/aimeat-intake.js"></script><script src="/v1/libs/aimeat-boot.js"></script>', { openTo: 'anyone', signedOutDraws: true })).toEqual([true, true]);
        expect(proves('page', '<script src="/v1/libs/aimeat-intake.js"></script>', { openTo: 'anyone', signedOutDraws: null })).toEqual([true, true]);
        expect(proves('page', '<script src="/v1/libs/aimeat-intake.js"></script>', { openTo: 'anyone', signedOutDraws: false })).toEqual([false, true]);
        expect(proves('page', '<script>AIMEAT.atelier.app({ title: "Open day", requireLogin: false })</script>', { openTo: 'signed-in', signedOutDraws: null })).toEqual([false, false]);
    });
});

const meta = (round: string): BenchMeta => ({ round, auditedAt: '2026-11-27T12:00:00.000Z', repoCommit: 'abc1234', nodeCommits: ['abc1234'], model: 'claude-opus-5-5' });
function run(over: Partial<BenchRun>): BenchRun {
    return {
        brief: 'list', task: 'list', run: 1, marker: 'kb-abc123', ok: true, detail: 'Published as errands.html: an Atelier app that holds every proof of the brief.', wandered: [],
        metrics: { ...parseTranscript(''), outputTokens: 1000, finished: true },
        session: { sessions: 1, model: 'claude-opus-5-5', humanTurns: 1, wallMs: 600_000, apiMs: 240_000, toolMs: 60_000, servers: { [BENCH_MCP_SERVER]: 12 }, builtins: { Write: 2 }, cacheCreationTokens: 0, startedAt: null, endedAt: null },
        trace: { publishAttempts: 2, publishRefusals: ['APP_OWES_ITEMS'], refusals: ['aimeat_app_publish: APP_OWES_ITEMS'], shellRefusals: [], callsBeforeFirstPublish: 9, nodeCalls: 12, allCalls: 14 },
        hand: handMade('<script>function t(k) { return k; }</script>'),
        proofs: [{ what: 'keeps the errands on the node', ok: true }],
        versions: 2, behind: [], agentFace: true, boundSkills: 1, kitComponents: ['list', 'form'], buildNotes: { took: 2, passed: 1, made: 3 },
        blocking: [], warnings: [], playtest: { ran: true, ok: true, failed: [], consoleErrors: 0 }, foreignServers: [],
        ...over,
    };
}

describe('renderBenchReport', () => {
    it('gives one row per brief with the numbers two rounds are compared on', () => {
        const text = renderBenchReport(meta('r1'), [run({})]);
        expect(text).toContain('**1 of 1 builds gave the person the app they ordered.**');
        expect(text).toContain('| list | pass | 1 | 5.0 | 10.0 | 12 | 14 | 1 | 2 | 2 | 1000 | 1/6 | 2 / 1 / 3 | 2 | ok |');
        expect(text).toContain('9 node calls before the first publish; 2 publish call(s), 1 refused (APP_OWES_ITEMS)');
        expect(text).toContain('by hand: ownT;');
    });

    it('names a spoiled run and a brief with no session', () => {
        const text = renderBenchReport(meta('r1'), [
            run({ ok: false, foreignServers: ['claude_ai_AIMEAT'] }),
            run({ brief: 'map', task: 'map', missing: true, ok: false, session: null, trace: null, hand: null }),
        ]);
        expect(text).toContain('**0 of 1 builds gave the person the app they ordered.** 1 brief(s) have no session yet.');
        expect(text).toContain('SPOILED: the session called claude_ai_AIMEAT');
        expect(text).toContain('| map | no session |');
    });
});

describe('compareBench', () => {
    it('puts two rounds side by side and leaves out a brief one of them lacks', () => {
        const after = run({ hand: handMade(''), trace: { ...run({}).trace!, nodeCalls: 8, refusals: [] }, buildNotes: { took: 4, passed: 0, made: 1 } });
        const text = compareBench({ meta: meta('r1'), runs: [run({}), run({ brief: 'map', task: 'map' })] }, { meta: meta('r2'), runs: [after] });
        expect(text).toContain('# Atelier build bench: r1 → r2');
        expect(text).toContain('| list | pass | 1 | 5.0 | 12 → 8 | 1 → 0 | 1000 | 1 → 0 | 3 → 1 | 2 | ok |');
        expect(text).not.toContain('| map |');
    });
});
