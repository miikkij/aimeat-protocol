/**
 * @file scripts/cold-agent/fixtures/context-large/generate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes the session notes of the large context fixture from its ground truth.
 *
 *   WHY. The context suite's first fixtures were at most ~3 000 characters, which says nothing about
 *   whether an ontology helps: two people who have worked on an idea for months have hundreds of
 *   thousands of characters of notes, coined words used without definition, and decisions changed
 *   and changed back. truth.json holds that history as data. This script turns it into prose, one
 *   `claude` CLI call per session, and the eval (context-large.ts) seeds the prose as memory records
 *   and takes every answer key from truth.json, never from the prose.
 *
 *   COHERENCE. Each call gets its own session's slice of the truth (terms coined, decisions taken
 *   and the earlier decision each one replaces, questions opened and closed, facts) plus the state
 *   computed from the truth up to the session before (current decisions, open questions, every term
 *   defined so far). No call reads another call's prose, so sessions can be written in parallel and
 *   one can be rewritten alone.
 *
 *   SHAPES. Most sessions are written-up notes. The sessions in the truth's `analyses` are a copy of
 *   a chat thread instead: short messages, and one long analysis an assistant wrote that a person
 *   pasted in, which recommends something the pair then do not do; the decision is in the short
 *   messages. One such analysis quotes a price that had already changed. The truth's `documents`
 *   are pasted verbatim (the member FAQ is pasted again, unchanged and stale, months later), its
 *   `stories` are told three times with differing details, and its `personal` matters come up in
 *   passing. Renamed terms carry the session of their new name, and later notes use it.
 *
 *   CHECKS. A draft is accepted when it is long enough, names every term the session defines, states
 *   the value of every decision the session takes, carries the details its story, document,
 *   personal matter and analysis must carry, and states no value of a decision on the same topic
 *   that the truth places later. A draft that fails is written again with the misses named,
 *   up to three attempts; what still fails is printed, and `--check` re-reads the files on disk.
 *
 *   The output files are the deliverable and are committed. The eval never runs this script.
 * @structure Truth types (from ../../context-large.ts) · state/slice from the truth · prompt ·
 *   claude call · checks · main
 * @usage
 *   cd aimeat && pnpm exec tsx scripts/cold-agent/fixtures/context-large/generate.ts               # missing files only
 *   cd aimeat && pnpm exec tsx scripts/cold-agent/fixtures/context-large/generate.ts --only 7,12 --force
 *   cd aimeat && pnpm exec tsx scripts/cold-agent/fixtures/context-large/generate.ts --check
 *   cd aimeat && pnpm exec tsx scripts/cold-agent/fixtures/context-large/generate.ts --only 29 --print   # the prompt only
 *   AIMEAT_CLAUDE_CMD=<path to claude.exe> sets the program; --concurrency 5 by default.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: 40 Larder sessions and 6 Tidewater playtests from truth.json.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { longDate, type Decision, type Project, type Session, type Term, type Truth } from '../../context-large.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSIONS = join(HERE, 'sessions');

/** The file of one session: `session-NN.md` for the main project, `<slug>-NN.md` for the second. */
const sessionFile = (p: Project, n: number, main: boolean) => join(SESSIONS, `${main ? 'session' : p.slug}-${String(n).padStart(2, '0')}.md`);

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (iso: string) => DAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];

/** Deterministic pseudo-random numbers, so a rewritten session gets the same picks. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const byId = (p: Project, id: string) => p.decisions.find(d => d.id === id);

/** Decisions in force when session `n` starts: taken earlier, and not replaced before `n`. */
function currentBefore(p: Project, n: number): Decision[] {
    return p.decisions.filter(d => d.session < n && !(d.replacedBy && (byId(p, d.replacedBy)?.session ?? Infinity) < n));
}

/** Earlier terms this session uses without defining: the truth's must-use list plus seeded picks. */
function usesFor(p: Project, s: Session): string[] {
    // A document's own name is left out: a note that names it tends to describe what it says.
    const docs = new Set(p.documents.map(d => norm(d.title.replace(/^Larder /, ''))));
    const pool = p.terms.filter(t => t.session <= s.n - 2 && !s.mustUse.includes(t.term) && !(t.renamedIn && t.renamedIn <= s.n) && !t.sense && !docs.has(norm(t.term)));
    const rnd = mulberry32(s.n * 7919 + p.slug.length);
    const picks: string[] = [];
    while (picks.length < Math.min(8, pool.length)) {
        const t = pool[Math.floor(rnd() * pool.length)].term;
        if (!picks.includes(t)) picks.push(t);
    }
    return [...s.mustUse, ...picks];
}

