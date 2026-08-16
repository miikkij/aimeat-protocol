/**
 * @file check-plain-language.ts
 * @description Does a message a PERSON hears read like a sentence, and does it leave them somewhere
 *   to go?
 *
 *   WHAT IT MEASURES, AND WHY NOT READABILITY. The obvious instrument is a readability formula —
 *   Flesch-Kincaid, Gunning Fog, SMOG — and it is the wrong one on its own. Those score word and
 *   sentence LENGTH, not comprehensibility, so "The optimistic lock refused the write" scores as
 *   easy reading: seven short words, one short sentence, and meaningless to the person it stops.
 *   A formula alone would wave through exactly the messages this exists to catch. The reading ease
 *   is reported because it is cheap and occasionally telling, and it is not gated.
 *
 *   What IS gated are the two things a stopped person actually needs, both of which are decidable
 *   without judgement:
 *     1. no vocabulary that only we understand
 *     2. somewhere to go next
 *
 *   AUDIENCE FIRST. Of 2107 messages a caller can see, more than half are never heard by a person:
 *   the agent reads them, corrects its call and retries. Demanding plain English of those would be
 *   busywork that buries the ones that matter, so middleware/message-audience.ts decides who is
 *   listening and only the `person` and `ours` groups are held to this.
 *
 *   A RATCHET, NOT A CLIFF. There are hundreds of existing messages and they cannot all be rewritten
 *   at once. security/plain-language-baseline.json records what was already there; the gate fails on
 *   anything NEW. The file may only shrink, and each entry is a message somebody will one day read
 *   and not understand.
 * @structure
 *   - collect() — every user-visible message, with its code and file
 *   - score() — jargon hits, next-step presence, reading ease
 *   - main() — report; --check gates new offenders, --record refreshes the baseline
 * @usage
 *   pnpm check:plain-language          # the gate
 *   pnpm check:plain-language --report # the full picture, including what is baselined
 *   pnpm check:plain-language --record # after fixing a batch, or when adding a known offender
 * @version-history
 *   v1.0.0 -- 2026-08-16 -- Initial, from the measurement of what our 2107 messages actually say.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audienceOf, nextStepFor, type MessageAudience } from '../src/middleware/message-audience.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BASELINE = path.join(ROOT, 'security', 'plain-language-baseline.json');

/**
 * Words that carry meaning only if you build this. Not a style list — every one of these has been
 * seen in a message handed to somebody who had no way to know what it meant.
 */
const JARGON = [
    'gaii', 'ghii', 'geai', 'scope', 'scopes', 'namespace', 'principal', 'payload', 'schema',
    'enum', 'endpoint', 'route', 'jwt', 'base64', 'uuid', 'json', 'cors', 'zod', 'semver',
    'slug', 'prefix', 'regex', 'middleware', 'manifest', 'descriptor', 'idempotent', 'envelope',
    'dispatch', 'handler', 'mcp', 'rest', 'cron', 'dag', 'blob', 'mime', 'querystring', 'sha256',
    'hash', 'boolean', 'null', 'undefined', 'array', 'params', 'param', 'parameter', 'field',
    'denied', 'forbidden', 'unauthorized', 'malformed', 'unprocessable',
];

/** Somewhere to go: an instruction, an alternative, or a question they can answer. */
const NEXT_STEP = /\b(use |try |add |ask |run |call |pass |open |go to|read |set |choose|pick |sign in|instead|then |first,|omit )/i;

interface Message { file: string; line: number; code: string; text: string; audience: MessageAudience }

const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d)) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
};

/**
 * DOORS THAT DO NOT OPEN ONTO A PERSON, whatever code they answer with.
 *
 * The code alone is not enough to know who is listening. A federation handshake answers
 * `UNAUTHORIZED` with "Invalid signature" — a person-facing code carrying a machine-to-machine
 * message, because the caller is another node. And the admin surface answers an OPERATOR, who knows
 * perfectly well what CORS is; telling them "some settings could not be saved" would be worse than
 * the sentence they have.
 *
 * Flagging either would be a false positive, and false positives are how a gate gets ignored — which
 * costs more than the messages it would have caught.
 */
const NOT_A_PERSON = /\/(federation|peers?|admin|operator)[-/.]|\/routes\/(federation|admin)\b/;

/** Every message built with error(), which is the only way a refusal reaches a caller. */
function collect(): Message[] {
    const found: Message[] = [];
    for (const file of walk(path.join(ROOT, 'src', 'routes'))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const src = readFileSync(file, 'utf8');
        const re = /error\(\s*config\.nodeId\s*,\s*'([A-Z_]+)'\s*,\s*(['"`])([\s\S]*?)\2/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
            found.push({
                file: rel,
                line: src.slice(0, m.index).split('\n').length,
                code: m[1],
                text: m[3],
                audience: NOT_A_PERSON.test(rel) ? 'machine' : audienceOf(m[1]),
            });
        }
    }
    return found;
}

/** Flesch reading ease. Reported, never gated — see the file header for why it cannot stand alone. */
function readingEase(text: string): number {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return 100;
    const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
    const syllables = words.reduce((n, w) => {
        const v = w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g);
        return n + Math.max(1, v ? v.length : 1);
    }, 0);
    return Math.round(206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length));
}

