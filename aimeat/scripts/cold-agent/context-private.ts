/**
 * @file scripts/cold-agent/context-private.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The context suite on a person's own material: the same measurement as
 *   context-cases.ts, with contexts, records and tasks read from a fixture directory named at run
 *   time. This file holds no material of its own and names nobody; the fixture directory lives
 *   outside the repository, and the run's transcripts are written into that directory too, because
 *   they quote the material.
 *
 *   WHY. Invented fixtures measure whether an agent can use a context at all. Whether the context
 *   holds up on real work (two people with one first name, a document that is older than the
 *   decision, a term that means one thing here and another elsewhere, a message to an outside party
 *   that must leave things out) is only measurable on the material where those things happened. The
 *   developer asked for that test on his own conversations, kept private (2026-11-08).
 *
 *   FIXTURE DIRECTORY.
 *     contexts/<slug>.json   One context, in the aimeat.context/v1 shape of context-cases.ts:
 *                            { name, summary, kind, core, concepts?, references?, includes?,
 *                              excludes?, material? }. Seeded under the sandbox owner as
 *                            `context.<slug>`, visibility owner. `concepts` is kept only in the
 *                            `on` arm, and the arm sets the `ontology` field.
 *     records/*.json         Each file an array of { key, value }: the records the references point
 *                            at (`memory:<key>`). A value stays under about 900 kB, so a long thread
 *                            is split into parts. Seeded under the owner when a context that
 *                            references them is seeded.
 *     tasks.json             [{ id, prompt, seed: [slug...], expect?: { all?: string[][],
 *                            none?: string[] }, judge?: string, draftOnly?: boolean }]. With
 *                            `draftOnly`, `none` and the judge read only the drafted message (the
 *                            text between the first two `---` lines), not the note around it. Each inner array of `all` is a
 *                            group of accepted alternatives, and every group must be hit; `none`
 *                            lists strings that must not appear. Both are case-insensitive. `judge`
 *                            is a rubric for the second reader (context-cases.ts `judge`), which
 *                            gets the seeded contexts' cores as the context.
 *   A task passes when the final answer meets `expect` and the judge, whichever are given. What a
 *   task seeded is removed after it, unless `--keep`.
 * @structure PrivateContext · PrivateTask · loadFixture() · privateContextTasks(onto, dir)
 * @usage
 *   cd aimeat && pnpm cold-agent --suite context-private --fixtures "<dir>" --onto on --runs 3
 * @version-history
 *   v1.2.0 — 2026-11-08 — `--onto graph`: the context's ontology (a shared core, a registry of
 *     people and groups, the context's own modules, and the use rules) is seeded beside it from
 *     the fixture's ontology/ folder, and the context record points at it.
 *   v1.1.0 — 2026-11-08 — `draftOnly`: a boundary task's forbidden words and judge read the drafted
 *     message only (draftOf), after the first run failed clean drafts on their covering note.
 *   v1.0.0 — 2026-11-08 — Initial: the fixture format, seeding by reference, keyword and judge
 *     checks (goal-oma-konteksti).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Task, TaskContext } from './tasks.js';
import { GOOD, drop, judge, put, record, type Concept, type Onto, type Reference } from './context-cases.js';

interface PrivateContext {
    slug: string;
    name: string;
    summary: string;
    kind: 'factual' | 'creative' | 'mixed';
    core: string;
    concepts?: Concept[];
    references?: Reference[];
    includes?: string[];
    excludes?: string[];
    material?: string;
    /** The context's own ontology modules (memory keys under ontology/), seeded in the graph arm. */
    ontologyModules?: string[];
}

interface PrivateTask {
    id: string;
    prompt: string;
    seed: string[];
    expect?: { all?: string[][]; none?: string[] };
    judge?: string;
    /** The task asks for a message to someone else: `none` and the judge read only that message. */
    draftOnly?: boolean;
}

interface Fixture {
    contexts: Map<string, PrivateContext>;
    records: Map<string, unknown>;
    tasks: PrivateTask[];
}

const readJson = <T>(path: string): T => {
    try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch (e) { throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, { cause: e }); }
};

/** The record keys a context's references point at. A reference to anything but memory is left to the agent. */
const memoryRefs = (c: PrivateContext): string[] => (c.references ?? []).map(r => r.ref).filter(r => r.startsWith('memory:')).map(r => r.slice('memory:'.length));