// A homonym is a homonym only across contexts; inside its own project it is a coined word.
function termLine(t: Term, n: number): string {
    const kind = t.kind === 'homonym' ? 'coined' : t.kind;
    const sense = t.sense ? `, one of several meanings of "${t.term}", written as "${t.spelled ?? t.term}"` : '';
    const renamed = t.renamedIn && t.renamedIn < n ? ` RENAMED in session ${t.renamedIn}: it is now called "${t.replacedBy}", so use the new name (someone may slip into the old one once).` : '';
    return `- "${t.term}" (${kind}${t.synonymOf ? `, same thing as "${t.synonymOf}"` : ''}${sense}): ${t.means}.${renamed}`;
}

/** The person who pasted an assistant's analysis: "Ilona's assistant" was pasted by Ilona. */
const owner = (by: string) => by.replace(/'s assistant$/, '');

function prompt(p: Project, s: Session, main: boolean): string {
    const n = s.n;
    const taker = main ? (n % 2 ? 'Rasmus' : 'Ilona') : 'Rasmus';
    const analysis = p.analyses.find(a => a.session === n);
    const words = analysis ? '2 000 to 2 500 words in all' : main ? '1 800 to 2 300 words' : '1 000 to 1 400 words';
    const defined = p.terms.filter(t => t.session < n);
    const here = p.terms.filter(t => t.session === n);
    const decided = p.decisions.filter(d => d.session === n);
    const current = currentBefore(p, n);
    const openBefore = p.questions.filter(q => q.opened < n && !(q.closedIn && q.closedIn < n));
    const opened = p.questions.filter(q => q.opened === n);
    const closed = p.questions.filter(q => q.closedIn === n);
    const facts = p.facts.filter(f => f.session === n);
    const earlierFacts = p.facts.filter(f => f.session < n).slice(-6);
    const people = p.people.filter(x => x.from <= n);
    const later = p.decisions.filter(d => d.session > n).map(d => d.topic);

    const lines: string[] = [];
    lines.push(`You write realistic working notes for an invented project. The notes are test material for an evaluation of how well AI assistants read a person's long-running context, so they must be natural, specific and EXACTLY consistent with the facts given below.`);
    lines.push('');
    lines.push(`PROJECT: ${p.name}. ${p.summary}`);
    lines.push(`Setting: ${p.setting}`);
    lines.push('');
    const day = `${longDate(s.date)} (${weekday(s.date)})`;
    if (analysis) {
        lines.push(`THIS RECORD: ${main ? 'working session' : 'playtest'} ${n} of ${p.sessions.length}, ${day}. Title: "${s.title}". Taking part: ${s.attendees.join(', ')}. This record is NOT a written-up note: it is a copy of the day's thread in the pair's shared chat, kept as the record of the session.`);
    } else {
        lines.push(`THIS NOTE: ${main ? 'working session' : 'playtest'} ${n} of ${p.sessions.length}, ${day}. Title: "${s.title}". Present: ${s.attendees.join(', ')}. The notes are written by ${taker}, in the first person ("I"), with "we" for the group.`);
    }
    lines.push('');
    lines.push('PEOPLE KNOWN SO FAR:');
    for (const x of people) lines.push(`- ${x.name}: ${x.role}${x.from === n ? ' (first appears in this session)' : ''}`);
    const twins = [...new Set(people.map(x => x.name))].filter(name => people.filter(x => x.name === name).length > 1);
    for (const name of twins) lines.push(`(Two different people are called ${name}. The notes often say just "${name}"; make it clear from the context which one is meant, and never mix up what each one did.)`);
    lines.push('');
    if (defined.length) {
        lines.push('WORDS THE GROUP ALREADY USES (defined in earlier notes; use them the way they mean, and NEVER explain them again):');
        for (const t of defined) lines.push(termLine(t, n));
        lines.push('');
    }
    lines.push('DECISIONS IN FORCE AS THIS SESSION STARTS (when you mention one of these subjects, the value here is the current one):');
    for (const d of current) lines.push(`- [${d.topic}] ${d.text}`);
    if (!current.length) lines.push('- none yet');
    lines.push('');
    if (openBefore.length) {
        lines.push('QUESTIONS STILL OPEN FROM EARLIER (you may mention that one is still open; never answer it unless it is listed under CLOSED IN THIS SESSION):');
        for (const q of openBefore) lines.push(`- ${q.question}`);
        lines.push('');
    }
    if (earlierFacts.length) {
        lines.push('EARLIER FIGURES (for consistency only; a newer figure below wins):');
        for (const f of earlierFacts) lines.push(`- ${f.text}`);
        lines.push('');
    }
    lines.push('=== WHAT HAPPENS IN THIS SESSION. All of it must be in the note. ===');
    lines.push(`Subjects: ${s.topics.join(', ')}.`);
    if (here.length) {
        lines.push('New words coined or first used in this session. Introduce each one the way people really coin a word (who said it, why it stuck) and make its meaning clear from the text; write the word exactly as given:');
        for (const t of here) lines.push(termLine(t, n));
    }
    if (decided.length) {
        lines.push('Decisions taken in this session, in this order. State each one plainly with its exact figures, and give the reasons discussed:');
        for (const d of decided) {
            const old = d.replaces ? byId(p, d.replaces) : undefined;
            const changedSoon = d.replacedBy && byId(p, d.replacedBy)?.session === n;
            let line = `- [${d.topic}] ${d.text}`;
            if (changedSoon) line += ' (It is changed again a few minutes later in this same session, see the next line: write it first as it was decided, with its figure.)';
            if (old && old.session === n) line += ` THIS CHANGES, minutes later in this same session, the decision just above ("${old.text}"). Write the change of mind as it happened.`;
            else if (old) line += ` THIS REPLACES the earlier decision of ${longDate(old.date)} ("${old.text}"). Discuss going back on it: what was decided before and why it is changed now.`;
            lines.push(line);
        }
    }
    if (opened.length) {
        lines.push('Questions raised in this session' + (opened.some(q => q.closedIn === n) ? '' : ' and left open (do not answer them)') + ':');
        for (const q of opened) lines.push(`- ${q.question}${q.closedIn === n ? ' (it is also settled in this session, see below)' : ''}`);
    }
    if (closed.length) {
        lines.push('Questions CLOSED IN THIS SESSION. Say that the earlier question is now settled, and how:');
        for (const q of closed) {
            const by = q.closedBy ? byId(p, q.closedBy) : undefined;
            lines.push(`- "${q.question}" (raised on ${longDate(p.sessions[q.opened - 1].date)}): ${q.answer ?? ''} ${by ? by.text : ''}`.trim());
        }
    }
    if (facts.length) {
        lines.push('Figures reported in this session (use them exactly):');
        for (const f of facts) lines.push(`- ${f.text}`);
    }
    for (const st of p.stories) {
        const i = st.tellings.findIndex(x => x.session === n);
        if (i < 0) continue;
        const t = st.tellings[i];
        lines.push(`A story told in this session (${st.topic}), told by ${t.teller}. Tell it with exactly these details, in the teller's words${i ? '; it was told before with some details that turn out different, and this telling is the one to write' : ''}: ${t.text}`);
    }
    for (const doc of p.documents) {
        const paste = doc.pastes.find(x => x.session === n);
        if (!paste) continue;
        lines.push(`A document pasted in full in this session: ${paste.how} Reproduce it VERBATIM, word for word, as a quoted block between two lines of "---":\n<<<\n${doc.text}\n>>>`);
    }
    for (const x of p.personal.filter(y => y.session === n)) lines.push(`A personal matter that comes up in passing (keep it short and human; it has nothing to do with the work): ${x.text}`);
    const uses = usesFor(p, s);
    if (uses.length) lines.push(`Earlier words this note must USE naturally, without explaining them: ${uses.map(u => `"${u}"`).join(', ')}.`);
    lines.push('');
    if (analysis) {
        lines.push('FORMAT OF THIS RECORD (a chat thread):');
        lines.push(`- Messages as "**Name** HH:MM: text". Most messages are short: one or two lines, informal, sometimes a single word. The short messages together are about 700 to 1 000 words.`);
        lines.push(`- At one point ${owner(analysis.by)} pastes, in full, a long analysis that ${analysis.by} (an AI assistant) wrote about ${analysis.about}, introduced by a short message such as "here is what my assistant made of it". Write that analysis as an AI assistant writes one: headings, numbered points, maybe a small table, careful and plausible reasoning from the figures in force before this session, 1 100 to 1 500 words. It recommends ${analysis.recommends}.${analysis.stale ? ` ${analysis.stale}` : ''}`);
        lines.push('- The pair do NOT simply follow the analysis. Every decision of this session is made in the SHORT messages after it, in a few words each (for example "no, let\'s go with X" and "ok, X then"). The analysis itself must not state any decision taken in this session.');
        lines.push('- New words, figures, questions, stories and personal matters above appear in the short messages, never only inside the analysis.');
        lines.push('- No "Actions" list; the thread may end with a short message saying who does what next.');
        lines.push('');
    }
    lines.push('RULES:');
    lines.push(analysis
        ? `- Length: ${words}. Plain Markdown. No title line: it is added separately. Write in English.`
        : `- Length: ${words}. Plain Markdown: a few short sub-headings or none, mostly running prose as people write notes after a meeting, some bullet lists where natural, and an "Actions" list at the end with a name on each action. No title line: it is added separately. Write in English.`);
    lines.push('- Everything in "WHAT HAPPENS IN THIS SESSION" must be in the note, with the exact figures, names and dates given.');
    lines.push(`- Do not invent any other decision, price, percentage, count, date, person, farm, building or company${analysis ? ' (a pasted assistant analysis may contain its own estimates and modelled figures, as such analyses do)' : ''}. You may add colour that decides nothing: the weather, coffee, a phone call, worries, jokes, half-ideas put on the parking lot, small to-dos, reasoning, options discussed and left alone.`);
    lines.push('- Do not answer an open question that is not closed in this session. Do not mention anything that happens after this session\'s date.');
    lines.push('- Do not quote or describe the content of any document, list or message that is not given in full here. Use only the words listed above as the group\'s own words; describe anything else in plain words.');
    lines.push('- Use the earlier words freely and without explanation, as people do with their own jargon. A reader who missed the earlier notes should NOT be able to learn an old word\'s meaning from this note.');
    if (later.length) lines.push(`- Later sessions will decide more about: ${[...new Set(later)].join(', ')}. Do not anticipate those outcomes.`);
    lines.push('- Output only the note itself: no preamble, no commentary, no closing remark.');
    return lines.join('\n');
}

/** One `claude` call in print mode, from an empty directory with no project settings. */
function callClaude(text: string): Promise<string> {
    const cmd = process.env.AIMEAT_CLAUDE_CMD ?? 'claude';
    const cwd = mkdtempSync(join(tmpdir(), 'aimeat-ctx-large-'));
    return new Promise((resolve, reject) => {
        // One command string, as run.ts spawns the agent: an argument array under a shell drops the
        // empty value of --tools.
        const child = spawn(`"${cmd}" -p --model ${process.env.AIMEAT_GEN_MODEL ?? 'opus'} --effort high --output-format text --tools "" --setting-sources project --strict-mcp-config`, { shell: true, cwd });
        let out = '', err = '';
        child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            rmSync(cwd, { recursive: true, force: true });
            if (code !== 0 || !out.trim()) reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
            else resolve(out.trim());
        });
        child.stdin.end(text);
    });
}

