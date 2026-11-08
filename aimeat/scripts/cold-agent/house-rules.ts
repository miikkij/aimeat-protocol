/**
 * @file scripts/cold-agent/house-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a published document keeps the three house rules the `share-to-workspace`
 *   and `share-with-family-member` tasks dictate: shoes off at the door, quiet after ten, whoever
 *   cooks does not wash up. The answer has three values: pass, fail, or unverified when a sentence
 *   is about a rule and the check cannot tell whether it keeps it, so a person reads that run.
 *
 *   WHY A RULE IS READ, NOT A WORD. The first stricter check (2026-11-08) looked for the word
 *   stems "shoe", "quiet" and "wash" anywhere in the published records, the title included. The
 *   re-check of the instruction audit the same day showed two wrong documents passing it: the
 *   three rules turned round and a title "shoe quiet wash" over the text "No rules supplied."
 *
 *   WHY EACH SENTENCE IS CLASSIFIED. The second check matched a "says" and a "contradicts" pattern
 *   per rule. The second re-check found it still wrong both ways: "Shoes off at the door is not
 *   required." and "Being quiet after ten is not required." passed (the rule's words were there),
 *   "The cook is excused from washing up." failed (the pattern wanted the word "cook" twice), a
 *   contradiction added after the three rules ("The cook is responsible for washing up.") passed,
 *   and a body hidden in `metadata.body` or in an HTML comment was read as the document. So now:
 *     - only the document's own body is read: a record's top-level `markdown` (the platform's
 *       document shape, `{ title, markdown }`), or its top-level `text`, `body` or `content` when it
 *       has no markdown; never a nested field, never a title, and HTML comments are removed;
 *     - each sentence is classified per rule as saying it, contradicting it, or only mentioning its
 *       subject; a sentence that weakens a rule into an option ("not required", "optional", "if you
 *       like") contradicts it, and a negation before an obligation turns it round;
 *     - one contradicting sentence anywhere breaks the rule, whatever else the document says.
 *   The counter-cases the re-checks found are permanent in test/unit/cold-agent-house-rules.test.ts.
 * @structure documentBodies(objects) · houseRulesCheck(text) → { verdict, rules } · houseRulesMissing(text)
 * @usage
 *   const check = houseRulesCheck(documentBodies(read.data?.objects));
 *   if (check.verdict === 'pass') ...
 * @version-history
 *   v2.0.0 — 2026-11-08 — Body only from the record's own top-level field, HTML comments removed;
 *     each sentence classified (says, contradicts, mentions) with weakening and negation; verdict
 *     pass, fail or unverified (instruction audit re-check, round 2).
 *   v1.0.0 — 2026-11-08 — Initial: per-rule sentence check with a contradiction check, body only.
 */

/** A record's own body fields, in the order they are tried. `markdown` is the document shape. */
const BODY_FIELDS = ['markdown', 'text', 'body', 'content'] as const;

/**
 * The body of one record: its first top-level body field that holds a string, comments removed.
 * The workspace read spreads a record's value onto the entry (routes/organisms/workspace-read.ts);
 * a memory record that still wraps it in `value` is read from the top level of that value, and no
 * deeper.
 */
function recordBody(rec: unknown, unwrap = true): string | null {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    const r = rec as Record<string, unknown>;
    for (const f of BODY_FIELDS) {
        if (typeof r[f] === 'string') return (r[f] as string).replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
    }
    return unwrap ? recordBody(r.value, false) : null;
}

/**
 * The bodies of the records in a workspace read's `objects` (or `drafts`): `{ <space>: [record…] }`,
 * or an array of records. Records only, one level: a body nested deeper is not the document.
 */
export function documentBodies(objects: unknown): string {
    const records: unknown[] = Array.isArray(objects)
        ? objects
        : objects && typeof objects === 'object'
            ? Object.values(objects as Record<string, unknown>).flatMap(v => (Array.isArray(v) ? v : [v]))
            : [];
    return records.map(r => recordBody(r)).filter((b): b is string => b !== null).join('\n\n');
}

export type RuleState = 'kept' | 'broken' | 'unclear' | 'missing';
export interface HouseRulesCheck { verdict: 'pass' | 'fail' | 'unverified'; rules: Array<{ name: string; state: RuleState }> }

