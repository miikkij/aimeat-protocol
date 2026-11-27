/**
 * @file scripts/cold-agent/bench.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier build bench: the same five app orders, built by sessions a person
 *   starts, each on a sandbox node of its own, and one audit that reads what every session did.
 *
 *   WHY IT IS NOT `pnpm cold-agent`. That runner starts headless sessions itself, pays for them per
 *   run, and gives the agent no tool but the node's, because it measures the node's guidance on a
 *   chat client. This bench measures the developer's own way of building: a Claude Code session
 *   they open, on the model and effort they use, with its shell and its files. So the runner does
 *   not start the session. It prepares a folder to open, and reads the session's transcript
 *   afterwards from where the client keeps it. The measures, the page reader and the report are
 *   the cold-agent's own, with the bench's additions (bench-measure.ts).
 *
 *   ONE NODE PER BUILD. A builder reads the owner's existing apps first, as the best thing to start
 *   from. On a shared sandbox the second build of a round would start from the first one's app,
 *   and the same brief in the next round from the previous round's. Each build gets a named
 *   sandbox (`pnpm sandbox --name`, scripts/sandbox.ts), freshly seeded.
 *
 *   THE ROUND IS COMPARED WITH THE NEXT ONE. Run a round, change the kit or the specification, run
 *   a new round with the same orders in new sessions, and `compare` puts the two side by side.
 *   The node of a round runs the code of the worktree `prepare` was started in, and the report
 *   names that commit.
 *
 *   THE RUN FOLDER KEEPS THE SESSION ON THE BENCH'S NODE. Its `.mcp.json` names one server, the
 *   sandbox. Its `.claude/settings.json` switches the account's claude.ai connectors off for the
 *   folder and denies the production connector's tools by name, because a developer's account has
 *   a connector to a real node and a build published there would be a real app. The audit names
 *   every other MCP server a session called, and such a run is spoiled.
 * @structure parseArgs · sandbox control · prepare · auditRun · audit · compare · stop · main
 * @usage
 *   cd aimeat && pnpm atelier-bench prepare --round r1          # five nodes, five folders, five orders
 *   # open each folder in Claude Code (accept the folder's trust question), paste its PROMPT.md, let it finish
 *   cd aimeat && pnpm atelier-bench audit --round r1            # report.md and results.json for the round
 *   cd aimeat && pnpm atelier-bench compare r1 r2               # two rounds side by side
 *   cd aimeat && pnpm atelier-bench stop --round r1             # stop the round's nodes, keep their data
 *   --briefs list,map     only these briefs · --dir <folder>   where rounds are kept (default: aimeat-atelier-bench in the home folder)
 *   --no-playtest         skip the node's own browser run of each app
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-atelier-vakiokoe-samat-tilaukset-claude-code-sessioille-j-lj).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './tasks.js';
import { appQuality, describeQuality, onAtelier, publishedHtml } from './app-quality.js';
import { BENCH_MCP_SERVER, BRIEFS, briefPrompt, type Brief } from './bench-briefs.js';
import { handMade, publishTrace } from './bench-measure.js';
import { compareBench, renderBenchReport, type BenchMeta, type BenchRun } from './bench-report.js';
import { claudeSessionFiles, sessionMetrics } from './session-transcript.js';
import { parseTranscript } from './transcript.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Args { command: string; round: string; briefs: string[] | null; dir: string; playtest: boolean; rest: string[] }

function parseArgs(argv: string[]): Args {
    const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
    return {
        command: argv[0] ?? '',
        round: get('round') ?? '',
        briefs: get('briefs')?.split(',') ?? null,
        dir: resolve(get('dir') ?? join(homedir(), 'aimeat-atelier-bench')),
        playtest: !argv.includes('--no-playtest'),
        rest: argv.slice(1).filter(a => !a.startsWith('--')),
    };
}

/** A round's name is part of each node's name, which is a file name and at most 40 characters. */
function roundName(round: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(round)) throw new Error(`--round "${round}": lowercase letters, digits and dashes, at most 20, for example r1 or baseline-1127.`);
    return round;
}

// ── The sandbox of one build ───────────────────────────────────────────────────
interface SandboxState { port: number; baseUrl: string; owners: { name: string; token: string }[]; agent: { token: string } | null }

function sandbox(name: string, ...flags: string[]): void {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/sandbox.ts', '--name', name, ...flags], { cwd: AIMEAT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`the sandbox ${name} did not come up: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
}

