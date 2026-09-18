/**
 * @file scripts/cold-agent/run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Gives a cold agent real tasks on a sandbox node, reads what it did, and reports
 *   whether it got where a person needed it to go, at what cost.
 *
 *   WHY. Anthropic's own advice on tools for agents is a loop: hand the agent realistic tasks,
 *   read its transcripts, fix where it wanders, repeat. Until 2026-09-18 this project judged its
 *   agent-facing text by reading it. That finds what is false; it does not find that an agent
 *   told to "call the handbook first" then spends six calls in a REST boot sequence. This runner
 *   is the measurement every later change to a prompt, a skill, a tool description or an error
 *   message is held against: run it before, run it after, read the difference.
 *
 *   COLD means the agent knows nothing we did not serve it. It runs in an empty directory with no
 *   CLAUDE.md, no project settings, no skills of ours and no memory, and on the `mcp` door the
 *   only MCP server is the sandbox node. What it learns, it learns from the node.
 *
 *   ONE RUN PROVES NOTHING. Two identical headless runs of one task cost $0.27 and $0.72 on
 *   2026-09-13, so every task runs `--runs` times (3 by default) and the report gives the pass
 *   rate and the medians.
 *
 *   ARMS. `--arm <file.json>` applies a set of managed-prompt overrides to the sandbox before the
 *   run and restores the shipped text afterwards, so the same tasks can be run against a calmer
 *   build-app, a shorter handbook or a composed brief, and compared with `--compare`.
 *
 *   IT SPENDS MONEY. The default driver is the `claude` CLI in print mode, and every run is a
 *   model session. Each session is held to `--max-budget-usd`, and the runner starts no new
 *   session once `--max-total-usd` is reached. `--driver scripted` spends nothing: it
 *   performs each task over MCP by hand, to prove the verifiers and the report, not the agent.
 * @structure parseArgs · loadSandbox · applyArm/restoreArm · autoApprove · drivers (claude,
 *   scripted) · runOne · main
 * @usage
 *   cd aimeat && pnpm sandbox                                  # the node the agent meets
 *   cd aimeat && pnpm cold-agent --driver scripted             # free: proves the harness
 *   cd aimeat && pnpm cold-agent --model sonnet --runs 3 --max-total-usd 15
 *   cd aimeat && pnpm cold-agent --tasks remember,build-app --arm arms/calm-build-app.json
 *   cd aimeat && pnpm cold-agent --compare .cold-agent/<a> .cold-agent/<b>
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial (wish-kylm-agentti-ja-oikea-teht-v-mittaus-...).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS, api, type Task, type TaskContext } from './tasks.js';
import { parseTranscript, type RunMetrics } from './transcript.js';
import { compareReports, renderReport, type RunRecord } from './report.js';
import { scriptedTranscript } from './scripted.js';
import { skillTasks } from './skill-cases.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Args {
    driver: 'claude' | 'scripted';
    /** `tasks`: did the person get what they asked for. `skills`: did the right skill get loaded. */
    suite: 'tasks' | 'skills';
    model: string;
    runs: number;
    tasks: string[] | null;
    arm: string | null;
    /** The ceiling for ONE session. The CLI stops the session when it is reached. */
    maxBudgetUsd: number;
    maxTotalUsd: number;
    /** The `claude` program. A path when it is not on PATH, as with the VS Code extension's copy. */
    claudeCmd: string;
    compare: [string, string] | null;
}

function parseArgs(argv: string[]): Args {
    const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
    const ci = argv.indexOf('--compare');
    const suite = get('suite') === 'skills' ? 'skills' : 'tasks';
    return {
        driver: get('driver') === 'scripted' ? 'scripted' : 'claude',
        suite,
        model: get('model') ?? 'sonnet',
        runs: Number(get('runs') ?? 3),
        tasks: get('tasks')?.split(',') ?? null,
        arm: get('arm') ?? null,
        // A skill case measures the decision to load, which happens in the first few turns.
        maxBudgetUsd: Number(get('max-budget-usd') ?? (suite === 'skills' ? 0.5 : 1.5)),
        claudeCmd: get('claude-cmd') ?? process.env.AIMEAT_CLAUDE_CMD ?? 'claude',
        maxTotalUsd: Number(get('max-total-usd') ?? 10),
        compare: ci >= 0 ? [argv[ci + 1], argv[ci + 2]] : null,
    };
}