type SentenceClass = 'says' | 'contradicts' | 'mentions' | null;
interface Rule { name: string; classify: (s: string) => SentenceClass }

const NEG = String.raw`(?:does\s+not|doesn't|do\s+not|don't|did\s+not|didn't|never|is\s+not|isn't|are\s+not|aren't|need\s+not|needn't|won't|will\s+not|shall\s+not|must\s+not|mustn't|should\s+not|shouldn't|cannot|can't)`;
const W = String.raw`(?:\w+\s+)`;
/** Words that make a rule an option or a wish: a sentence with one of them does not keep the rule. */
const WEAK = new RegExp(String.raw`\b(?:not\s+(?:required|necessary|needed|mandatory|compulsory|obligatory|expected|enforced|a\s+rule)|optional|if\s+you\s+(?:like|want|wish|prefer)|up\s+to\s+you|(?:is|are)\s+encouraged|recommended|preferably|ideally|when\s+convenient|no\s+need\s+to|(?:${NEG})\s+have\s+to|free\s+to)\b`);

const SHOE = String.raw`(?:shoes?|footwear)`;
const shoes: Rule = {
    name: 'shoes off at the door',
    classify(s) {
        if (!new RegExp(String.raw`\b${SHOE}\b`).test(s)) return null;
        if (WEAK.test(s)) return 'contradicts';
        // "Never keep your shoes on" says the rule; "keep your shoes on" turns it round.
        const negated = new RegExp(String.raw`\b${NEG}\s+${W}{0,2}(?:keep|wear|leave)\b`).test(s);
        const kept = new RegExp(String.raw`(?<!\bno\s)\b${SHOE}\s+(?:stay\s+|remain\s+|are\s+kept\s+|can\s+stay\s+|may\s+stay\s+)?on\b(?=\s*(?:$|[,;:]|indoors|inside|in\s+the\s+(?:house|flat|apartment)|at\s+home|at\s+all|is\b|are\b))|\b(?:keep|leave)\s+${W}{0,2}${SHOE}\s+on\b|\b(?:wear|wearing)\s+${W}{0,2}${SHOE}\s+(?:indoors|inside|in\s+the\s+(?:house|flat|apartment)|at\s+home)\b`).test(s);
        if (kept && !negated) return 'contradicts';
        if (new RegExp(String.raw`\b${NEG}\s+(?!forget)${W}{0,2}(?:take|remove|kick|slip)\b`).test(s)) return 'contradicts';
        const off = new RegExp(String.raw`\b${SHOE}\s+(?:come\s+|go\s+|are\s+|stay\s+)?off\b|\b(?:take|took|taking|takes|kick|leave|leaving|slip)\s+${W}{0,2}${SHOE}\s+off\b|\b(?:take|kick|slip)\s+off\s+${W}{0,2}${SHOE}\b|\bremov(?:e|ing)\s+${W}{0,2}${SHOE}\b|\bno\s+${SHOE}\b|\b${SHOE}[- ]free\b`).test(s);
        return off || (kept && negated) ? 'says' : 'mentions';
    },
};

const TIME = String.raw`(?:ten|10(?::00)?(?:\s*(?:pm|p\.m\.))?|22(?::00)?)`;
const quiet: Rule = {
    name: 'quiet after ten',
    classify(s) {
        if (!/\b(?:quiet|noise|noisy|loud|silence|silent)\b/.test(s)) return null;
        if (WEAK.test(s)) return 'contradicts';
        if (new RegExp(String.raw`\b${NEG}\s+${W}{0,3}(?:be\s+|stay\s+|keep\s+)?(?:quiet|silent)\b|\bnoise\s+(?:is\s+)?(?:fine|allowed|ok|okay|welcome)\b|(?<!\b(?:${NEG}|no)\s+)\b(?:be|get)\s+loud\b|\bloud\s+(?:is\s+)?(?:fine|ok|okay|allowed)\b`).test(s)) return 'contradicts';
        const after = String.raw`\b(?:after|from|past|by|at|beyond)\s+${TIME}\b`;
        const says = new RegExp(String.raw`\b(?:quiet|silence|silent)\b[^.!?]*${after}|${after}[^.!?]*\b(?:quiet|silence|silent)\b|\b(?:no|${NEG}\s+(?:make\s+)?)\s*(?:loud\s+)?noise\b[^.!?]*${after}|${after}[^.!?]*\bno\s+(?:loud\s+)?noise\b|\bkeep\s+(?:it|the\s+noise)\s+down\b[^.!?]*${after}|\b${NEG}\s+be\s+loud\b[^.!?]*${after}`).test(s);
        return says ? 'says' : 'mentions';
    },
};