/** The named sandbox up, seeded, with fresh tokens. */
function sandboxUp(name: string): SandboxState {
    sandbox(name);
    const s = JSON.parse(readFileSync(join(AIMEAT, `.sandbox-${name}.json`), 'utf8')) as SandboxState;
    if (!s.agent || s.owners.length < 3) throw new Error(`the sandbox ${name} has no agent or fewer than three owners; reset it with pnpm sandbox --name ${name} --reset`);
    return s;
}

async function nodeCommit(baseUrl: string): Promise<string> {
    try {
        const body = await (await fetch(`${baseUrl}/v1/build`)).json() as { commit?: string; data?: { commit?: string } };
        return (body.commit ?? body.data?.commit ?? '').slice(0, 9) || 'unknown';
    } catch { return 'unknown'; }
}

function repoCommit(): string {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: AIMEAT, encoding: 'utf8' });
    const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: AIMEAT, encoding: 'utf8' }).stdout.trim() ? '+changes' : '';
    return (r.stdout.trim() || 'unknown') + dirty;
}

// ── The round on disk ──────────────────────────────────────────────────────────
interface RunEntry { brief: string; instance: string; baseUrl: string; dir: string; marker: string; ownerName: string; org?: string; nodeCommit: string }
interface Manifest { round: string; createdAt: string; repoCommit: string; runs: RunEntry[] }

const manifestPath = (a: Args) => join(a.dir, a.round, 'round.json');
function readManifest(a: Args): Manifest | null {
    return existsSync(manifestPath(a)) ? JSON.parse(readFileSync(manifestPath(a), 'utf8')) as Manifest : null;
}

function writeRunFolder(run: RunEntry, brief: Brief, agentToken: string): void {
    mkdirSync(join(run.dir, '.claude'), { recursive: true });
    writeFileSync(join(run.dir, '.mcp.json'), JSON.stringify({
        mcpServers: { [BENCH_MCP_SERVER]: { type: 'http', url: `${run.baseUrl}/v1/mcp`, headers: { Authorization: `Bearer ${agentToken}` } } },
    }, null, 2) + '\n');
    writeFileSync(join(run.dir, '.claude', 'settings.json'), JSON.stringify({
        enabledMcpjsonServers: [BENCH_MCP_SERVER],
        // The account's claude.ai connectors off for this folder, and the production connector's
        // tools denied by name as well: a build must not reach a real node.
        disableClaudeAiConnectors: true,
        permissions: { allow: [`mcp__${BENCH_MCP_SERVER}`], deny: ['mcp__claude_ai_AIMEAT', 'mcp__claude_ai_AIMEAT_AppDev'] },
    }, null, 2) + '\n');
    writeFileSync(join(run.dir, 'PROMPT.md'), briefPrompt(brief, { baseUrl: run.baseUrl, marker: run.marker, org: run.org }));
}

async function prepare(a: Args): Promise<void> {
    const round = roundName(a.round);
    const briefs = BRIEFS.filter(b => !a.briefs || a.briefs.includes(b.id));
    if (!briefs.length) throw new Error(`--briefs ${a.briefs?.join(',')}: none of ${BRIEFS.map(b => b.id).join(', ')}`);
    const manifest: Manifest = readManifest(a) ?? { round, createdAt: new Date().toISOString(), repoCommit: repoCommit(), runs: [] };
    mkdirSync(join(a.dir, round), { recursive: true });
    for (const brief of briefs) {
        const instance = `${round}-${brief.id}`;
        process.stdout.write(`${brief.id}: the node … `);
        const s = sandboxUp(instance);
        let run = manifest.runs.find(r => r.brief === brief.id);
        if (!run) {
            const marker = `kb-${randomBytes(3).toString('hex')}`;
            const org = await brief.setup?.({
                baseUrl: s.baseUrl, ownerName: s.owners[0].name, ownerToken: s.owners[0].token,
                otherOwnerToken: s.owners[1].token, memberToken: s.owners[2].token, marker,
            });
            run = { brief: brief.id, instance, baseUrl: s.baseUrl, dir: join(a.dir, round, brief.id), marker, ownerName: s.owners[0].name, ...(org ? { org } : {}), nodeCommit: await nodeCommit(s.baseUrl) };
            manifest.runs.push(run);
        }
        run.baseUrl = s.baseUrl;
        // Written again on every prepare: the agent's token lasts a day.
        writeRunFolder(run, brief, s.agent!.token);
        writeFileSync(manifestPath(a), JSON.stringify(manifest, null, 2) + '\n');
        console.log(`${s.baseUrl} · ${run.dir}`);
    }
    console.log(`\nRound ${round}: ${manifest.runs.length} build(s) prepared, node code at ${manifest.repoCommit}.`);
    console.log('For each folder above: open it in Claude Code, accept the folder\'s trust question, check that the only MCP server is');
    console.log(`"${BENCH_MCP_SERVER}", paste the whole of PROMPT.md as the first message, and let the session finish.`);
    console.log(`Then: pnpm atelier-bench audit --round ${round}`);
    console.log('The tokens in the folders last a day; run prepare again to renew them.');
}

