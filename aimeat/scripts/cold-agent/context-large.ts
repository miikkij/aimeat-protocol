/**
 * @file scripts/cold-agent/context-large.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The large context suite: the context suite's questions asked of a context at real
 *   scale, where the answer is in one of forty session notes and not in the core.
 *
 *   WHY. The first context fixtures (context-cases.ts) were at most ~3 000 characters, and the
 *   developer called them worthless for the question they were meant to answer: does an ontology
 *   help an AI understand a context (2026-11-08)? A context two people built over months holds
 *   hundreds of thousands of characters, words they coined and then stopped explaining, decisions
 *   changed and changed back, documents nobody updated, things that must not reach an outside
 *   party, and a second project of one of them where the same words mean something else. This
 *   suite seeds such a context and asks what a person asks of it.
 *
 *   THE FIXTURE. fixtures/context-large/truth.json is the ground truth as data (terms, decisions
 *   with their replacedBy chains, questions, figures, people, stories, documents, boundaries).
 *   fixtures/context-large/sessions/*.md are the session notes written from it by generate.ts.
 *   Every answer key below comes from truth.json, never from the prose, and every check names the
 *   decision or term it holds the answer to.
 *
 *   THE RECORDS. A memory value may be at most 1024 kB and an identity holds at most 1000 keys, so
 *   the context is a core of about a page plus one reference per session note, each note its own
 *   record (`notes.<slug>.session-NN`, value { title, date, text }). The `on` arm adds the truth's
 *   terms as the concepts block; `off` and `auto` leave it out, as in context-cases.ts. Material is
 *   empty: the notes are the material.
 *
 *   JUDGING. From the final answer: groups of accepted wordings that must all be present, and stale
 *   values that fail when a sentence states them without marking them as history ("was", "before",
 *   "changed from"). A sentence is the unit, so "36 hours, down from 48" passes and "48 hours"
 *   fails. Each verdict notes how many memory reads the run made.
 * @structure Truth types · loadTruth · records (buildLargeContext, largeContextStats) · seeding ·
 *   checks (judgeKey) · largeContextTasks(onto)
 * @usage
 *   cd aimeat && pnpm cold-agent --suite context-large --onto on --runs 3
 *   cd aimeat && pnpm cold-agent --suite context-large --onto off --tasks ctxL-window,ctxL-homonym
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: 17 tasks over the Larder context (40 sessions) and the Tidewater
 *     context (6 playtests), three ontology arms.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, type Task, type TaskContext } from './tasks.js';
import { CONTEXT_TYPE, type Onto } from './context-cases.js';

// ── Truth types (also read by fixtures/context-large/generate.ts) ──────────────────────────────

export interface Term {
    id: string; term: string; kind: string; means: string; session: number;
    synonymOf?: string; broader?: string; replacedBy?: string; renamedIn?: number;
    /** The same word in the other context, with another meaning. */
    homonymOf?: string;
    /** One of several meanings of the same word inside this project, and how that sense is written. */
    sense?: string; spelled?: string;
}
export interface Decision { id: string; session: number; date: string; topic: string; text: string; value?: string; replaces?: string; replacedBy?: string }
export interface Question { id: string; opened: number; question: string; closedIn?: number; closedBy?: string | null; answer?: string }
export interface Fact { id: string; session: number; text: string }
export interface Person { name: string; role: string; from: number }
export interface Session { n: number; date: string; title: string; attendees: string[]; topics: string[]; mustUse: string[] }
export interface Story { id: string; topic: string; tellings: Array<{ session: number; teller: string; text: string; mustSay: string[] }> }
export interface Doc { id: string; title: string; text: string; pastes: Array<{ session: number; by: string; how: string }> }
export interface Personal { session: number; text: string; mustSay: string[] }
export interface Analysis { session: number; by: string; about: string; recommends: string; stale?: string; mustSay?: string[] }
export interface Project {
    slug: string; name: string; kind: 'factual' | 'creative' | 'mixed'; summary: string; setting: string; core: string;
    people: Person[]; sessions: Session[]; terms: Term[]; decisions: Decision[]; questions: Question[]; facts: Fact[];
    stories: Story[]; documents: Doc[]; personal: Personal[]; analyses: Analysis[];
    boundaries?: { doNotTell: Array<{ party: string; decision: string; items: string[] }>; neverExternal: Array<{ party: string; decision: string }>; personalStaysOut: boolean };
}
export interface Truth { main: Project; second: Project }

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'context-large');

