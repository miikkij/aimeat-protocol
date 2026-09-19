/**
 * @file scripts/cold-agent/report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Turns the records of a cold-agent run into the report a person reads, and compares
 *   two runs. The report answers four questions per task, in this order: did the agent get the
 *   person what they asked for, how much wandering did it take, where did it hit a wall, and what
 *   did it cost. Medians, not means: one run that thrashes for thirty turns should not hide that
 *   the other two took four.
 * @structure RunRecord · RunMeta · median() · renderReport() · compareReports()
 * @usage
 *   import { renderReport, compareReports } from './report.js';
 * @version-history
 *   2026-09-19 — The note of a FAILING run is printed too: what a build made instead is the thing
 *     worth reading.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunMetrics } from './transcript.js';
import type { Task } from './tasks.js';

export interface RunRecord {
    task: string;
    run: number;
    marker: string;
    ok: boolean;
    detail: string;
    /** What a passing run is worth knowing about, e.g. what the published app is like. */
    note?: string;
    /** Tools the run used that the task's `goodTools` does not name. A detour, not a failure. */
    wandered: string[];
    metrics: RunMetrics;
}

export interface RunMeta { stamp: string; driver: string; model: string; runs: number; arm: string; spentUsd: number }

export function median(values: number[]): number {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface TaskSummary { task: string; passed: number; runs: number; calls: number; errors: number; tokens: number; cost: number; first: string; wandered: string[]; walls: string[] }

function summarise(records: RunRecord[]): TaskSummary[] {
    const ids = [...new Set(records.map(r => r.task))];
    return ids.map((task) => {
        const rs = records.filter(r => r.task === task);
        const firsts = rs.map(r => r.metrics.firstTool ?? '(none)');
        const first = [...new Set(firsts)].sort((a, b) => firsts.filter(f => f === b).length - firsts.filter(f => f === a).length)[0];
        return {
            task,
            passed: rs.filter(r => r.ok).length,
            runs: rs.length,
            calls: median(rs.map(r => r.metrics.toolCalls.length)),
            errors: median(rs.map(r => r.metrics.errors)),
            tokens: median(rs.map(r => r.metrics.inputTokens + r.metrics.outputTokens + r.metrics.cacheReadTokens)),
            cost: median(rs.map(r => r.metrics.costUsd ?? 0)),
            first,
            wandered: [...new Set(rs.flatMap(r => r.wandered))],
            walls: [...new Set(rs.flatMap(r => r.metrics.toolCalls.filter(c => c.isError).map(c => `${c.name}: ${c.resultHead.replace(/\s+/g, ' ').slice(0, 140)}`)))],
        };
    });
}

export function renderReport(meta: RunMeta, records: RunRecord[], tasks: Task[]): string {
    const sums = summarise(records);
    const passed = records.filter(r => r.ok).length;
    const lines: string[] = [
        `# Cold agent run ${meta.stamp}`,
        '',
        `Arm **${meta.arm}** · driver ${meta.driver} · model ${meta.model} · ${meta.runs} run(s) per task · $${meta.spentUsd.toFixed(2)} spent`,
        '',
        `**${passed} of ${records.length} runs got the person what they asked for.**`,
        '',
        '| Task | Passed | Calls | Errors | Tokens | Cost | First tool |',
        '|---|---|---|---|---|---|---|',
        ...sums.map(s => `| ${s.task} | ${s.passed}/${s.runs} | ${s.calls} | ${s.errors} | ${Math.round(s.tokens)} | $${s.cost.toFixed(2)} | ${s.first} |`),
        '',
        'Calls, errors, tokens and cost are medians over the runs of a task.',
        '',
        '## Where it failed',
        '',
    ];
    // The skills suite: one row per skill, because the question is about the skill's description
    // and not about any one sentence.
    const skillRuns = records.filter(r => r.task.startsWith('skill:'));
    if (skillRuns.length) {
        const groups = [...new Set(skillRuns.map(r => r.task.split(':')[1]))];
        const head = lines.indexOf('## Where it failed');
        const table = [
            '## Skill triggering', '',
            'A skill row: how often the skill was loaded when a sentence called for it. The `none` row: how often the agent loaded no skill when none was needed.', '',
            '| Skill | Right | Rate |', '|---|---|---|',
            ...groups.map((g) => {
                const rs = skillRuns.filter(r => r.task.split(':')[1] === g);
                const ok = rs.filter(r => r.ok).length;
                return `| ${g} | ${ok}/${rs.length} | ${Math.round((ok / rs.length) * 100)} % |`;
            }),
            '',
        ];
        lines.splice(head, 0, ...table);
    }
    const failures = records.filter(r => !r.ok);
    if (!failures.length) lines.push('Nowhere.', '');
    for (const f of failures) lines.push(`- **${f.task}** #${f.run}: ${f.detail}. It said: "${f.metrics.finalText.replace(/\s+/g, ' ').slice(0, 220)}"`);
    // Failing runs as well: a build that published on the wrong track fails, and what it built
    // instead is the thing worth reading.
    const noted = records.filter(r => r.note);
    if (noted.length) {
        lines.push('', '## What the runs produced', '', 'A pass says the thing exists. This says what it is like, which is what two wordings of the same guidance are compared on.', '');
        for (const r of noted) lines.push(`- **${r.task}** #${r.run} (${r.ok ? 'pass' : 'FAIL'}): ${r.note}`);
    }
    lines.push('', '## Walls it hit', '', 'Every distinct error a tool call returned. Each one is a place where the node could have said what to do next.', '');
    const walls = sums.filter(s => s.walls.length);
    if (!walls.length) lines.push('None.', '');
    for (const s of walls) { lines.push(`- **${s.task}**`); for (const w of s.walls) lines.push(`  - ${w}`); }
    lines.push('', '## Detours', '', 'Tools a task used that a well-guided run would not need. A long list under a passing task is where guidance is thin.', '');
    for (const s of sums) {
        const good = tasks.find(t => t.id === s.task)?.goodTools ?? [];
        if (s.wandered.length) lines.push(`- **${s.task}** (expected ${good.join(', ') || 'no tool in particular'}): ${s.wandered.join(', ')}`);
    }
    return lines.join('\n') + '\n';
}

export function compareReports(dirA: string, dirB: string): string {
    const load = (d: string) => JSON.parse(readFileSync(join(d, 'results.json'), 'utf8')) as { meta: RunMeta; records: RunRecord[] };
    const a = load(dirA), b = load(dirB);
    const sa = summarise(a.records), sb = summarise(b.records);
    const delta = (x: number, y: number) => { const d = y - x; return d === 0 ? '=' : `${d > 0 ? '+' : ''}${Number.isInteger(d) ? d : d.toFixed(2)}`; };
    const lines = [
        `# ${a.meta.arm} (${a.meta.stamp}) → ${b.meta.arm} (${b.meta.stamp})`,
        '',
        `Model ${a.meta.model} → ${b.meta.model}. A difference inside one task's run-to-run spread is noise: read the pass counts first.`,
        '',
        '| Task | Passed | Calls | Errors | Tokens | Cost |',
        '|---|---|---|---|---|---|',
    ];
    for (const x of sa) {
        const y = sb.find(s => s.task === x.task);
        if (!y) continue;
        lines.push(`| ${x.task} | ${x.passed}/${x.runs} → ${y.passed}/${y.runs} | ${x.calls} → ${y.calls} (${delta(x.calls, y.calls)}) | ${x.errors} → ${y.errors} (${delta(x.errors, y.errors)}) | ${Math.round(x.tokens)} → ${Math.round(y.tokens)} | $${x.cost.toFixed(2)} → $${y.cost.toFixed(2)} |`);
    }
    return lines.join('\n') + '\n';
}