// ── The audit of one build ─────────────────────────────────────────────────────
interface Envelope<T> { status: number; data: T | null }

async function auditRun(run: RunEntry, brief: Brief, a: Args): Promise<BenchRun> {
    const empty = { session: null, trace: null, hand: null, proofs: [], versions: null, behind: [], agentFace: null, boundSkills: null, kitComponents: [], buildNotes: null, blocking: [], warnings: [], playtest: null, foreignServers: [] };
    const files = claudeSessionFiles(run.dir);
    if (!files.length) {
        return { ...empty, brief: run.brief, task: run.brief, run: 1, marker: run.marker, ok: false, missing: true, detail: `no session transcript for ${run.dir}`, wandered: [], metrics: parseTranscript('') };
    }
    const { metrics, session } = sessionMetrics(files.map(f => readFileSync(f, 'utf8')));
    const trace = publishTrace(metrics.toolCalls);
    const foreignServers = Object.keys(session.servers).filter(name => name !== BENCH_MCP_SERVER);
    const slim = { ...metrics, toolCalls: metrics.toolCalls.map(c => ({ ...c, input: undefined })) };
    const base = { brief: run.brief, task: run.brief, run: 1, marker: run.marker, wandered: [], metrics: slim, session, trace, foreignServers };

    const s = sandboxUp(run.instance);
    const owner = s.owners[0];
    const apps = await api<{ apps: unknown[] }>(s.baseUrl, `/v1/apps?owner=${encodeURIComponent(owner.name)}&limit=200`, owner.token);
    const hit = (apps.data?.apps ?? []).find(app => JSON.stringify(app).includes(run.marker)) as { filename?: string } | undefined;
    if (!hit?.filename) return { ...empty, ...base, ok: false, detail: 'no published app carries the name' };

    const path = `/v1/apps/${encodeURIComponent(owner.name)}/${encodeURIComponent(hit.filename)}`;
    const q = await appQuality(s.baseUrl, owner.name, hit.filename, metrics.toolCalls, owner.token);
    const html = await publishedHtml(`${s.baseUrl}${path}?mode=inline`, owner.token).catch(() => '');
    const proofs = brief.proves.map(p => ({ what: p.what, ok: p.test(html) }));
    const fresh: Envelope<{ behind?: Array<{ item: string; what: string }>; bound_skills?: unknown[] }> = await api(s.baseUrl, `${path}/freshness`, owner.token);
    const versions: Envelope<{ versions?: unknown[] }> = await api(s.baseUrl, `${path}/versions`, owner.token);
    const records: Envelope<{ items?: unknown[] }> = await api(s.baseUrl, '/v1/memory?owner_scope=true&limit=500', owner.token);
    const stem = hit.filename.replace(/\.html?$/i, '');
    const agentFace = (records.data?.items ?? []).some((item) => { const text = JSON.stringify(item); return text.includes('.agentface') && text.includes(stem); });

    let playtest: BenchRun['playtest'] = null;
    if (a.playtest) {
        const live: Envelope<{ live?: { playtest?: { ran: boolean; reason?: string; checks?: Array<{ id: string; ok: boolean; severity: string; detail: string }>; console?: { errors?: string[] }; summary?: { ok: boolean } } } }>
            = await api(s.baseUrl, `${path}/audit?playtest=true&limit=1`, owner.token);
        const p = live.data?.live?.playtest;
        playtest = p
            ? { ran: p.ran, ok: p.summary?.ok === true, failed: (p.checks ?? []).filter(c => !c.ok && c.severity === 'must').map(c => `${c.id}: ${c.detail}`), consoleErrors: p.console?.errors?.length ?? 0, ...(p.reason ? { reason: p.reason } : {}) }
            : { ran: false, ok: false, failed: [], consoleErrors: 0, reason: `the audit answered ${live.status}` };
    }

    const failed = [
        ...(onAtelier(q) ? [] : ['it is not an Atelier app with a register']),
        ...(q.blocking.length ? [`the publish lint blocks ${q.blocking.join(', ')}`] : []),
        ...proofs.filter(p => !p.ok).map(p => `it does not hold: ${p.what}`),
        ...(foreignServers.length ? [`the session called ${foreignServers.join(', ')}`] : []),
    ];
    return {
        ...base,
        ok: failed.length === 0,
        detail: failed.length ? `Published as ${hit.filename}, and ${failed.join('; ')}.` : `Published as ${hit.filename}: an Atelier app that holds every proof of the brief.`,
        note: describeQuality(q),
        hand: handMade(html),
        proofs,
        versions: versions.data?.versions?.length ?? null,
        behind: (fresh.data?.behind ?? []).map(b => `${b.item}: ${b.what}`),
        agentFace,
        boundSkills: fresh.data?.bound_skills?.length ?? null,
        kitComponents: q.kitComponents,
        buildNotes: q.buildNotes ? { took: q.buildNotes.took, passed: q.buildNotes.passed, made: q.buildNotes.made } : null,
        blocking: q.blocking,
        warnings: q.warnings,
        playtest,
    };
}

