/**
 * @file scripts/cold-agent/house-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a published document keeps the three house rules the `share-to-workspace`
 *   and `share-with-family-member` tasks dictate: shoes off at the door, quiet after ten, whoever
 *   cooks does not wash up. Three answers: pass, fail, and unverified, which a person reads.
 *
 *   WHAT THIS CHECK CAN PROVE, AND WHAT IT CANNOT. It proves that a document says the three rules
 *   in one of the wordings listed below and nothing else, and it proves that a document breaks a
 *   rule in one of the ways listed below. It cannot understand free text, and it does not try to:
 *   anything else is unverified, which is never counted as a pass or as a failure of the model.
 *   Its results are evidence for this one task, never a score that ranks models.
 *
 *   WHY IT PASSES ONLY WHAT IT KNOWS. Three versions of 2026-11-08 tried to read free text with
 *   patterns, and each re-check of the instruction audit found wordings they got wrong: first the
 *   word stems anywhere, title included; then rules weakened into an option, the cook excused in
 *   other words, a contradiction after the right rules, a body in metadata or an HTML comment;
 *   then "Whoever cooks says the guest does not wash up.", "Whoever does not cook does not wash
 *   up.", "The cook is not excused from washing up.", "You may keep quiet after ten." and the
 *   three rules quoted under "examples from an old handbook, not our current rules", all passed.
 *   Every round made the patterns wider and found a new wording. So the default is turned round:
 *     - pass needs every rule in an ACCEPTED wording (a whole sentence, anchored at both ends),
 *       every other sentence a heading or a short introduction, and no quotation or framing that
 *       says the rules are examples, old or not in force;
 *     - fail needs a rule missing or a KNOWN contradiction (turned round, weakened into an option,
 *       the cook made responsible or refused the exemption, the exemption given to the non-cook);
 *     - everything else is unverified.
 *   The audit's 24 cases are permanent in test/unit/cold-agent-house-rules-cases.ts.
 *
 *   Only the document's own body is read: a record's top-level `markdown` (the platform's
 *   document shape, `{ title, markdown }`), or its top-level `text`, `body` or `content` when it
 *   has no markdown; never a nested field or a title, and HTML comments are removed.
 * @structure documentBodies(objects) · houseRulesCheck(text) → { verdict, rules, other, framed } · houseRulesMissing(text)
 * @usage
 *   const check = houseRulesCheck(documentBodies(read.data?.objects));
 *   if (check.verdict === 'pass') ...
 * @version-history
 *   v3.0.0 — 2026-11-08 — Pass only on accepted wordings with nothing else in the body; known
 *     contradictions fail; everything else is unverified (instruction audit re-check, round 3).
 *   v2.0.0 — 2026-11-08 — Body only from the record's own top-level field, HTML comments removed;
 *     each sentence classified (says, contradicts, mentions); verdict pass, fail or unverified.
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
export interface HouseRulesCheck {
    verdict: 'pass' | 'fail' | 'unverified';
    rules: Array<{ name: string; state: RuleState }>;
    /** Sentences that are neither a rule nor a heading: each one keeps the verdict from a pass. */
    other: string[];
    /** The body quotes the rules or calls them examples, old or not in force. */
    framed: boolean;
}

const NEG = String.raw`(?:does\s+not|doesn't|do\s+not|don't|did\s+not|didn't|never|is\s+not|isn't|are\s+not|aren't|need\s+not|needn't|won't|will\s+not|shall\s+not|must\s+not|mustn't|should\s+not|shouldn't|cannot|can't)`;
const W = String.raw`(?:\w+\s+)`;
/** Words that make a rule an option or a wish. */
const WEAK = new RegExp(String.raw`\b(?:not\s+(?:required|necessary|needed|mandatory|compulsory|obligatory|expected|enforced|a\s+rule)|optional|if\s+you\s+(?:like|want|wish|prefer)|up\s+to\s+you|(?:is|are)\s+encouraged|recommended|preferably|ideally|when\s+convenient|no\s+need\s+to|(?:${NEG})\s+have\s+to|free\s+to)\b`);

