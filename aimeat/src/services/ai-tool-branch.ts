/**
 * @file ai-tool-branch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which road a person takes to connect their AI, decided from the app they name: the
 *   alias map (what a model may call its own app → one id of the setup table), the branch decision,
 *   and the options of the two questions it can ask. It reads the table in ai-tool-setup.ts and never
 *   keeps a second list.
 * @structure AI_TOOL_IDS · AI_CLIENT_ALIASES · resolveAiClient() · capabilityOf() · decideBranch() ·
 *   aiClientVariantOptions() · aiClientQuestionOptions()
 * @usage import { resolveAiClient, decideBranch } from '../services/ai-tool-branch.js';
 * @version-history
 *   v1.2.0 — 2026-10-11 — The consumer Gemini app (`gemini-app`) is region-dependent (Jouni's ruling,
 *     2026-10-11): naming it raises the `conditions` question, and the person's answer
 *     (`meetsConditions`) decides A or B. The tier and the conditions share conditionalBranch().
 *   v1.1.0 — 2026-10-11 — The six tools the table gained, with their aliases; Cursor, Perplexity and
 *     Copilot Studio join the paid-tier set (Cursor's pricing page lists MCP on its paid plans only).
 *   v1.0.0 — 2026-10-11 — Moved unchanged from ai-tool-setup.ts, which the tools added to its table
 *     (Mistral, LM Studio, Gemini CLI, Perplexity, OpenClaw, Copilot Studio) took past 800 lines.
 *     Its history before the move is in that file's header.
 */
import type { AimeatConfig } from '../config.js';
import { buildAiToolSetup, lang, s, type McpCapability } from './ai-tool-setup.js';

// ─────────────────────────────────────────────────────────────────────────────
// The branch decision (aimeat_remake/04-mcp-kyvykkyys.md)
//
// MCP capability belongs to the CLIENT APP, not the model. The same model is capable in Claude
// Desktop and incapable behind a web UI with no connectors, because the model does not open
// connections — the app it runs in does. So the deciding field is `ai-client`, and the ids of the
// setup table ARE the list of apps that can. Nothing here is a second table: this maps what a model
// may call its own app onto one of those ids.
// ─────────────────────────────────────────────────────────────────────────────

/** All ids in this table, for callers that need the set without building the localized list. */
export const AI_TOOL_IDS = [
    'claude-web', 'claude-desktop', 'claude-code', 'chatgpt', 'codex', 'cursor', 'vscode', 'grok',
    'goose', 'mistral', 'lmstudio', 'gemini-cli', 'gemini-app', 'perplexity', 'openclaw', 'copilot-studio',
] as const;
export type AiToolId = typeof AI_TOOL_IDS[number];

/**
 * Which tools need a paid tier. Everything else in the table works on its free one. The table's own
 * `capability` says the same per tool, and test/unit/ai-client-branch.test.ts holds the two equal.
 */
const PLAN_DEPENDENT: ReadonlySet<string> = new Set<string>(['chatgpt', 'grok', 'cursor', 'perplexity', 'copilot-studio']);

/**
 * Which tools connect only where the vendor offers it, under conditions the table's `plans` line
 * names. The Gemini app: the United States, 18 or over, a personal account, English, Keep Activity
 * on (Jouni's ruling, 2026-10-11; watch-gemini-kuluttajasovelluksen-mcp-euroopassa re-checks it
 * monthly). Held equal to the table by the same test as PLAN_DEPENDENT.
 */
const REGION_DEPENDENT: ReadonlySet<string> = new Set<string>(['gemini-app']);

/**
 * What a model may claim about the app it is running in → which of the eight it is.
 *
 * Keys are NORMALIZED (lowercased, every non-alphanumeric removed), so one entry covers a family
 * of spellings: `claudeai` matches "claude.ai", "Claude AI" and "CLAUDE-AI" alike. Vendor names
 * are here too ("anthropic", "openai", "xai") because a model asked which app it is in commonly
 * answers with who made it.
 *
 * This map grows from the unknown names the funnel collects (onboarding.ai_model_detected), never
 * from guesses — the same rule as the table above.
 */