const norm = (s: string) => s.toLowerCase().replace(/\u00a0|\u202f/g, ' ').replace(/[’‘]/g, '\'');

/** A value as it may be written: "26 €" also as "€26", "26 euros"; "36 hours" also as "36-hour". */
function valueForms(v: string): RegExp {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s?');
    const money = /^(\d[\d ]*)\s?€$/.exec(v);
    if (money) { const num = money[1].trim().replace(/ /g, '[\\s,.]?'); return new RegExp(`(?<![\\d.])(${num}\\s?(€|eur|euros?)|€\\s?${num})(?![\\d])`, 'i'); }
    const hours = /^(\d+) hours$/.exec(v);
    if (hours) return new RegExp(`(?<!\\d)${hours[1]}[\\s-]?(hours?|h)\\b`, 'i');
    const pct = /^(\d+) %$/.exec(v);
    if (pct) return new RegExp(`(?<![\\d.])${pct[1]}\\s?(%|per ?cent)`, 'i');
    return new RegExp(esc, 'i');
}

const STOP = new Set(['and', 'the', 'a', 'an', 'of', 'in', 'for', 'to', 'one']);
/** Whether a text states a value: money, hours and percentages in any usual form; any other value word by word. */
function hasValue(text: string, v: string): boolean {
    if (guarded(v)) return valueForms(v).test(text);
    const t = norm(text);
    return v.split(/[\s,]+/).filter(w => w && !STOP.has(w.toLowerCase())).every(w => /^\d+$/.test(w) ? new RegExp(`(?<!\\d)${w}(?!\\d)`).test(t) : t.includes(norm(w).replace(/s$/, '')));
}