const SHOE = String.raw`(?:shoes?|footwear)`;
const PLACE = String.raw`(?:\s+(?:at\s+the\s+(?:door|front\s+door|entrance)|indoors|inside|in\s+the\s+(?:house|flat|apartment|hall)|when\s+you\s+come\s+in))?`;
const TIME = String.raw`(?:ten|10(?::00)?(?:\s*(?:pm|p\.m\.))?|22(?::00)?)(?:\s+o'clock)?(?:\s+(?:at\s+night|in\s+the\s+evening|pm))?`;
const WASH = String.raw`(?:wash(?:es)?\s+up|washing\s+up|do(?:es)?\s+the\s+(?:dishes|washing[- ]up)|doing\s+the\s+(?:dishes|washing[- ]up)|wash(?:es)?\s+the\s+dishes|the\s+(?:dishes|washing[- ]up))`;
const PLEASE = String.raw`(?:please\s+)?`;
const END = String.raw`(?:,?\s+please)?$`;
const COOK_WHO = String.raw`(?:whoever|the\s+(?:one|person)\s+who|anyone\s+who|those\s+who|the\s+people\s+who)`;

const anchored = (...forms: string[]) => forms.map(f => new RegExp('^' + f));

interface Rule {
    name: string;
    /** The wordings that keep the rule: each a whole sentence. */
    accepted: RegExp[];
    /** Whether a sentence breaks the rule in one of the known ways. */
    contradicts: (s: string) => boolean;
    /** Whether a sentence is about the rule's subject at all. */
    about: (s: string) => boolean;
}

const shoes: Rule = {
    name: 'shoes off at the door',
    accepted: anchored(
        String.raw`${PLEASE}(?:no\s+)?${SHOE}\s+off${PLACE}${END}`,
        String.raw`${PLEASE}(?:take|kick|slip)\s+(?:your\s+|our\s+|all\s+)?${SHOE}\s+off${PLACE}${END}`,
        String.raw`${PLEASE}(?:take|kick|slip)\s+off\s+(?:your\s+)?${SHOE}${PLACE}${END}`,
        String.raw`${PLEASE}remove\s+(?:your\s+)?${SHOE}${PLACE}${END}`,
        String.raw`${PLEASE}leave\s+(?:your\s+)?${SHOE}\s+at\s+the\s+(?:door|front\s+door|entrance)${END}`,
        String.raw`no\s+${SHOE}(?:\s+(?:indoors|inside|in\s+the\s+(?:house|flat|apartment)|past\s+the\s+door|beyond\s+the\s+door))?${END}`,
        String.raw`${SHOE}\s+(?:come|go|are\s+taken)\s+off${PLACE}${END}`,
        String.raw`never\s+(?:keep|wear)\s+(?:your\s+)?${SHOE}\s+on\s+(?:indoors|inside|in\s+the\s+(?:house|flat|apartment))${END}`,
    ),
    contradicts: s => new RegExp(String.raw`\b${SHOE}\b`).test(s) && (
        WEAK.test(s)
        || (new RegExp(String.raw`(?<!\bno\s)\b${SHOE}\s+(?:stay\s+|remain\s+|are\s+kept\s+|can\s+stay\s+|may\s+stay\s+)?on\b(?=\s*(?:$|[,;:]|indoors|inside|in\s+the\s+(?:house|flat|apartment)|at\s+home|at\s+all|is\b|are\b))|\b(?:keep|leave)\s+${W}{0,2}${SHOE}\s+on\b|\b(?:wear|wearing)\s+${W}{0,2}${SHOE}\s+(?:indoors|inside|in\s+the\s+(?:house|flat|apartment)|at\s+home)\b`).test(s)
            && !new RegExp(String.raw`\b${NEG}\s+${W}{0,2}(?:keep|wear|leave)\b`).test(s))
        || new RegExp(String.raw`\b${NEG}\s+(?!forget)${W}{0,2}(?:take|remove|kick|slip)\b`).test(s)),
    about: s => new RegExp(String.raw`\b${SHOE}\b`).test(s),
};