export const AI_CLIENT_ALIASES: Readonly<Record<string, AiToolId>> = {
    // claude.ai — the recommended first path, so bare "claude" resolves here.
    claude: 'claude-web',
    claudeai: 'claude-web',
    claudeweb: 'claude-web',
    claudecom: 'claude-web',
    anthropic: 'claude-web',
    anthropicclaude: 'claude-web',
    claudeaiweb: 'claude-web',
    // Claude Desktop
    claudedesktop: 'claude-desktop',
    claudedesktopapp: 'claude-desktop',
    claudeapp: 'claude-desktop',
    claudeformac: 'claude-desktop',
    claudeforwindows: 'claude-desktop',
    // Claude Code
    claudecode: 'claude-code',
    claudecodecli: 'claude-code',
    claudecli: 'claude-code',
    // ChatGPT
    chatgpt: 'chatgpt',
    chatgptweb: 'chatgpt',
    chatgptplus: 'chatgpt',
    chatgptpro: 'chatgpt',
    openai: 'chatgpt',
    openaichatgpt: 'chatgpt',
    gpt: 'chatgpt',
    gpt4: 'chatgpt',
    gpt4o: 'chatgpt',
    gpt5: 'chatgpt',
    gpt51: 'chatgpt',
    // goose — open source, Apache-2.0, now under the Linux Foundation's Agentic AI Foundation.
    goose: 'goose',
    blockgoose: 'goose',
    codenamegoose: 'goose',
    goosecli: 'goose',
    goosedesktop: 'goose',
    // Codex CLI
    codex: 'codex',
    codexcli: 'codex',
    openaicodex: 'codex',
    // Cursor
    cursor: 'cursor',
    cursorai: 'cursor',
    cursoride: 'cursor',
    cursoreditor: 'cursor',
    // VS Code / Copilot
    vscode: 'vscode',
    visualstudiocode: 'vscode',
    copilot: 'vscode',
    githubcopilot: 'vscode',
    vscodecopilot: 'vscode',
    copilotchat: 'vscode',
    // Grok
    grok: 'grok',
    grokcom: 'grok',
    xai: 'grok',
    xaigrok: 'grok',
    // Mistral: Le Chat, renamed Vibe in 2026.
    mistral: 'mistral',
    mistralai: 'mistral',
    lechat: 'mistral',
    mistrallechat: 'mistral',
    mistralvibe: 'mistral',
    // LM Studio
    lmstudio: 'lmstudio',
    lmstudiobionic: 'lmstudio',
    // Gemini CLI. The bare id is also the variant answer of the Gemini question
    // (ai-client-families.ts), which is matched first; this reaches a claim that only contains it.
    geminicli: 'gemini-cli',
    // The consumer Gemini app, the same way. "Gemini" alone stays the family question.
    geminiapp: 'gemini-app',
    geminiweb: 'gemini-app',
    geminigooglecom: 'gemini-app',
    // Perplexity
    perplexity: 'perplexity',
    perplexityai: 'perplexity',
    // OpenClaw
    openclaw: 'openclaw',
    // Copilot Studio, the same: a variant answer of the Microsoft Copilot question as well.
    copilotstudio: 'copilot-studio',
    microsoftcopilotstudio: 'copilot-studio',
} as const;

import { AI_CLIENT_FAMILIES, AI_FAMILY_ALIASES, VARIANT_BY_ID, normalizeAiClientClaim, type AiClientFamily, type AiClientVariant } from './ai-client-families.js';

export { AI_CLIENT_FAMILIES, normalizeAiClientClaim, type AiClientFamily, type AiClientVariant } from './ai-client-families.js';

/** Aliases longest-first, so "claudecode" wins over "claude" in a containment match. */
const ALIASES_BY_LENGTH: ReadonlyArray<readonly [string, AiToolId]> =
    Object.entries(AI_CLIENT_ALIASES)
        .sort((a, b) => b[0].length - a[0].length) as ReadonlyArray<readonly [string, AiToolId]>;

export type AiClientResolution =
    | { kind: 'known'; id: AiToolId; capability: McpCapability; matched: string }
    /** A name two apps share, one of which cannot connect. Raises a question, never a refusal. */
    | { kind: 'family'; family: AiClientFamily; claim: string }
    /** One named variant of a family. Whether it counts depends on WHO named it — see decideBranch. */
    | { kind: 'variant'; family: AiClientFamily; variant: AiClientVariant }
    /** Nothing matched, or nothing was claimed. NOT the same as "incapable" — see decideBranch. */
    | { kind: 'unknown'; claim: string | null };

/**
 * Resolve a model's claim about its own app to one of the eight ids.
 *
 * Two passes: an exact match on the normalized claim, then the longest alias CONTAINED in it —
 * models rarely answer with a bare app name ("Claude Sonnet 4.5 via claude.ai"), and refusing to
 * read those would push perfectly capable people into the "unknown" path for a phrasing habit.
 * Longest-first ordering is what keeps "…via claude code" from resolving as claude.ai.
 */