interface Sandbox { baseUrl: string; owners: { name: string; token: string }[]; agent: { token: string } | null }

function loadSandbox(): Sandbox {
    const path = join(AIMEAT, '.sandbox.json');
    if (!existsSync(path)) throw new Error('No sandbox is up. Run `pnpm sandbox` first: the agent needs a node to meet.');
    const s = JSON.parse(readFileSync(path, 'utf8')) as Sandbox;
    if (!s.agent) throw new Error('The sandbox has no agent. Run `pnpm sandbox --reset`.');
    return s;
}

/**
 * An arm is `{ name, prompts: { "<managed prompt id>": "<content>" } }`. It reaches MANAGED prompts
 * (the tier handbooks, the portal prompt packages), which an operator can edit on a live node. The
 * builder functions (build-app, build-extension) and the surface handbooks are code and have no
 * override, so an arm cannot reach them yet.
 */
async function applyArm(s: Sandbox, armPath: string): Promise<{ name: string; ids: string[] }> {
    const arm = JSON.parse(readFileSync(armPath, 'utf8')) as { name: string; prompts: Record<string, string> };
    for (const [id, content] of Object.entries(arm.prompts)) {
        const set = await api(s.baseUrl, `/v1/admin/prompts/${id}`, s.owners[0].token, { method: 'PATCH', body: { content } });
        if (set.status >= 300) throw new Error(`arm ${arm.name}: could not set prompt ${id} (${set.status})`);
    }
    return { name: arm.name, ids: Object.keys(arm.prompts) };
}

/** Back to the shipped text, through the same reset an operator would press. */
async function restoreArm(s: Sandbox, ids: string[]): Promise<void> {
    for (const id of ids) await api(s.baseUrl, `/v1/admin/prompts/${id}/reset`, s.owners[0].token, { method: 'POST' });
}

/** The person "at the screen": approves any agent that asks to join while a `url` task runs. */
function autoApprove(s: Sandbox): () => void {
    const timer = setInterval(() => {
        void (async () => {
            const owner = s.owners[0];
            const pending = await api<{ pending?: { user_code: string }[]; requests?: { user_code: string }[] }>(s.baseUrl, '/v1/agents/device-authorize/pending', owner.token);
            for (const p of pending.data?.pending ?? pending.data?.requests ?? []) {
                await api(s.baseUrl, '/v1/agents/verify', null, { method: 'POST', body: { user_code: p.user_code, action: 'approve', scopes: ['memory:read', 'memory:write'], owner_token: owner.token } });
            }
        })();
    }, 2000);
    return () => clearInterval(timer);
}

/**
 * One headless session. Three things here were measured on 2026-09-18 rather than assumed:
 *   - `--setting-sources project` in an empty directory is what makes the run COLD. Without it the
 *     session loads the developer's own user settings, memory, skills and connectors: a prompt of
 *     "Reply OK" carried 52,809 tokens and cost $0.21; with it, 10,228 tokens and $0.05.
 *     (`--bare` goes further and cannot sign in.)
 *   - this CLI version has no `--max-turns`; a session is held by `--max-budget-usd`.
 *   - the prompt goes in on stdin. As a shell argument it would pass through cmd.exe quoting on
 *     Windows, where a quote or a percent sign in a person's sentence changes what is asked.
 * On the `mcp` door only the node's tools are allowed, so the agent is a chat client without a
 * shell: it cannot curl its way around a tool that did not do the job, which is the point.
 */
