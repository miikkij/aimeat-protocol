/**
 * @file scripts/cold-agent/house-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a published document keeps the three house rules the `share-to-workspace`
 *   task dictates: shoes off at the door, quiet after ten, whoever cooks does not wash up.
 *
 *   WHY A RULE IS READ, NOT A WORD. The first stricter check (2026-11-08) looked for the word
 *   stems "shoe", "quiet" and "wash" anywhere in the published records, the title included. The
 *   re-check of the instruction audit the same day showed two wrong documents passing it: the
 *   three rules turned round ("Keep shoes on indoors. Do not be quiet after ten. Whoever cooks
 *   must wash up.") and a title "shoe quiet wash" over the text "No rules supplied." So each rule
 *   is now a sentence that must say the rule, and a sentence that says its opposite fails it, and
 *   only the document's body is read, never its title.
 * @structure documentBodies(objects) · houseRulesMissing(text) → the rules not kept
 * @usage
 *   const missing = houseRulesMissing(documentBodies(read.data?.objects));
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: per-rule sentence check with a contradiction check, body only.
 */

/** The fields a workspace document or record keeps its body in. A title is never one of them. */
const BODY_KEYS = new Set(['markdown', 'text', 'body', 'content', 'html']);

/** Every body string under a workspace read's `objects`, at any depth, joined by blank lines. */
export function documentBodies(objects: unknown): string {
    const out: string[] = [];
    const walk = (v: unknown, key: string | null) => {
        if (typeof v === 'string') { if (key !== null && BODY_KEYS.has(key)) out.push(v); return; }
        if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
        if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
    };
    walk(objects, null);
    return out.join('\n\n');
}

interface Rule { name: string; says: RegExp; contradicts: RegExp }

const NOT = String.raw`(?:does\s+not|doesn't|doesn’t|do\s+not|don't|don’t|never|is\s+not|isn't|need\s+not|needn't|won't|will\s+not)`;

/**
 * Each rule: a sentence that says it, and a sentence that says the opposite. Read one sentence at a
 * time, so a "not" in one rule never counts for another.
 */
const RULES: Rule[] = [
    {
        name: 'shoes off at the door',
        says: /\b(?:shoes?\s+(?:come\s+|go\s+|are\s+)?off|(?:take|took|taking|kick|leave)\s+(?:\w+\s+){0,2}shoes?\s+off|(?:take|kick)\s+off\s+(?:\w+\s+){0,2}shoes?|remove\s+(?:\w+\s+){0,2}shoes?|no\s+shoes)\b/i,
        contradicts: new RegExp(String.raw`\b(?:shoes?\s+(?:stay\s+|remain\s+|are\s+kept\s+)?on\b|keep\s+(?:\w+\s+){0,2}shoes?\s+on|(?:wear|wearing)\s+(?:\w+\s+){0,2}shoes?\s+(?:indoors|inside|in\s+the\s+house)|${NOT}\s+(?:\w+\s+){0,2}(?:take|remove)\s+(?:\w+\s+){0,2}shoes?)`, 'i'),
    },
    {
        name: 'quiet after ten',
        says: /\bquiet\b[^.!?\n]*\b(?:after|from|past|by)\s+(?:ten|10|22)\b|\b(?:after|from|past)\s+(?:ten|10|22)\b[^.!?\n]*\bquiet\b/i,
        contradicts: new RegExp(String.raw`\b(?:${NOT}|no\s+need\s+to)\s+(?:\w+\s+){0,2}(?:be\s+)?quiet\b|\bnoise\s+(?:is\s+)?(?:fine|allowed|ok)\b`, 'i'),
    },
    {
        name: 'whoever cooks does not wash up',
        says: new RegExp(String.raw`\b(?:whoever|who(?:ever)?|the\s+(?:one|person)\s+who|the\s+cook)\b[^.!?\n]*\bcook[a-z]*\b[^.!?\n]*\b(?:${NOT}|is\s+excused\s+from|skips?|is\s+spared)\s+(?:\w+\s+){0,2}(?:wash(?:es|ing)?(?:\s+up)?|(?:do(?:es)?|doing)\s+the\s+dishes|the\s+dishes)|\bthe\s+cook\b[^.!?\n]*\b${NOT}\s+(?:\w+\s+){0,2}wash`, 'i'),
        contradicts: /\bcook[a-z]*\b[^.!?\n]*\b(?:must|should|has\s+to|have\s+to|also|will|washes)\s+(?:\w+\s+){0,2}(?:wash|do\s+the\s+dishes)/i,
    },
];

/** The sentences of a text: split at a full stop, a question or exclamation mark, or a line end. */
function sentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.replace(/^[\s>*\-#\d.)]+/, '').trim()).filter(Boolean);
}

/**
 * The names of the rules the text does not keep: a rule is kept when one sentence says it and no
 * sentence says its opposite. An empty array means all three are there and none is turned round.
 */
export function houseRulesMissing(text: string): string[] {
    const all = sentences(text);
    return RULES
        .filter(r => !all.some(s => r.says.test(s) && !r.contradicts.test(s)) || all.some(s => r.contradicts.test(s)))
        .map(r => r.name);
}