export function resolveAiClient(claim: string | null | undefined): AiClientResolution {
    const raw = typeof claim === 'string' ? claim.trim() : '';
    if (!raw) return { kind: 'unknown', claim: null };
    const norm = normalizeAiClientClaim(raw);
    if (!norm) return { kind: 'unknown', claim: raw };

    // A variant id is only ever an ANSWER to the which-variant question, so it is matched whole.
    const variant = VARIANT_BY_ID.get(norm);
    if (variant) return { kind: 'variant', family: variant.family, variant: variant.variant };

    const exact = AI_CLIENT_ALIASES[norm];
    if (exact) return { kind: 'known', id: exact, capability: capabilityOf(exact), matched: norm };

    // Families before the containment pass, longest name first: "microsoftcopilot" contains
    // "copilot", which would otherwise resolve as GitHub Copilot in VS Code.
    const familyAlias = Object.keys(AI_FAMILY_ALIASES).sort((a, b) => b.length - a.length).find(a => norm.includes(a));
    const longestTool = ALIASES_BY_LENGTH.find(([alias]) => norm.includes(alias));
    if (familyAlias && (!longestTool || familyAlias.length >= longestTool[0].length)) {
        const family = AI_CLIENT_FAMILIES.find(f => f.id === AI_FAMILY_ALIASES[familyAlias]);
        if (family) return { kind: 'family', family, claim: raw };
    }
    if (longestTool) return { kind: 'known', id: longestTool[1], capability: capabilityOf(longestTool[1]), matched: longestTool[0] };
    return { kind: 'unknown', claim: raw };
}

/** A tool's capability. Everything in the table can speak MCP; only the vendor's condition varies. */
export function capabilityOf(id: string): McpCapability {
    if (PLAN_DEPENDENT.has(id)) return 'plan-dependent';
    return REGION_DEPENDENT.has(id) ? 'region-dependent' : 'yes';
}

/** What the person still has to be asked, if anything. */
export type BranchQuestion = 'which-client' | 'paid-plan' | 'which-variant' | 'conditions';

export type BranchDecision =
    | { branch: 'A'; reason: 'known-capable' | 'plan-confirmed' | 'conditions-confirmed' | 'unknown-defaults-to-a' | 'variant-capable'; toolId?: AiToolId }
    /**
     * The three routes to B, and all are the PERSON's own answer: they do not have the tier their
     * app requires, they do not meet the vendor's conditions (the Gemini app outside the United
     * States), or they said which of two same-named apps they use and that one cannot connect.
     */
    | { branch: 'B'; reason: 'plan-missing' | 'conditions-missing'; toolId: AiToolId }
    | { branch: 'B'; reason: 'variant-has-no-mcp'; family: string; variant: string }
    | { branch: 'ask'; question: BranchQuestion; toolId?: AiToolId; family?: string };

/** The branch for a tool with a vendor condition: ask, and let only the person's answer decide. */
function conditionalBranch(id: AiToolId, capability: McpCapability, answers: BranchAnswers): BranchDecision {
    if (capability === 'region-dependent') {
        if (answers.meetsConditions === true) return { branch: 'A', reason: 'conditions-confirmed', toolId: id };
        if (answers.meetsConditions === false) return { branch: 'B', reason: 'conditions-missing', toolId: id };
        return { branch: 'ask', question: 'conditions', toolId: id };
    }
    if (answers.hasPaidPlan === true) return { branch: 'A', reason: 'plan-confirmed', toolId: id };
    if (answers.hasPaidPlan === false) return { branch: 'B', reason: 'plan-missing', toolId: id };
    return { branch: 'ask', question: 'paid-plan', toolId: id };
}

/** The person's answers so far. Each is absent until they have given it. */
export interface BranchAnswers {
    /** Whether they have the tier their app requires. */
    hasPaidPlan?: boolean;
    /** Whether they meet the vendor's conditions (country, age, account, language). */
    meetsConditions?: boolean;
    /** Which app they talked in. */
    clientAnswer?: string;
}

/**
 * The branch, from what we know so far.
 *
 * The rule that shapes every line of this: **an app NAME can never send anyone to branch B.**
 * A wrong A costs one attempt. A wrong B tells someone whose tools were fine that their tools are
 * not good enough, and they have no way to argue. So:
 *   - a known app that needs no paid tier      → A
 *   - a known app that does                    → ask about the tier (not a refusal, a question)
 *   - a known app the vendor offers only in some countries → ask about its conditions
 *   - an app we have never heard of, or none   → ask which app; if they cannot say, A anyway
 *
 * @param resolution  what resolveAiClient made of the model's claim
 * @param answers.hasPaidPlan  the person's answer to the tier question, once they have given one
 * @param answers.meetsConditions the person's answer to the conditions question, once given
 * @param answers.clientAnswer the person's answer to "which app did you talk in", once given.
 *   `other` and `dont-know` both mean: try A. If the connection then fails, B is where they land,
 *   having lost one attempt rather than being turned away on a guess.
 */