/** A chat message writes a price as a bare number ("family box 39 then"). */
function bareMoney(text: string, v: string): boolean {
    const m = /^(\d+)\s?€$/.exec(v);
    return !!m && new RegExp(`(?<![\\d.,])${m[1]}(?![\\d]|[.,]\\d)`).test(text);
}

/** Ordinary phrases a note may use before the session that turns them into the group's own word. */
const EARLY_OK = new Set(['first drop', 'drop day', 'box week', 'extension', 'move', 'cut', 'retro', 'cold start', 'midsummer review', 'kill criteria', 'surplus', 'Season 2', 'lobby walk', 'onboarding pack',
    'parking lot', 'pickup window', 'skip week', 'floor price', 'Harvest', 'Sprout', 'standard box', 'small box', 'family box', 'waitlist']);
/** A coined word, name or abbreviation distinctive enough that its use before its session is a slip. */
const earlyGuarded = (t: Term) => ['coined', 'name', 'abbreviation'].includes(t.kind) && !t.sense && !EARLY_OK.has(t.term.replace(/^the /, ''))
    && (/^[A-Z]{2,4}$/.test(t.term) || t.term.replace(/^the /, '').length >= 7);

/** A value worth guarding against appearing too early: money, hours or a percentage. */
const guarded = (v?: string) => !!v && /^(\d[\d ]*\s?€|\d+ hours|\d+ %)$/.test(v);