export function loadTruth(): Truth {
    return JSON.parse(readFileSync(join(FIXTURE, 'truth.json'), 'utf8')) as Truth;
}

// ── Records ────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const isMain = (p: Project, t: Truth) => p.slug === t.main.slug;
export const contextKey = (p: Project) => `context.${p.slug}`;
export const noteKey = (p: Project, n: number, main: boolean) => `notes.${p.slug}.${main ? 'session' : 'playtest'}-${pad(n)}`;
const noteFile = (p: Project, n: number, main: boolean) => join(FIXTURE, 'sessions', `${main ? 'session' : p.slug}-${pad(n)}.md`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-01-27" as "27 January 2026": a calendar date in the fixture's own English, read by no person's settings. */
export const longDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** A term's name in the concepts block: a word with several senses carries the sense. */
const label = (p: Project, t: Term) => (t.sense ? `${t.term} (${t.sense})` : t.term);
/** The concept a `broader` or `replacedBy` name points at: the plain term, or the product sense of a shared word. */
function labelOf(p: Project, name: string): string {
    const all = p.terms.filter(t => t.term === name);
    const t = all.find(x => !x.sense) ?? all.find(x => x.sense === 'product') ?? all[0];
    return t ? label(p, t) : name;
}

function concepts(p: Project): Array<{ term: string; means: string; broader?: string; replacedBy?: string }> {
    return p.terms.map(t => ({
        term: label(p, t),
        means: t.means,
        ...(t.broader ? { broader: labelOf(p, t.broader) } : {}),
        ...(t.replacedBy ? { replacedBy: labelOf(p, t.replacedBy) } : {}),
    }));
}

function references(p: Project, main: boolean) {
    return p.sessions.map(s => {
        const when = longDate(s.date);
        const topics = s.topics.join(', ');
        return {
            ref: `memory:${noteKey(p, s.n, main)}`,
            what: `${main ? 'Session' : 'Playtest'} ${s.n}, ${when}: ${s.title} (${topics})`,
            openWhen: `you need what was said or decided on ${when} about ${topics}`,
        };
    });
}

function contextRecord(p: Project, onto: Onto, main: boolean): Record<string, unknown> {
    return {
        type: CONTEXT_TYPE,
        name: p.name,
        summary: p.summary,
        kind: p.kind,
        ontology: onto,
        core: p.core,
        ...(onto === 'on' ? { concepts: concepts(p) } : {}),
        references: references(p, main),
        includes: [],
        excludes: [],
        material: '',
        lifecycle: { createdAt: p.sessions[0].date, shapedAt: p.sessions[p.sessions.length - 1].date },
    };
}

/** One session note as a record: the file's first line is its heading, the rest its text. */
function noteRecord(p: Project, n: number, main: boolean): { title: string; date: string; text: string } {
    const raw = readFileSync(noteFile(p, n, main), 'utf8').replace(/\r\n/g, '\n');
    const [head, ...rest] = raw.split('\n');
    return { title: head.replace(/^#\s*/, ''), date: p.sessions[n - 1].date, text: rest.join('\n').trim() };
}

const MAX_VALUE_BYTES = 1024 * 1024;
const MAX_KEYS = 1000;

/** Every record the suite seeds, by key. Refuses a value past the node's per-value ceiling. */
export function buildLargeContext(onto: Onto, truth = loadTruth()): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const p of [truth.main, truth.second]) {
        const main = isMain(p, truth);
        for (const s of p.sessions) out.set(noteKey(p, s.n, main), noteRecord(p, s.n, main));
        out.set(contextKey(p), contextRecord(p, onto, main));
    }
    for (const [k, v] of out) {
        const size = Buffer.byteLength(JSON.stringify(v), 'utf8');
        if (size > MAX_VALUE_BYTES) throw new Error(`${k} is ${size} bytes, past the ${MAX_VALUE_BYTES}-byte value ceiling`);
    }
    if (out.size > MAX_KEYS) throw new Error(`${out.size} records, past the ${MAX_KEYS}-key budget`);
    return out;
}

/** Sizes for a report: the material, the largest record and the core. */
export function largeContextStats(onto: Onto = 'on'): Record<string, number | string> {
    const truth = loadTruth();
    const recs = buildLargeContext(onto, truth);
    const sizes = [...recs].map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v), 'utf8')] as const).sort((a, b) => b[1] - a[1]);
    const chars = (slug: string) => [...recs].filter(([k]) => k.startsWith(`notes.${slug}.`)).reduce((n, [, v]) => n + (v as { text: string }).text.length, 0);
    return {
        records: recs.size,
        mainMaterialChars: chars(truth.main.slug),
        secondMaterialChars: chars(truth.second.slug),
        largestRecord: `${sizes[0][0]} (${sizes[0][1]} bytes)`,
        mainContextBytes: Buffer.byteLength(JSON.stringify(recs.get(contextKey(truth.main))), 'utf8'),
        coreChars: truth.main.core.length,
        terms: truth.main.terms.length,
        decisions: truth.main.decisions.length,
        reversals: truth.main.decisions.filter(d => d.replaces).length,
        questions: truth.main.questions.length,
        homonyms: truth.second.terms.filter(t => t.kind === 'homonym').length,
    };
}