interface Finding { key: string; reasons: string[]; text: string; where: string }

function score(m: Message): Finding | null {
    // Only what a person hears. A machine reading its own mistake is better served by precision.
    if (m.audience !== 'person' && m.audience !== 'ours') return null;

    // SCORE WHAT THE PERSON SEES, not the template that produces it. `${ghii?.morselBalance ?? 0}`
    // renders as "3"; scoring the source would fail that message for the word `ghii`, which nobody
    // is ever shown. The placeholder keeps the sentence's shape so length and flow still count.
    const shown = m.text.replace(/\$\{[^}]*\}/g, 'that');
    const reasons: string[] = [];
    const words = new Set(shown.toLowerCase().match(/[a-z_]+/g) ?? []);
    const hits = JARGON.filter(j => words.has(j));
    if (hits.length) reasons.push(`words only we understand: ${hits.join(', ')}`);
    // An identifier in the sentence, rather than in `details` where a technical reader looks.
    if (/`[^`]+`|[a-z]+_[a-z_]+|\/v1\//.test(shown)) reasons.push('an identifier in the sentence');
    // Somewhere to go, from EITHER the sentence itself or the floor error() gives this code. Asking
    // for it twice would be asking 696 routes to repeat what the envelope already says.
    if (!NEXT_STEP.test(shown) && !nextStepFor(m.code)) reasons.push('nowhere to go next');
    if (shown.length > 160) reasons.push(`${shown.length} characters`);

    // Keyed on the CODE plus a digest of the text, not on file and line. A line number churns on
    // every unrelated edit above it, and file+code would let a second bad message hide behind a
    // baselined first one. A digest also means EDITING a listed message brings it back to the gate,
    // which is right: if you are already in the sentence, improve it.
    const key = `${m.code}|${createHash('sha256').update(m.text).digest('hex').slice(0, 12)}`;
    return reasons.length ? { key, reasons, text: m.text, where: `${m.file}:${m.line}` } : null;
}

function main(): void {
    const check = process.argv.includes('--check');
    const record = process.argv.includes('--record');
    const report = process.argv.includes('--report');

    const messages = collect();
    const heard = messages.filter(m => m.audience === 'person' || m.audience === 'ours');
    const findings = messages.map(score).filter((f): f is Finding => f !== null);

    let baseline: string[] = [];
    try {
        baseline = (JSON.parse(readFileSync(BASELINE, 'utf8')) as { messages?: string[] }).messages ?? [];
    } catch { baseline = []; }
    const known = new Set(baseline);
    const fresh = findings.filter(f => !known.has(f.key));

    if (record) {
        const keys = [...new Set(findings.map(f => f.key))].sort();
        writeFileSync(BASELINE, `${JSON.stringify({
            _note: 'Messages a PERSON hears that do not yet read like a sentence or do not say where to go '
                + 'next. Recorded debt, NOT approval: each one is something somebody will read and not '
                + 'understand. This file may only SHRINK. Refresh with: pnpm check:plain-language --record',
            _measured: '2026-08-16: 2107 messages a caller can see, 490 refusal-shaped, 22 of those saying '
                + 'what to do next, and 43 reading exactly "Access denied".',
            messages: keys,
        }, null, 2)}\n`, 'utf8');
        console.log(`✓ recorded ${keys.length} message(s) to security/plain-language-baseline.json`);
    }

    const eases = heard.map(m => readingEase(m.text)).sort((a, b) => a - b);
    console.log('# Plain language — the messages a person hears\n');
    console.log(`  messages a caller can see   ${messages.length}`);
    console.log(`  ...that a PERSON hears      ${heard.length}`);
    console.log(`  ...already fine             ${heard.length - findings.length}`);
    console.log(`  ...recorded as debt         ${findings.length - fresh.length}`);
    console.log(`  ...NEW                      ${fresh.length}`);
    console.log(`  median reading ease         ${eases[Math.floor(eases.length / 2)] ?? 0}  (reported, never gated)`);

    if (report) {
        console.log('\n## everything still on the list');
        for (const f of findings) console.log(`  ${f.key}\n    "${f.text.slice(0, 90)}"\n    ${f.reasons.join(' · ')}`);
    }

    if (check && fresh.length) {
        console.error(`\n✖ ${fresh.length} NEW message(s) a person would not understand:\n`);
        for (const f of fresh) {
            console.error(`  ${f.where}  [${f.key}]`);
            console.error(`    "${f.text.slice(0, 110)}"`);
            console.error(`    ${f.reasons.join(' · ')}\n`);
        }
        console.error('A person stopped by one of these has to guess what happened and has nowhere to go.');
        console.error('middleware/refusals.ts has builders for the common cases; they take a plain sentence');
        console.error('and put the identifiers in `details`, where a technical reader looks for them.');
        console.error('If it genuinely cannot be improved yet: pnpm check:plain-language --record');
        process.exit(1);
    }
    if (check) console.log('\n✓ no new message that a person would be left guessing at.');
}

main();