async function audit(a: Args): Promise<void> {
    const manifest = readManifest(a);
    if (!manifest) throw new Error(`no round "${a.round}" under ${a.dir}. pnpm atelier-bench prepare --round ${a.round || '<name>'} makes one.`);
    const runs: BenchRun[] = [];
    for (const run of manifest.runs.filter(r => !a.briefs || a.briefs.includes(r.brief))) {
        const brief = BRIEFS.find(b => b.id === run.brief);
        if (!brief) continue;
        process.stdout.write(`${run.brief} … `);
        const rec = await auditRun(run, brief, a).catch((e: unknown): BenchRun => ({
            brief: run.brief, task: run.brief, run: 1, marker: run.marker, ok: false, detail: `the audit failed: ${e instanceof Error ? e.message : String(e)}`, wandered: [], metrics: parseTranscript(''),
            session: null, trace: null, hand: null, proofs: [], versions: null, behind: [], agentFace: null, boundSkills: null, kitComponents: [], buildNotes: null, blocking: [], warnings: [], playtest: null, foreignServers: [],
        }));
        runs.push(rec);
        console.log(rec.missing ? 'no session yet' : `${rec.ok ? '✓' : '✗'} ${rec.detail}`);
    }
    const models = runs.map(r => r.session?.model).filter((m): m is string => !!m);
    const meta: BenchMeta = { round: manifest.round, auditedAt: new Date().toISOString(), repoCommit: manifest.repoCommit, nodeCommits: manifest.runs.map(r => r.nodeCommit), model: [...new Set(models)].join(', ') || null };
    const out = join(a.dir, manifest.round);
    // `records` is the cold-agent's own shape, so `pnpm cold-agent --compare` reads a round too.
    writeFileSync(join(out, 'results.json'), JSON.stringify({ meta: { ...meta, stamp: meta.auditedAt, driver: 'person', runs: 1, arm: manifest.round, spentUsd: runs.reduce((n, r) => n + (r.metrics.costUsd ?? 0), 0) }, bench: meta, records: runs }, null, 2));
    const report = renderBenchReport(meta, runs);
    writeFileSync(join(out, 'report.md'), report);
    console.log(`\n${report}\nwritten to ${join(out, 'report.md')}`);
}

function compare(a: Args): void {
    const [x, y] = a.rest;
    if (!x || !y) throw new Error('compare needs two round names: pnpm atelier-bench compare r1 r2');
    const load = (round: string) => {
        const path = join(a.dir, round, 'results.json');
        if (!existsSync(path)) throw new Error(`round ${round} has no results.json: run pnpm atelier-bench audit --round ${round} first`);
        const j = JSON.parse(readFileSync(path, 'utf8')) as { bench: BenchMeta; records: BenchRun[] };
        return { meta: j.bench, runs: j.records };
    };
    console.log(compareBench(load(x), load(y)));
}

function stop(a: Args): void {
    const manifest = readManifest(a);
    if (!manifest) throw new Error(`no round "${a.round}" under ${a.dir}`);
    for (const run of manifest.runs) { sandbox(run.instance, '--stop'); console.log(`stopped ${run.instance}`); }
}

async function main(): Promise<void> {
    const a = parseArgs(process.argv.slice(2));
    if (a.command === 'prepare') await prepare(a);
    else if (a.command === 'audit') await audit(a);
    else if (a.command === 'compare') compare(a);
    else if (a.command === 'stop') stop(a);
    else throw new Error('pnpm atelier-bench prepare --round <name> | audit --round <name> | compare <a> <b> | stop --round <name>');
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