/**
 * Reads and checks the fixture directory. Everything wrong is reported in one error, before a
 * session is started and money is spent: a missing context a task seeds, a record a reference
 * names that no records file holds, a task without a check.
 */
export function loadFixture(dir: string): Fixture {
    const problems: string[] = [];
    const ctxDir = join(dir, 'contexts');
    const recDir = join(dir, 'records');
    if (!existsSync(ctxDir)) throw new Error(`${dir} has no contexts/ directory. The fixture format is in the header of scripts/cold-agent/context-private.ts.`);
    const contexts = new Map<string, PrivateContext>();
    for (const f of readdirSync(ctxDir).filter(n => n.endsWith('.json'))) {
        const slug = basename(f, '.json');
        const c = readJson<Omit<PrivateContext, 'slug'>>(join(ctxDir, f));
        if (!c.name || !c.core) problems.push(`contexts/${f}: needs at least name and core`);
        contexts.set(slug, { ...c, slug, summary: c.summary ?? '', kind: c.kind ?? 'factual' });
    }
    const records = new Map<string, unknown>();
    for (const f of existsSync(recDir) ? readdirSync(recDir).filter(n => n.endsWith('.json')) : []) {
        const items = readJson<Array<{ key: string; value: unknown }>>(join(recDir, f));
        if (!Array.isArray(items)) { problems.push(`records/${f}: must be an array of { key, value }`); continue; }
        for (const it of items) {
            if (!it.key || it.value === undefined) { problems.push(`records/${f}: an item without key or value`); continue; }
            if (records.has(it.key)) problems.push(`records/${f}: ${it.key} is also in another records file`);
            const bytes = Buffer.byteLength(JSON.stringify(it.value));
            if (bytes > 900_000) problems.push(`records/${f}: ${it.key} is ${bytes} bytes; split it below 900 kB`);
            records.set(it.key, it.value);
        }
    }
    for (const c of contexts.values()) {
        for (const k of memoryRefs(c)) if (!records.has(k)) problems.push(`contexts/${c.slug}.json references memory:${k}, which no records file holds`);
    }
    const tasksPath = join(dir, 'tasks.json');
    if (!existsSync(tasksPath)) throw new Error(`${dir} has no tasks.json`);
    const tasks = readJson<PrivateTask[]>(tasksPath);
    const ids = new Set<string>();
    for (const t of tasks) {
        if (ids.has(t.id)) problems.push(`tasks.json: id ${t.id} is used twice`);
        ids.add(t.id);
        if (!t.prompt) problems.push(`tasks.json: ${t.id} has no prompt`);
        if (!t.expect?.all?.length && !t.expect?.none?.length && !t.judge) problems.push(`tasks.json: ${t.id} has neither expect nor judge, so nothing could fail it`);
        for (const s of t.seed ?? []) if (!contexts.has(s)) problems.push(`tasks.json: ${t.id} seeds ${s}, which is not in contexts/`);
    }
    if (problems.length) throw new Error(`the fixture in ${dir} has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    return { contexts, records, tasks };
}

/** Lower case, with the no-break and thin spaces a model writes in "29 €" made plain spaces. */
const NARROW_SPACES = new RegExp('[\u00a0\u202f\u2009\u2007]', 'g');
const norm = (s: string): string => s.toLowerCase().replace(NARROW_SPACES, ' ').replace(/[ \t]+/g, ' ');

/**
 * The message itself when the answer wraps a draft between two `---` lines, as a model does when it
 * writes something for the person to send; otherwise the whole answer. Measured 2026-11-08: the
 * note after a clean draft ("I left out Taneli's call", "he is not a co-founder") was read as the
 * draft saying it, and four boundary runs failed on words the draft itself never used.
 */
export function draftOf(answer: string): string {
    const parts = answer.split(/^\s*-{3,}\s*$/m);
    return parts.length >= 3 ? parts[1] : answer;
}

/** The keyword check: every `all` group hit by one of its alternatives, no `none` string in `scope`. */
function checkExpect(answer: string, expect: PrivateTask['expect'], scope = answer): { ok: boolean; detail: string } {
    const text = norm(answer);
    const missed = (expect?.all ?? []).filter(g => !g.some(w => text.includes(norm(w))));
    const scoped = norm(scope);
    const leaked = (expect?.none ?? []).filter(w => scoped.includes(norm(w)));
    const parts: string[] = [];
    if (missed.length) parts.push(`missed ${missed.map(g => `[${g[0]}]`).join(' ')}`);
    if (leaked.length) parts.push(`said what it must not: ${leaked.join(', ')}`);
    return { ok: !missed.length && !leaked.length, detail: parts.join('; ') || `all ${expect?.all?.length ?? 0} facts, nothing forbidden` };
}

/** What the judge reads as the context: each seeded context's name, core and boundaries. */
const judgeContext = (cs: PrivateContext[]): string => cs.map(c => [
    `## ${c.name}`, c.core,
    c.excludes?.length ? `Excludes: ${c.excludes.join('; ')}` : '',
].filter(Boolean).join('\n')).join('\n\n');