const quiet: Rule = {
    name: 'quiet after ten',
    accepted: anchored(
        String.raw`${PLEASE}(?:keep\s+|be\s+|stay\s+)?quiet\s+(?:after|from)\s+${TIME}${END}`,
        String.raw`(?:after|from)\s+${TIME},?\s+${PLEASE}(?:keep\s+|be\s+|stay\s+)?quiet${END}`,
        String.raw`quiet\s+hours\s+(?:start|begin)\s+at\s+${TIME}${END}`,
        String.raw`quiet\s+hours\s+(?:are\s+)?from\s+${TIME}${END}`,
        String.raw`no\s+(?:loud\s+)?noise\s+(?:after|from)\s+${TIME}${END}`,
        String.raw`${PLEASE}keep\s+(?:it|the\s+noise)\s+down\s+(?:after|from)\s+${TIME}${END}`,
        String.raw`(?:do\s+not|don't)\s+make\s+(?:any\s+)?noise\s+(?:after|from)\s+${TIME}${END}`,
    ),
    contradicts: s => /\b(?:quiet|noise|noisy|loud|silence|silent)\b/.test(s) && (
        WEAK.test(s)
        || new RegExp(String.raw`\b${NEG}\s+${W}{0,3}(?:be\s+|stay\s+|keep\s+)?(?:quiet|silent)\b|\bnoise\s+(?:is\s+)?(?:fine|allowed|ok|okay|welcome)\b|(?<!\b(?:${NEG}|no)\s+)\b(?:be|get)\s+loud\b|\bloud\s+(?:is\s+)?(?:fine|ok|okay|allowed)\b`).test(s)),
    about: s => /\b(?:quiet|noise|noisy|loud|silence|silent)\b/.test(s),
};

const cook: Rule = {
    name: 'whoever cooks does not wash up',
    accepted: anchored(
        String.raw`${COOK_WHO}\s+cooks?,?\s+(?:${NEG}|does\s+not\s+have\s+to|doesn't\s+have\s+to|never\s+has\s+to)\s+${WASH}${END}`,
        String.raw`the\s+cook\s+(?:${NEG}|does\s+not\s+have\s+to|doesn't\s+have\s+to|never\s+has\s+to)\s+${WASH}${END}`,
        String.raw`(?:${COOK_WHO}\s+cooks?|the\s+cook)\s+is\s+(?:excused|exempt|let\s+off)\s+from\s+${WASH}${END}`,
        String.raw`(?:if|when)\s+you\s+cook,?\s+(?:you\s+)?(?:do\s+not|don't|never|need\s+not|needn't|do\s+not\s+have\s+to|don't\s+have\s+to)\s+${WASH}${END}`,
        String.raw`(?:(?:if|when)\s+you\s+cook|${COOK_WHO}\s+cooks?),?\s+(?:someone|somebody|everyone)\s+else\s+${WASH}${END}`,
        String.raw`${COOK_WHO}\s+(?:did\s+not|didn't|does\s+not|doesn't)\s+cook\s+${WASH}${END}`,
    ),
    contradicts: s => /\bcook/.test(s) && new RegExp(String.raw`\b${WASH}\b|\bwash`).test(s) && (
        // The exemption refused: "The cook is not excused from washing up".
        new RegExp(String.raw`\bcook\w*\b[^.!?]*\b${NEG}\s+${W}{0,2}(?:excused|exempt(?:ed)?|spared|let\s+off)\b`).test(s)
        // The exemption given to the people who did NOT cook: "Whoever does not cook does not wash up".
        || new RegExp(String.raw`\b(?:${COOK_WHO}|anyone|those)\s+(?:${NEG})\s+cook\w*\b[^.!?]*\b${NEG}\s+${W}{0,3}wash`).test(s)
        // An obligation on the cook with no negation: "The cook is responsible for washing up".
        || (new RegExp(String.raw`\bcook\w*\b[^.!?]*\b(?:must|should|has\s+to|have\s+to|also|too|will|(?:is|are)\s+responsible\s+for|(?:is|are)\s+in\s+charge\s+of|takes?\s+care\s+of|handles?|washes|does\s+the\s+dishes|cleans\s+up)\b`).test(s)
            && !new RegExp(String.raw`\b${NEG}\b`).test(s))),
    about: s => /\bcook/.test(s) && /\b(?:wash|dishes)/.test(s),
};