export function decideBranch(
    resolution: AiClientResolution,
    answers: BranchAnswers = {},
): BranchDecision {
    if (resolution.kind === 'unknown') {
        const ans = answers.clientAnswer?.trim();
        if (ans && ans !== 'other' && ans !== 'dont-know') {
            // They named an app. Read it through the same map — the answer is not privileged.
            const again = resolveAiClient(ans);
            if (again.kind === 'known') return decideBranch(again, { hasPaidPlan: answers.hasPaidPlan, meetsConditions: answers.meetsConditions });
            // A family or one of its variants keeps the answer with it: whether a variant that
            // cannot connect means B depends on the person having said it themselves.
            if (again.kind !== 'unknown') return decideBranch(again, answers);
        }
        if (ans) return { branch: 'A', reason: 'unknown-defaults-to-a' };
        return { branch: 'ask', question: 'which-client' };
    }

    if (resolution.kind === 'family') {
        // The person may have answered the variant question already; their answer is read through
        // the same resolver, and only a variant of THIS family counts.
        const again = answers.clientAnswer ? resolveAiClient(answers.clientAnswer) : null;
        if (again?.kind === 'variant' && again.family.id === resolution.family.id) return decideBranch(again, answers);
        if (again && again.kind !== 'family') return decideBranch(again, answers);
        return { branch: 'ask', question: 'which-variant', family: resolution.family.id };
    }

    if (resolution.kind === 'variant') {
        if (resolution.variant.mcp) {
            // The Gemini app carries its row's region condition with it. Copilot Studio's paid tier
            // is not asked here: the person who names it is building an agent there already.
            const capability = capabilityOf(resolution.variant.id);
            return capability === 'region-dependent'
                ? conditionalBranch(resolution.variant.id as AiToolId, capability, answers)
                : { branch: 'A', reason: 'variant-capable' };
        }
        // A variant that cannot connect sends the person to B only when THEY named it. A model that
        // says "I am the Gemini app" is still a name, and a name raises the question instead.
        const theySaidSo = !!answers.clientAnswer
            && normalizeAiClientClaim(answers.clientAnswer) === normalizeAiClientClaim(resolution.variant.id);
        return theySaidSo
            ? { branch: 'B', reason: 'variant-has-no-mcp', family: resolution.family.id, variant: resolution.variant.id }
            : { branch: 'ask', question: 'which-variant', family: resolution.family.id };
    }

    if (resolution.capability === 'yes') {
        return { branch: 'A', reason: 'known-capable', toolId: resolution.id };
    }
    return conditionalBranch(resolution.id, resolution.capability, answers);
}

/**
 * The options for the which-variant question: the two apps one name covers, in the person's words.
 * The answer is the option's `id`, sent back in the same `client` field.
 */
export function aiClientVariantOptions(familyId: string, opts: { lang?: string } = {}): AiClientOption[] {
    const l = lang(opts.lang);
    const family = AI_CLIENT_FAMILIES.find(f => f.id === familyId);
    return (family?.variants ?? []).map(v => ({ id: v.id, label: s(l, v.label.en, v.label.fi) }));
}

/** One option in the "which app did you talk in?" question. */
export interface AiClientOption {
    id: string;
    label: string;
    recommended?: boolean;
    /** Present for real tools; absent for the two escape options. */
    plans?: string;
}

/**
 * The options for "Which app did you talk to the AI in?", built from the SAME table the branch
 * reads — a hardcoded second list here would be the exact drift the alias map exists to avoid.
 * The two trailing options are escapes, and both lead to branch A.
 */
export function aiClientQuestionOptions(config: AimeatConfig, opts: { lang?: string } = {}): AiClientOption[] {
    const l = lang(opts.lang);
    const tools = buildAiToolSetup(config, opts).map(tool => ({
        id: tool.id,
        label: tool.label,
        ...(tool.recommended ? { recommended: true } : {}),
        ...(tool.mcp.plans ? { plans: tool.mcp.plans } : {}),
    }));
    return [
        ...tools,
        { id: 'other', label: s(l, 'Something else', 'Jokin muu') },
        { id: 'dont-know', label: s(l, 'I am not sure', 'En ole varma') },
    ];
}