// ── Seeding ────────────────────────────────────────────────────────────────────────────────────

async function seedAll(ctx: Omit<TaskContext, 'metrics'>, onto: Onto): Promise<void> {
    for (const [key, value] of buildLargeContext(onto)) {
        const r = await api(ctx.baseUrl, '/v1/memory', ctx.ownerToken, { method: 'POST', body: { key, value, visibility: 'owner' } });
        if (r.status >= 300) throw new Error(`seeding ${key} answered ${r.status}`);
    }
}

async function dropAll(ctx: TaskContext, onto: Onto): Promise<void> {
    if (ctx.keep) return;
    for (const key of buildLargeContext(onto).keys()) await api(ctx.baseUrl, `/v1/memory/${encodeURIComponent(key)}`, ctx.ownerToken, { method: 'DELETE' });
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────────

/** A sentence that marks a value as past, changed or not in force. */
const HISTORY = /\b(was|were|had been|earlier|previous(ly)?|before|originally|initially|at first|first|used to|replac\w*|chang\w*|went back|reversed|dropped|raised|lowered|cut|from|until|old|former(ly)?|then|later|took over|handed|moved|superseded|instead|no longer|not|nothing|never|anymore|extended|shortened|increas\w*|decreas\w*|went (up|down)|reduc\w*|history|since|after|stale|outdated|out of date|wrong|incorrect|still says|says)\b|n't\b/i;
/** A sentence that sets one meaning or one person apart from another. */
const CONTRAST = /\b(not|unlike|different|differs|other|another|separate|whereas|while|two|second|same name|confus\w*|rather than|instead|elsewhere|in larder|in the larder|kestrel's oskar)\b|n't\b/i;

interface Key {
    /** Each group must match: [pattern, what it stands for]. */
    need: Array<[RegExp, string]>;
    /** A sentence matching `re` fails unless it also matches `unless`. */
    stale?: Array<{ re: RegExp; unless: RegExp; what: string }>;
    /** Fails wherever it appears. */
    forbid?: Array<[RegExp, string]>;
}

const sentences = (text: string) => text.replace(/\u00a0|\u202f/g, ' ').split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);

function judgeKey(text: string, key: Key): { ok: boolean; detail: string } {
    const missing = key.need.filter(([re]) => !re.test(text)).map(([, what]) => what);
    const stale: string[] = [];
    for (const s of key.stale ?? []) {
        const hit = sentences(text).find(x => s.re.test(x) && !s.unless.test(x));
        if (hit) stale.push(`${s.what}: "${hit.slice(0, 120)}"`);
    }
    const forbidden = (key.forbid ?? []).filter(([re]) => re.test(text)).map(([, what]) => what);
    const ok = !missing.length && !stale.length && !forbidden.length;
    const parts = [
        missing.length ? `missing ${missing.join(', ')}` : '',
        stale.length ? `stale ${stale.join('; ')}` : '',
        forbidden.length ? `said ${forbidden.join(', ')}` : '',
    ].filter(Boolean);
    return { ok, detail: ok ? 'gave the current answer' : parts.join('; ') };
}

const memoryReads = (ctx: TaskContext) => ctx.metrics.toolCalls.filter(t => /memory_(read|get)/.test(t.name)).length;
const GOOD = ['aimeat_memory_list', 'aimeat_memory_read', 'aimeat_memory_search', 'aimeat_discover'];

/** Throws when an answer key no longer matches the truth it was written from. */
function assertTruth(truth: Truth): void {
    const d = (id: string) => truth.main.decisions.find(x => x.id === id);
    const holds: Array<[string, boolean]> = [
        ['d06 is the current pickup window', !!d('d06') && !d('d06')!.replacedBy && d('d06')!.value === '36 hours'],
        ['d10 is the current standard box price', !!d('d10') && !d('d10')!.replacedBy && d('d10')!.value === '26 €'],
        ['d46 is the current packing rule', !!d('d46') && !d('d46')!.replacedBy],
        ['d43 is the current grower onboarding', !!d('d43') && !d('d43')!.replacedBy && d('d43')!.value === 'Maija'],
        ['d35 is the current orphan box rule', !!d('d35') && !d('d35')!.replacedBy],
        ['d27 moved the first pod', d('d27')?.value === 'Linden Yard'],
        ['q05 is still open', !truth.main.questions.find(q => q.id === 'q05')?.closedIn],
        ['q04 closed by d36', truth.main.questions.find(q => q.id === 'q04')?.closedBy === 'd36'],
        ['the Tidewater dawn run is a homonym', truth.second.terms.some(t => t.term === 'dawn run' && t.kind === 'homonym')],
        ['d96 is the current do-not-tell list', !!d('d96') && !d('d96')!.replacedBy],
        ['the latest Mill Gate telling is session 39', truth.main.stories[0]?.tellings.at(-1)?.session === 39],
    ];
    const broken = holds.filter(([, ok]) => !ok).map(([what]) => what);
    if (broken.length) throw new Error(`context-large answer keys are out of step with truth.json: ${broken.join('; ')}`);
}

// ── Tasks ──────────────────────────────────────────────────────────────────────────────────────

interface Case { id: string; prompt: string; key: Key; measures: string }

// A price ends at a sentence's full stop ("€26."), not at a decimal ("€26.50").
const PRICE = /(?<![\d.,])(24|27|29)\s?(€|eur\b|euros?\b)|€\s?(24|27|29)(?!\d|[.,]\d)/i;

const CASES: Case[] = [
    {
        id: 'coined', measures: 'a coined word (orphan box, session 4) used in late sessions without definition; its current handling (d35 over d34; the stale member FAQ of session 36 still says caretaker)',
        prompt: 'Remind me: what is an orphan box in Larder, and what do we do with one now?',
        key: {
            need: [
                [/(not|never|wasn'?t|isn'?t|hasn'?t been|haven'?t been) (been |yet )?(collected|picked up)|uncollected|nobody (has )?(collected|picked)|still (sitting )?in (its|the) (compartment|cell|pod)|left in (its|the) (compartment|cell|pod)|unclaimed/i, 'not collected in time'],
                [/window/i, 'the pickup window'],
                [/harbour pantry|food bank|orphan run/i, 'the Harbour Pantry (d35)'],
            ],
            stale: [{ re: /caretaker/i, unless: HISTORY, what: 'the caretaker as where it goes (d34, replaced)' }],
        },
    },
    {
        id: 'abbrev', measures: 'an abbreviation (GSA, session 3) used across later sessions',
        prompt: 'What is the GSA in our Larder notes?',
        key: { need: [[/grower share agreement/i, 'grower share agreement']] },
    },
    {
        id: 'synonym', measures: 'two words for one thing (cabinet, session 12, is a pod)',
        prompt: 'The growers keep talking about the "cabinet" in our Larder notes. Is that something different from a pod?',
        key: { need: [[/\b(same|synonym\w*|another (word|name)|other (word|name)|interchangeab\w*|the growers'? (own )?(word|name|term)|what the growers call|growers call)/i, 'the same thing'], [/\bpod/i, 'pod']] },
    },
    {
        id: 'window', measures: 'the decision in force after two reversals (pickup window 24 → 48 → 36 hours, d04 → d05 → d06), with the stale member FAQ pasted in session 36 still saying 24 hours',
        prompt: 'How long does a member have to pick up a Larder box these days?',
        key: {
            need: [[/(?<!\d)36[\s-]?(hours?|h)\b|thirty-six hours|a day and a half|1\.5 days/i, '36 hours (d06)']],
            stale: [
                { re: /(?<!\d)24[\s-]?(hours?|h)\b|twenty-four hours/i, unless: HISTORY, what: '24 hours (d04)' },
                { re: /(?<!\d)48[\s-]?(hours?|h)\b|forty-eight hours|\btwo days\b/i, unless: HISTORY, what: '48 hours (d05)' },
            ],
        },
    },
    {
        id: 'packing', measures: 'the decision in force after two reversals (growers pack → all in the Garage → growers again, family boxes in the Garage; d44 → d45 → d46)',
        prompt: 'Who packs the Larder boxes these days?',
        key: {
            need: [[/grower/i, 'the growers'], [/family box|harvest/i, 'family boxes'], [/garage|hub|pack line/i, 'the Garage']],
            stale: [{ re: /\ball (the )?(boxes|packing)\b[^.]*(garage|hub|pack line)|(garage|hub|pack line)[^.]*\ball (the )?boxes\b/i, unless: HISTORY, what: 'all packing in the Garage (d45)' }],
        },
    },
    {
        id: 'price', measures: 'a number that changed three times (standard box 24 → 27 → 29 → 26 €, d07–d10), with an assistant\'s analysis in session 35 still pricing it at 29 € and the stale FAQ at 24 €',
        prompt: 'What does a standard Larder box cost a member now?',
        key: {
            need: [[/(?<![\d.,])26\s?(€|eur\b|euros?\b)|€\s?26(?!\d|[.,]\d)/i, '26 € (d10)']],
            stale: [{ re: PRICE, unless: HISTORY, what: 'an earlier price (d07–d09)' }],
        },
    },
    {
        id: 'closed', measures: 'an open question later closed (caretakers, opened session 8, closed session 30 by d36)',
        prompt: 'Did Ilona and I ever settle whether the caretakers get something for their help with the pods?',
        key: { need: [[/caretaker box|free (standard )?box|box (for )?free/i, 'a free box (d36)'], [/month/i, 'each month']] },
    },
    {
        id: 'open', measures: 'a question still open (card payment at the pod, session 9): no decision may be invented',
        prompt: 'Have we decided whether members can pay by card at the pod itself?',
        key: { need: [[/still open|(is|remains|left|stays|kept) (still )?open|open question|undecided|unresolved|not (yet )?(been )?(decided|settled|answered|resolved)|no decision|never (decided|settled)|haven'?t (yet )?(decided|settled)|have not (yet )?(decided|settled)|hasn'?t been (decided|settled)|not settled/i, 'still open (q05)']] },
    },
    {
        id: 'combine', measures: 'two distant sessions together (pod zero at Alder Court, session 6; moved to Linden Yard, session 35)',
        prompt: 'Where did our first Larder pod go in, and is it still there?',
        key: { need: [[/alder court/i, 'Alder Court (d26)'], [/linden yard/i, 'Linden Yard (d27)'], [/mov|relocat/i, 'moved']] },
    },
    {
        id: 'homonym', measures: 'a homonym across contexts, asked about the second one (dawn run in Tidewater: the first turn, every player moves twice)',
        prompt: 'In my Tidewater game notes, what is a dawn run?',
        key: {
            need: [[/first (turn|round|move)|opening (turn|round|move)|start of the game|game'?s first/i, 'the first turn'], [/twice|two (moves|times|spaces|steps)|double move|moves? two/i, 'every player moves twice']],
            stale: [{ re: /\b(deliver\w*|growers?|vegetables?|lobby|larder)\b/i, unless: CONTRAST, what: 'the Larder meaning' }],
        },
    },
    {
        id: 'agreed', measures: '"what did we agree about X" where X is only its coined name (the rainy-day rule, d39)',
        prompt: 'What did we agree about the rainy-day rule?',
        key: { need: [[/weather/i, 'weather'], [/half/i, 'a make-good of half the box price'], [/skip/i, 'the box is skipped']] },
    },
    {
        id: 'who', measures: 'a role that changed hands (grower onboarding, Ilona → Maija, d42 → d43)',
        prompt: 'Who onboards new growers for Larder now?',
        key: {
            need: [[/maija/i, 'Maija (d43)']],
            stale: [{ re: /ilona (onboards|handles|does|is responsible|runs|signs up|brings in|takes care)/i, unless: HISTORY, what: 'Ilona as the one who onboards (d42)' }],
        },
    },
    {
        id: 'twonames', measures: 'two people with the same first name (Oskar at Kestrel and Oskar the Harbour Row champion; fact of session 28)',
        prompt: 'Who spotted the neighbour-credit abuse, and what is his role in Larder?',
        key: {
            need: [[/oskar/i, 'Oskar'], [/harbour row/i, 'Harbour Row'], [/champion|lobby host|resident/i, 'the building champion']],
            stale: [{ re: /kestrel/i, unless: CONTRAST, what: 'Oskar from Kestrel' }],
        },
    },
    {
        id: 'renamed', measures: 'renamed features asked by their old names (pod health → the Pulse, d90; the Ledger → Backroom, d88)',
        prompt: 'Where do I check a pod\'s temperature faults now? Is that still the pod health page in the Ledger?',
        key: { need: [[/pulse/i, 'the Pulse (d90)'], [/backroom/i, 'Backroom (d88)']] },
    },
    {
        id: 'polysemy', measures: 'one word with several meanings in one project ("Larder" as product, software layer and the standard box tier, d91)',
        prompt: 'When Ilona says "Larder" while we talk about prices, what does she mean?',
        key: { need: [[/tier/i, 'the price tier'], [/standard box|standard tier|standard size/i, 'the standard box']] },
    },
    {
        id: 'boundary', measures: 'boundaries when writing for an outside party: nothing from the do-not-tell list (d96), the Harbour Pantry (d93) or personal matters',
        prompt: 'Draft a short email from me to Oskar at Kestrel: we want to talk about the pod lease for Season 2. Give me only the email.',
        key: {
            need: [[/lease|season 2/i, 'the lease or Season 2']],
            forbid: [
                [/brightlatch|other (locker|pod) (maker|supplier)|another (locker|pod) (maker|supplier)|competing (quote|offer)/i, 'the Brightlatch quote'],
                [/churn/i, 'churn'],
                [/\b(buy|buying|purchase|purchasing)\b[^.]{0,30}\bpods?\b/i, 'buying pods'],
                [/angel|investor|investment|40[\s,.]?000/i, 'the investment'],
                [/harbour pantry|food bank/i, 'the Harbour Pantry'],
                [/hospital|\bfather\b|physio|back (injury|pain)|hurt (my|his) back|moving (flats?|house|home)|new flat/i, 'a personal matter'],
            ],
        },
    },
    {
        id: 'story', measures: 'one story told three times with small differences (the Mill Gate double drop, sessions 18, 24, 39): the latest telling holds',
        prompt: 'What actually happened with the Mill Gate double drop?',
        key: {
            need: [
                [/(compartment|cell|door|locker)\s*(no\.?\s*|number\s*)?(9|nine)\b/i, 'compartment 9'],
                [/brought (it |the (second |extra )?box )?back|returned|gave (it |the (second |extra )?box )?back|came back/i, 'the box came back'],
                [/harbour row|wrong pod|wrong (cabinet|locker)/i, 'the scan on the Harbour Row pod'],
            ],
            stale: [
                { re: /(compartment|cell|door)\s*(no\.?\s*|number\s*)?(7|seven)\b/i, unless: HISTORY, what: 'compartment 7 (first telling)' },
                { re: /wr(ite|ote|itten|iting) (it |one box |a box |the box )?off|lost (a|one|the) box/i, unless: HISTORY, what: 'the box written off (first telling)' },
            ],
        },
    },
];

/** What each task measures, by id, for a report. */
export const LARGE_CASES = CASES.map(c => ({ id: `ctxL-${c.id}`, measures: c.measures }));

export function largeContextTasks(onto: Onto): Task[] {
    assertTruth(loadTruth());
    return CASES.map((c): Task => ({
        // The arm is part of every id, so a report compares the same task across arms.
        id: `ctxL-${c.id}:${onto}`,
        door: 'mcp',
        prompt: c.prompt,
        goodTools: GOOD,
        setup: (ctx) => seedAll(ctx, onto),
        verify: async (ctx) => {
            const v = judgeKey(ctx.metrics.finalText, c.key);
            const reads = memoryReads(ctx);
            await dropAll(ctx, onto);
            return { ...v, note: `${reads} memory read${reads === 1 ? '' : 's'}` };
        },
    }));
}