const RULES: Rule[] = [shoes, quiet, cook];

/** A heading or a short introduction: allowed beside the rules, never a rule itself. */
const HEADING = /^(?:(?:our|the|these\s+are\s+(?:our|the))\s+)?(?:(?:house|home|family|household)\s+)?rules(?:\s+(?:of|for)\s+(?:the|our)\s+(?:house|home|household))?$|^here\s+are\s+(?:our|the)\s+(?:house\s+|home\s+|family\s+)?rules$|^(?:please\s+)?follow\s+(?:these|our)\s+(?:house\s+)?rules$|^(?:kotisäännöt|kodin\s+säännöt|house\s+rules)$/;

/** A body that presents the rules as examples, history or not in force. */
const FRAMING = /\b(?:examples?|for\s+illustration|old|outdated|former|previous|no\s+longer|used\s+to|not\s+(?:our\s+|the\s+)?(?:current|actual|real)|draft|proposal|suggestions?)\b/;

interface Sentence { text: string; quoted: boolean }

/** The sentences of a text, lower-cased, tags and markdown marks removed; a quoted line is marked. */
function sentences(text: string): Sentence[] {
    const out: Sentence[] = [];
    for (const line of text.replace(/<[^>]+>/g, ' ').replace(/[’‘]/g, "'").split(/\n+/)) {
        const quoted = /^\s*>/.test(line);
        for (const part of line.split(/(?<=[.!?;])\s+|:\s+/)) {
            const s = part.replace(/^[\s>*\-#\d.)]+/, '').replace(/[*_`"“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?;:]+$/, '').trim();
            if (s) out.push({ text: s, quoted });
        }
    }
    return out;
}

/**
 * Each rule's state: broken when a sentence contradicts it in a known way, kept when a sentence
 * says it in an accepted wording, unclear when a sentence is about it otherwise, missing when none
 * is. The verdict is fail when a rule is broken or missing; pass when all three are kept, every
 * other sentence is a heading, and nothing is quoted or framed; unverified otherwise.
 */
export function houseRulesCheck(text: string): HouseRulesCheck {
    const all = sentences(text);
    const other: string[] = [];
    const states = new Map<Rule, { kept: boolean; broken: boolean; about: boolean }>(RULES.map(r => [r, { kept: false, broken: false, about: false }]));
    for (const s of all) {
        let placed = false;
        for (const r of RULES) {
            const st = states.get(r)!;
            if (r.accepted.some(re => re.test(s.text))) { st.kept = true; placed = true; continue; }
            if (r.contradicts(s.text)) { st.broken = true; placed = true; continue; }
            if (r.about(s.text)) { st.about = true; placed = true; }
        }
        if (!placed && !HEADING.test(s.text)) other.push(s.text);
    }
    const framed = all.some(s => s.quoted) || all.some(s => FRAMING.test(s.text));
    const rules = RULES.map((r) => {
        const st = states.get(r)!;
        const state: RuleState = st.broken ? 'broken' : st.kept ? 'kept' : st.about ? 'unclear' : 'missing';
        return { name: r.name, state };
    });
    const verdict = rules.some(r => r.state === 'broken' || r.state === 'missing') ? 'fail'
        : rules.every(r => r.state === 'kept') && other.length === 0 && !framed ? 'pass'
        : 'unverified';
    return { verdict, rules, other, framed };
}

/**
 * What keeps the document from a pass, in words: each rule not kept with its state, then any
 * sentence that is not a rule, then a framing. Empty on a pass.
 */
export function houseRulesMissing(text: string): string[] {
    const c = houseRulesCheck(text);
    return [
        ...c.rules.filter(r => r.state !== 'kept').map(r => `${r.name} (${r.state})`),
        ...c.other.slice(0, 3).map(s => `a sentence that is not one of the rules: "${s.slice(0, 80)}"`),
        ...(c.framed ? ['the rules are quoted, or called examples, old or not in force'] : []),
    ];
}