/** What a draft misses or says too early. Empty when it is accepted. */
function checkDraft(p: Project, s: Session, text: string, main: boolean): string[] {
    const t = norm(text);
    const misses: string[] = [];
    const analysis = p.analyses.find(a => a.session === s.n);
    const least = analysis ? 11000 : main ? 9000 : 4500;
    if (text.length < least) misses.push(`it is too short (${text.length} characters; it needs at least ${least} characters)`);
    for (const term of p.terms.filter(x => x.session === s.n)) if (!t.includes(norm(term.spelled ?? term.term).replace(/^the /, ''))) misses.push(`the new word "${term.spelled ?? term.term}" does not appear`);
    const said = (w: string) => t.includes(norm(w)) || (/€$/.test(w) && hasValue(text, w));
    for (const st of p.stories) for (const tell of st.tellings.filter(x => x.session === s.n)) for (const w of tell.mustSay) if (!said(w)) misses.push(`the story of ${st.topic} lacks "${w}"`);
    for (const x of p.personal.filter(y => y.session === s.n)) for (const w of x.mustSay) if (!said(w)) misses.push(`the personal matter lacks "${w}"`);
    for (const w of analysis?.mustSay ?? []) if (!said(w)) misses.push(`the pasted analysis must use the figure ${w}`);
    for (const term of p.terms.filter(x => x.session > s.n && earlyGuarded(x))) {
        const w = (term.spelled ?? term.term).replace(/^the /, '');
        const found = /^[A-Z]{2,4}$/.test(w) ? new RegExp(`\\b${w}\\b`).test(text) : t.includes(norm(w));
        if (found) misses.push(`it uses "${w}", a word only coined in session ${term.session}; describe the thing in other words`);
    }
    // A document is quoted only where it is pasted, and its content is never described elsewhere.
    for (const doc of p.documents) if (!doc.pastes.some(x => x.session === s.n) && t.includes(norm(doc.title.replace(/^Larder /, '')))) misses.push(`it mentions the ${doc.title}; leave that document out of this note`);
    for (const doc of p.documents.filter(d => d.pastes.some(x => x.session === s.n))) {
        // Markdown emphasis and quote marks around the pasted lines are fine; the words are not.
        const flat = t.replace(/[*_>]/g, '').replace(/\s+/g, ' ');
        const lost = doc.text.split('\n').filter(Boolean).filter(line => !flat.includes(norm(line).replace(/\s+/g, ' ')));
        if (lost.length) misses.push(`the pasted document "${doc.title}" is not verbatim: "${lost[0]}" is missing or altered`);
    }
    for (const d of p.decisions.filter(x => x.session === s.n)) if (d.value && d.value !== 'none' && !hasValue(text, d.value) && !(analysis && bareMoney(text, d.value))) misses.push(`the decision "${d.text}" is not stated with its value ${d.value}`);
    for (const f of p.facts.filter(x => x.session === s.n)) for (const num of f.text.match(/\d[\d ]*\d|\d/g) ?? []) if (!t.includes(num) && !t.includes(num.replace(/ /g, ',')) && !t.includes(num.replace(/ /g, ''))) misses.push(`the figure ${num} from "${f.text}" is missing`);
    // A later value of a topic this session already has in force must not show up early.
    // A figure some decision of this session or an earlier one already uses ("5 €" for the neighbour
    // credit) is not a slip, even when a later decision on another topic uses it too.
    const topicsNow = new Set([...currentBefore(p, s.n), ...p.decisions.filter(d => d.session === s.n)].map(d => d.topic));
    const valuesSoFar = new Set(p.decisions.filter(d => d.session <= s.n).map(d => d.value));
    for (const d of p.decisions.filter(x => x.session > s.n && topicsNow.has(x.topic) && guarded(x.value) && !valuesSoFar.has(x.value))) {
        const nowValues = [...currentBefore(p, s.n), ...p.decisions.filter(x => x.session <= s.n)].filter(x => x.topic === d.topic).map(x => x.value);
        if (!nowValues.includes(d.value) && valueForms(d.value!).test(text)) misses.push(`it names ${d.value} for ${d.topic}, which is only decided later; leave that figure out`);
    }
    return [...new Set(misses)];
}