function claudeTranscript(task: Task, prompt: string, s: Sandbox, args: Args, cwd: string): Promise<string> {
    const cli = ['-p', '--output-format', 'stream-json', '--verbose', '--model', args.model,
        '--max-budget-usd', String(args.maxBudgetUsd), '--setting-sources', 'project', '--strict-mcp-config'];
    if (task.door === 'mcp') {
        const cfg = join(cwd, 'mcp.json');
        writeFileSync(cfg, JSON.stringify({ mcpServers: { aimeat: { type: 'http', url: `${s.baseUrl}/v1/mcp`, headers: { Authorization: `Bearer ${s.agent!.token}` } } } }));
        // `--tools` names the BUILT-IN tools the session has. ToolSearch alone: it is how this
        // client loads a deferred MCP tool, and everything else (Bash, Read, Write) is what a chat
        // client does not have. The first baseline attempt left them on, and "remember this" went
        // into the client's own file memory through Bash three times out of three.
        cli.push('--mcp-config', 'mcp.json', '--tools', 'ToolSearch', '--allowedTools', 'mcp__aimeat', 'ToolSearch');
    } else {
        // The address-only door: the agent has a shell to make HTTP requests with, and nothing else.
        cli.push('--tools', 'Bash', '--allowedTools', 'Bash');
    }
    return new Promise((settle, fail) => {
        const child = spawn(`"${args.claudeCmd}" ${cli.join(' ')}`, { shell: true, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.end(prompt);
        let out = '', err = '';
        child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
        child.on('error', fail);
        child.on('close', (code) => {
            if (!out.trim()) fail(new Error(`the claude CLI printed nothing (exit ${code}). Is it installed and signed in? ${err.slice(0, 300)}`));
            else settle(out);
        });
    });
}

async function runOne(task: Task, run: number, s: Sandbox, args: Args, outDir: string): Promise<RunRecord> {
    const marker = `ca-${randomBytes(4).toString('hex')}`;
    const owner = s.owners[0];
    const base = { baseUrl: s.baseUrl, ownerName: owner.name, ownerToken: owner.token, agentToken: s.agent!.token, marker };
    const prompt = task.prompt.replaceAll('{marker}', marker).replaceAll('{baseUrl}', s.baseUrl).replaceAll('{ownerName}', owner.name);
    await task.setup?.(base);

    // A task id may carry a colon (`skill:<name>:<n>`), which a Windows file name cannot.
    const fileId = task.id.replaceAll(':', '_');
    const cwd = mkdtempSync(join(tmpdir(), `aimeat-cold-agent-${fileId}-`));
    const stopApproving = task.door === 'url' ? autoApprove(s) : () => undefined;
    let raw: string;
    try {
        raw = args.driver === 'scripted' ? await scriptedTranscript(task, base) : await claudeTranscript(task, prompt, s, args, cwd);
    } finally {
        stopApproving();
        rmSync(cwd, { recursive: true, force: true });
    }
    writeFileSync(join(outDir, `${fileId}.${run}.jsonl`), raw);

    const metrics: RunMetrics = parseTranscript(raw);
    const ctx: TaskContext = { ...base, metrics };
    const verdict = await task.verify(ctx);
    const wandered = metrics.distinctTools.filter(t => t !== 'ToolSearch' && !task.goodTools.includes(t));
    return { task: task.id, run, marker, ok: verdict.ok, detail: verdict.detail, wandered, metrics: { ...metrics, toolCalls: metrics.toolCalls.map(c => ({ ...c, input: undefined })) } };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.compare) { console.log(compareReports(args.compare[0], args.compare[1])); return; }

    const s = loadSandbox();
    const suite = args.suite === 'skills' ? skillTasks() : TASKS;
    const tasks = suite.filter(t => !args.tasks || args.tasks.some(want => t.id === want || t.id.startsWith(`${want}:`)));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = join(AIMEAT, '.cold-agent', stamp);
    mkdirSync(outDir, { recursive: true });

    const arm = args.arm ? await applyArm(s, args.arm) : null;
    const records: RunRecord[] = [];
    let spent = 0;
    try {
        for (const task of tasks) {
            for (let run = 1; run <= args.runs; run++) {
                if (spent >= args.maxTotalUsd) { console.warn(`stopping: $${spent.toFixed(2)} spent, the ceiling is $${args.maxTotalUsd}`); break; }
                process.stdout.write(`${task.id} #${run} … `);
                const rec = await runOne(task, run, s, args, outDir);
                spent += rec.metrics.costUsd ?? 0;
                records.push(rec);
                console.log(`${rec.ok ? '✓' : '✗'} ${rec.detail} (${rec.metrics.toolCalls.length} calls, ${rec.metrics.errors} errors${rec.metrics.costUsd === null ? '' : `, $${rec.metrics.costUsd.toFixed(2)}`})`);
            }
        }
    } finally {
        if (arm) await restoreArm(s, arm.ids);
    }

    const meta = { stamp, driver: args.driver, model: args.driver === 'scripted' ? 'none' : args.model, runs: args.runs, arm: arm?.name ?? 'baseline', spentUsd: spent };
    writeFileSync(join(outDir, 'results.json'), JSON.stringify({ meta, records }, null, 2));
    const report = renderReport(meta, records, suite);
    writeFileSync(join(outDir, 'report.md'), report);
    console.log(`\n${report}\nwritten to ${outDir}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
