/**
 * @file scripts/cold-agent/bench-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Turns the audited runs of one Atelier build bench round into the report a person
 *   reads, and compares two rounds brief by brief. Pure: records in, text out.
 *
 *   The report answers, per brief and in this order: did the person get the app they ordered, how
 *   much of their time and the model's did it take, where did the node stop the build, and how
 *   much of the page was written by hand although the node serves it.
 *
 *   ONE RUN PER BRIEF IS ONE OBSERVATION. Two identical headless runs of one task cost $0.27 and
 *   $0.72 on 2026-09-13. A difference between two rounds counts when it shows in most briefs, or
 *   when the round ran each brief more than once.
 * @structure BenchRun · BenchMeta · renderBenchReport() · compareBench()
 * @usage
 *   import { renderBenchReport, compareBench } from './bench-report.js';
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import type { HandMade, PublishTrace } from './bench-measure.js';
import { handMadeCount } from './bench-measure.js';
import type { SessionFacts } from './session-transcript.js';
import type { RunRecord } from './report.js';

/** One audited build: the cold-agent record, and the facts only the bench reads. */
export interface BenchRun extends RunRecord {
    brief: string;
    /** No transcript was found for the run folder: the session has not been run, or ran elsewhere. */
    missing?: boolean;
    session: SessionFacts | null;
    trace: PublishTrace | null;
    hand: HandMade | null;
    /** The brief's own proofs, each with whether the published page holds it. */
    proofs: Array<{ what: string; ok: boolean }>;
    /** Published versions of the app on the node. */
    versions: number | null;
    /** What beside the app is missing or behind, as the node's freshness answer names it. */
    behind: string[];
    agentFace: boolean | null;
    boundSkills: number | null;
    kitComponents: string[];
    buildNotes: { took: number; passed: number; made: number } | null;
    blocking: string[];
    warnings: string[];
    /** The node's own browser run of the published app; null when it was not asked for. */
    playtest: { ran: boolean; ok: boolean; failed: string[]; consoleErrors: number; reason?: string } | null;
    /** MCP servers the session called other than the bench's own node. Any entry spoils the run. */
    foreignServers: string[];
}

export interface BenchMeta { round: string; auditedAt: string; repoCommit: string; nodeCommits: string[]; model: string | null }

const min = (ms: number | null | undefined): string => (ms === null || ms === undefined ? '-' : (ms / 60000).toFixed(1));
const yes = (b: boolean | null | undefined): string => (b === null || b === undefined ? '-' : b ? 'yes' : 'NO');