const WASH = String.raw`(?:wash(?:es|ing)?(?:\s+up)?|do(?:es|ing)?\s+the\s+(?:dishes|washing[- ]up)|(?:the\s+)?dishes|(?:the\s+)?washing[- ]up|clean(?:s|ing)?\s+up)`;
const cook: Rule = {
    name: 'whoever cooks does not wash up',
    classify(s) {
        if (!/\bcook/.test(s) || !new RegExp(String.raw`\b${WASH}\b`).test(s)) return null;
        // Someone other than the cook washes: "Whoever did not cook washes up", "someone else does the dishes".
        if (new RegExp(String.raw`\b(?:someone\s+else|somebody\s+else|the\s+others?|everyone\s+else|the\s+non-cooks?|(?:whoever|the\s+(?:one|person|people)\s+who|those\s+who|anyone\s+who)\s+(?:did\s+not|didn't|does\s+not|doesn't|do\s+not|don't)\s+cook)\b[^.!?]*\b${WASH}`).test(s)) return 'says';
        // The cook is negated, excused or spared: "Whoever cooks does not wash up", "The cook is excused from washing up".
        if (new RegExp(String.raw`\bcook(?:s|ed|ing)?\b[^.!?]*?\b${NEG}\s+${W}{0,3}${WASH}|\bcook\w*\b[^.!?]*\b(?:excused|exempt(?:ed)?|spared|let\s+off|off\s+the\s+hook|free\s+from)\b(?:\s+from)?\s+${W}{0,2}${WASH}|\bcook\w*\b[^.!?]*\b(?:skips?|gets?\s+out\s+of|never\s+has\s+to)\s+${W}{0,2}${WASH}`).test(s)) return 'says';
        // An obligation on the cook with no negation: "The cook is responsible for washing up".
        if (new RegExp(String.raw`\bcook\w*\b[^.!?]*\b(?:must|should|has\s+to|have\s+to|also|too|will|(?:is|are)\s+responsible\s+for|(?:is|are)\s+in\s+charge\s+of|takes?\s+care\s+of|handles?|washes|does\s+the\s+dishes|cleans\s+up)\b`).test(s)
            && !new RegExp(String.raw`\b${NEG}\b`).test(s)) return 'contradicts';
        return 'mentions';
    },
};

const RULES: Rule[] = [shoes, quiet, cook];

/** The sentences of a text, lower-cased, tags and markdown marks removed. */
function sentences(text: string): string[] {
    return text
        .replace(/<[^>]+>/g, ' ')
        .replace(/[’‘]/g, "'")
        .split(/(?<=[.!?;])\s+|\n+/)
        .map(s => s.replace(/^[\s>*\-#\d.)]+/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Each rule's state: broken when any sentence contradicts it, kept when one says it, unclear when a
 * sentence is about it and the check cannot classify it, missing otherwise. The verdict is fail when
 * a rule is broken or missing, unverified when one is unclear, and pass when all three are kept.
 */
export function houseRulesCheck(text: string): HouseRulesCheck {
    const all = sentences(text);
    const rules = RULES.map((r) => {
        const classes = all.map(s => r.classify(s));
        const state: RuleState = classes.includes('contradicts') ? 'broken'
            : classes.includes('says') ? 'kept'
            : classes.includes('mentions') ? 'unclear'
            : 'missing';
        return { name: r.name, state };
    });
    const verdict = rules.some(r => r.state === 'broken' || r.state === 'missing') ? 'fail'
        : rules.some(r => r.state === 'unclear') ? 'unverified'
        : 'pass';
    return { verdict, rules };
}

/** The rules not kept, each with its state: "quiet after ten (broken)". Empty on a pass. */
export function houseRulesMissing(text: string): string[] {
    return houseRulesCheck(text).rules.filter(r => r.state !== 'kept').map(r => `${r.name} (${r.state})`);
}