/**
 * The `graph` arm: the context's ontology is seeded beside it. `ontology/*.json` in the fixture are
 * vocabulary records (the file name without .json is the memory key, e.g. vocab.ctx.core), and
 * `ontology/rules.md` is the use rules. Every `vocab.ctx.core*` and `vocab.ctx.registry*` record is
 * shared and seeded with any context; a context names its own modules in `ontologyModules`.
 */
interface Ontology { records: Map<string, unknown>; rules: string }

function loadOntology(dir: string): Ontology | null {
    const oDir = join(dir, 'ontology');
    if (!existsSync(oDir)) return null;
    const records = new Map<string, unknown>();
    for (const f of readdirSync(oDir).filter(n => n.endsWith('.json'))) records.set(basename(f, '.json'), readJson<unknown>(join(oDir, f)));
    const rulesPath = join(oDir, 'rules.md');
    return { records, rules: existsSync(rulesPath) ? readFileSync(rulesPath, 'utf8') : '' };
}

export type PrivateArm = Onto | 'graph';

export function privateContextTasks(arm: PrivateArm, dir: string): Task[] {
    const fx = loadFixture(dir);
    const onto = arm === 'graph' ? 'off' : arm;
    const ontology = arm === 'graph' ? loadOntology(dir) : null;
    if (arm === 'graph' && !ontology) throw new Error(`--onto graph needs ${join(dir, 'ontology')} with the vocabulary records and rules.md`);
    const shared = ontology ? [...ontology.records.keys()].filter(k => /^vocab\.ctx\.(core|registry)/.test(k)) : [];
    return fx.tasks.map((t): Task => {
        const seeded = t.seed.map(s => fx.contexts.get(s)!);
        const recordKeys = [...new Set(seeded.flatMap(memoryRefs))];
        const modules = ontology ? [...new Set(seeded.flatMap(c => c.ontologyModules ?? []))].filter(k => ontology.records.has(k)) : [];
        const ontoKeys = ontology ? [...shared, ...modules] : [];
        const allKeys = [...seeded.map(c => `context.${c.slug}`), ...recordKeys, ...ontoKeys];
        return {
            id: `priv-${t.id}:${arm}`,
            door: 'mcp',
            prompt: t.prompt,
            goodTools: GOOD,
            setup: async (c) => {
                for (const k of recordKeys) await put(c, k, fx.records.get(k));
                for (const k of ontoKeys) await put(c, k, ontology!.records.get(k));
                for (const ctxRec of seeded) {
                    const rec = record(ctxRec, onto);
                    // The graph arm points the context at its ontology and carries the use rules, so
                    // an AI that opens the context finds both without any other guidance.
                    if (ontology) Object.assign(rec, {
                        ontology: 'graph',
                        ontologyRecords: [...shared, ...(ctxRec.ontologyModules ?? []).filter(k => ontology.records.has(k))],
                        ontologyRules: ontology.rules,
                    });
                    await put(c, `context.${ctxRec.slug}`, rec);
                }
            },
            verify: async (ctx: TaskContext) => {
                try {
                    const answer = ctx.metrics.finalText;
                    const scope = t.draftOnly ? draftOf(answer) : answer;
                    const kw = t.expect ? checkExpect(answer, t.expect, scope) : null;
                    const jd = t.judge ? await judge(t.judge, judgeContext(seeded), scope) : null;
                    const ok = (kw?.ok ?? true) && (jd?.ok ?? true);
                    const detail = [kw?.detail, jd?.detail].filter(Boolean).join(' · ');
                    return { ok, detail, ...(jd?.unverified ? { unverified: true } : {}) };
                } finally {
                    await drop(ctx, allKeys);
                }
            },
        };
    });
}