export function renderBenchReport(meta: BenchMeta, runs: BenchRun[]): string {
    const done = runs.filter(r => !r.missing);
    const lines: string[] = [
        `# Atelier build bench, round ${meta.round}`,
        '',
        `Audited ${meta.auditedAt} · bench at ${meta.repoCommit} · node at ${[...new Set(meta.nodeCommits)].join(', ') || '-'} · model ${meta.model ?? '-'}`,
        '',
        `**${done.filter(r => r.ok).length} of ${done.length} builds gave the person the app they ordered.**`
            + (runs.length > done.length ? ` ${runs.length - done.length} brief(s) have no session yet.` : ''),
        '',
        '| Brief | Pass | Person spoke | Worked min | Wall min | Node calls | All calls | Node errors | Publishes | Versions | Output tokens | By hand | Took / passed / made | Kit parts | Playtest |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of runs) {
        if (r.missing) { lines.push(`| ${r.brief} | no session | | | | | | | | | | | | | |`); continue; }
        const worked = r.session?.apiMs === null || r.session?.apiMs === undefined ? null : r.session.apiMs + (r.session.toolMs ?? 0);
        lines.push(`| ${r.brief} | ${r.ok ? 'pass' : 'FAIL'} | ${r.session?.humanTurns ?? '-'} | ${min(worked)} | ${min(r.session?.wallMs)} | ${r.trace?.nodeCalls ?? '-'} | ${r.trace?.allCalls ?? '-'} `
            + `| ${r.trace?.refusals.length ?? '-'} | ${r.trace?.publishAttempts ?? '-'} | ${r.versions ?? '-'} | ${r.metrics.outputTokens} | ${r.hand ? `${handMadeCount(r.hand)}/7` : '-'} `
            + `| ${r.buildNotes ? `${r.buildNotes.took} / ${r.buildNotes.passed} / ${r.buildNotes.made}` : 'none written'} | ${r.kitComponents.length} | ${r.playtest ? (r.playtest.ran ? (r.playtest.ok ? 'ok' : `${r.playtest.failed.length} failed`) : 'not run') : '-'} |`);
    }
    lines.push('',
        'Person spoke: how many messages the person wrote, the order included. Worked: the model\'s time plus the tools\' time, as the client counted it. '
        + 'Node errors: node tool calls that came back as an error, a refusal or an answer too large for the client. By hand: how many of seven habits the page has (its own translation function, DOM helper, toast, clipboard call, HTML escape, direct REST call, storage wrapper).',
        '');

    for (const r of done) {
        lines.push(`## ${r.brief}: ${r.ok ? 'pass' : 'FAIL'}`, '', r.detail, '');
        for (const p of r.proofs) lines.push(`- ${p.ok ? 'holds' : 'DOES NOT HOLD'}: ${p.what}`);
        if (r.foreignServers.length) lines.push(`- SPOILED: the session called ${r.foreignServers.join(', ')}, which is not the bench's node. Run this brief again.`);
        if (r.blocking.length) lines.push(`- publish lint, blocking: ${r.blocking.join(', ')}`);
        if (r.warnings.length) lines.push(`- publish lint, warnings: ${r.warnings.join(', ')}`);
        if (r.trace?.refusals.length) { lines.push('- node tool calls that came back as an error:'); for (const w of r.trace.refusals) lines.push(`  - ${w}`); }
        if (r.trace?.shellRefusals.length) lines.push(`- the node refused a shell command's request: ${r.trace.shellRefusals.join(', ')}`);
        if (r.trace) lines.push(`- ${r.trace.callsBeforeFirstPublish === null ? 'never tried to publish' : `${r.trace.callsBeforeFirstPublish} node calls before the first publish`}; ${r.trace.publishAttempts} publish call(s), ${r.trace.publishRefusals.length} refused${r.trace.publishRefusals.length ? ` (${r.trace.publishRefusals.join(', ')})` : ''}`);
        if (r.hand) {
            const habits = (['ownT', 'ownEl', 'ownToast', 'ownClipboard', 'ownEsc', 'rawFetch', 'dataWrapper'] as const).filter(k => r.hand![k]);
            lines.push(`- by hand: ${habits.join(', ') || 'none of the seven'}; createElement ${r.hand.createElement}, innerHTML ${r.hand.innerHtml}, own styles ${Math.round(r.hand.styleShare * 100)} % of the page`);
        }
        lines.push(`- kit parts: ${r.kitComponents.join(' ') || 'none'}`);
        lines.push(`- beside the app: agent face ${yes(r.agentFace)}, bound skills ${r.boundSkills ?? '-'}${r.behind.length ? `; behind: ${r.behind.join('; ')}` : '; nothing behind'}`);
        if (r.playtest) {
            lines.push(r.playtest.ran
                ? `- playtest: ${r.playtest.ok ? 'ok' : `failed ${r.playtest.failed.join('; ')}`}; ${r.playtest.consoleErrors} console error(s)`
                : `- playtest did not run: ${r.playtest.reason ?? 'no reason given'}`);
        }
        if (r.session) {
            const builtins = Object.entries(r.session.builtins).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ');
            lines.push(`- client tools: ${builtins || 'none'}; ${r.session.sessions} transcript file(s); ${r.metrics.finished ? 'the session ended by itself' : 'the session did not end by itself'}`);
        }
        if (r.note) lines.push(`- the page: ${r.note}`);
        if (r.metrics.finalText) lines.push(`- it said last: "${r.metrics.finalText.replace(/\s+/g, ' ').slice(0, 300)}"`);
        lines.push('');
    }
    return lines.join('\n') + '\n';
}

/** Two rounds side by side, brief by brief. A brief one round lacks is left out. */
export function compareBench(a: { meta: BenchMeta; runs: BenchRun[] }, b: { meta: BenchMeta; runs: BenchRun[] }): string {
    const worked = (r: BenchRun): number | null => (r.session?.apiMs === null || r.session?.apiMs === undefined ? null : r.session.apiMs + (r.session.toolMs ?? 0));
    const arrow = (x: string | number, y: string | number): string => (x === y ? `${x}` : `${x} → ${y}`);
    const lines = [
        `# Atelier build bench: ${a.meta.round} → ${b.meta.round}`,
        '',
        `Node ${[...new Set(a.meta.nodeCommits)].join(', ') || '-'} → ${[...new Set(b.meta.nodeCommits)].join(', ') || '-'} · model ${a.meta.model ?? '-'} → ${b.meta.model ?? '-'}`,
        '',
        'One build per brief is one observation: read a change as real when most briefs show it.',
        '',
        '| Brief | Pass | Person spoke | Worked min | Node calls | Node errors | Output tokens | By hand | Made | Kit parts | Playtest |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const x of a.runs) {
        const y = b.runs.find(r => r.brief === x.brief);
        if (!y || x.missing || y.missing) continue;
        const play = (r: BenchRun): string => (r.playtest ? (r.playtest.ran ? (r.playtest.ok ? 'ok' : 'failed') : 'not run') : '-');
        lines.push(`| ${x.brief} | ${arrow(x.ok ? 'pass' : 'FAIL', y.ok ? 'pass' : 'FAIL')} | ${arrow(x.session?.humanTurns ?? '-', y.session?.humanTurns ?? '-')} `
            + `| ${arrow(min(worked(x)), min(worked(y)))} | ${arrow(x.trace?.nodeCalls ?? '-', y.trace?.nodeCalls ?? '-')} | ${arrow(x.trace?.refusals.length ?? '-', y.trace?.refusals.length ?? '-')} `
            + `| ${arrow(x.metrics.outputTokens, y.metrics.outputTokens)} | ${arrow(x.hand ? handMadeCount(x.hand) : '-', y.hand ? handMadeCount(y.hand) : '-')} `
            + `| ${arrow(x.buildNotes?.made ?? '-', y.buildNotes?.made ?? '-')} | ${arrow(x.kitComponents.length, y.kitComponents.length)} | ${arrow(play(x), play(y))} |`);
    }
    return lines.join('\n') + '\n';
}