async function writeSession(p: Project, s: Session, main: boolean): Promise<string[]> {
    const base = prompt(p, s, main);
    let misses: string[] = [];
    let body = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
        const ask = misses.length ? `${base}\n\nAN EARLIER DRAFT OF THIS NOTE WAS REJECTED because: ${misses.join('; ')}. Write the whole note again and fix these.` : base;
        body = await callClaude(ask);
        misses = checkDraft(p, s, body, main);
        if (!misses.length) break;
        console.log(`  ${p.slug} ${s.n} attempt ${attempt}: ${misses.length} miss(es)`);
    }
    const head = main ? `# ${p.name} · session ${s.n} · ${longDate(s.date)} · ${s.title}` : `# ${p.name} · playtest ${s.n} · ${longDate(s.date)} · ${s.title}`;
    writeFileSync(sessionFile(p, s.n, main), `${head}\n\n${body}\n`);
    return misses;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const get = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
    const truth = JSON.parse(readFileSync(join(HERE, 'truth.json'), 'utf8')) as Truth;
    mkdirSync(SESSIONS, { recursive: true });
    const only = get('only')?.split(',').map(x => x.trim());
    const jobs: Array<{ p: Project; s: Session; main: boolean }> = [];
    for (const [p, main] of [[truth.main, true], [truth.second, false]] as const) {
        for (const s of p.sessions) {
            const id = main ? String(s.n) : `${p.slug}-${s.n}`;
            if (only && !only.includes(id)) continue;
            jobs.push({ p, s, main });
        }
    }

    if (argv.includes('--print')) {
        for (const j of jobs) console.log(`${prompt(j.p, j.s, j.main)}\n\n────────\n`);
        return;
    }

    if (argv.includes('--check')) {
        let bad = 0, chars = 0;
        for (const j of jobs) {
            const f = sessionFile(j.p, j.s.n, j.main);
            if (!existsSync(f)) { console.log(`${f}: missing`); bad++; continue; }
            const body = readFileSync(f, 'utf8').replace(/^# .*\n\n/, '');
            chars += body.length;
            const misses = checkDraft(j.p, j.s, body, j.main);
            if (misses.length) { bad++; console.log(`${j.p.slug} ${j.s.n}: ${misses.join('; ')}`); }
        }
        console.log(`${jobs.length - bad} of ${jobs.length} pass; ${chars} characters of notes`);
        process.exitCode = bad ? 1 : 0;
        return;
    }

    const todo = jobs.filter(j => argv.includes('--force') || !existsSync(sessionFile(j.p, j.s.n, j.main)));
    const width = Number(get('concurrency') ?? 5);
    const failed: string[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: width }, async () => {
        while (next < todo.length) {
            const j = todo[next++];
            const t0 = Date.now();
            try {
                const misses = await writeSession(j.p, j.s, j.main);
                console.log(`${j.p.slug} ${j.s.n}: written in ${Math.round((Date.now() - t0) / 1000)} s${misses.length ? `, still missing: ${misses.join('; ')}` : ''}`);
                if (misses.length) failed.push(`${j.p.slug} ${j.s.n}`);
            } catch (e) {
                failed.push(`${j.p.slug} ${j.s.n}`);
                console.log(`${j.p.slug} ${j.s.n}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }));
    console.log(failed.length ? `not accepted: ${failed.join(', ')}` : `all ${todo.length} accepted`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
