/**
 * @file ai-client-branch.test.ts
 * @description Unit tests for the remake's branch decision (aimeat_remake/04-mcp-kyvykkyys.md,
 *   phase 1). The rule the whole feature turns on is negative and therefore easy to break
 *   silently: **an app NAME can never send anyone to branch B.** A wrong A costs one attempt; a
 *   wrong B tells someone whose tools were fine that their tools are not good enough.
 *
 *   So the suite proves three things:
 *     1. all eight ids and their common spellings resolve, and none of them yields B on the name;
 *     2. twenty invented app names yield a QUESTION, never B;
 *     3. B is reachable only one way — the person answered that they do not have the paid tier
 *        their own app requires.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-client-branch.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 1).
 */
import { describe, it, expect } from 'vitest';
import {
    AI_TOOL_IDS,
    AI_CLIENT_ALIASES,
    resolveAiClient,
    decideBranch,
    capabilityOf,
    normalizeAiClientClaim,
    aiClientQuestionOptions,
    buildAiToolSetup,
    type AiToolId,
} from '../../src/services/ai-tool-setup.js';

const config = { nodeId: 'aimeat-test-node', baseUrl: 'https://test.example' } as any;

/** The branch a bare claim produces, with nothing answered yet. */
const branchOf = (claim: string | null) => decideBranch(resolveAiClient(claim));

describe('the alias map covers the list it sits next to', () => {
    it('maps every alias onto one of the eight ids — no orphan targets', () => {
        const ids = new Set<string>(AI_TOOL_IDS);
        for (const [alias, id] of Object.entries(AI_CLIENT_ALIASES)) {
            expect(ids.has(id), `alias "${alias}" points at unknown id "${id}"`).toBe(true);
        }
    });

    it('has at least one alias for each of the eight, so no tool is unreachable', () => {
        const targets = new Set(Object.values(AI_CLIENT_ALIASES));
        for (const id of AI_TOOL_IDS) {
            expect(targets.has(id), `no alias resolves to "${id}"`).toBe(true);
        }
    });

    it('keys are already normalized (a key with punctuation could never match)', () => {
        for (const alias of Object.keys(AI_CLIENT_ALIASES)) {
            expect(normalizeAiClientClaim(alias), `alias "${alias}" is not normalized`).toBe(alias);
        }
    });

    it('the question options come from the tool table, not a second hardcoded list', () => {
        const tools = buildAiToolSetup(config);
        const opts = aiClientQuestionOptions(config);
        expect(opts.map(o => o.id)).toEqual([...tools.map(t => t.id), 'other', 'dont-know']);
        // The recommended flag rides along so the picker can default to it.
        expect(opts.find(o => o.id === 'claude-web')?.recommended).toBe(true);
        // Finnish is a translation of the same list, not a different list.
        expect(aiClientQuestionOptions(config, { lang: 'fi' }).map(o => o.id)).toEqual(opts.map(o => o.id));
        expect(aiClientQuestionOptions(config, { lang: 'fi' }).at(-1)?.label).toBe('En ole varma');
    });
});

describe('every one of the eight resolves, in the spellings people actually write', () => {
    // Each id with the ways a model tends to name it: the id itself, the vendor, the product
    // name with and without punctuation, and a sentence that mentions it in passing.
    const SPELLINGS: Record<AiToolId, string[]> = {
        'claude-web': ['claude-web', 'claude.ai', 'Claude AI', 'CLAUDE.AI', 'claude', 'Claude',
            'Anthropic', 'Claude Sonnet 4.5 via claude.ai', 'the claude.ai web interface'],
        'claude-desktop': ['claude-desktop', 'Claude Desktop', 'claude desktop app', 'Claude app',
            'Claude for Mac', 'Claude for Windows'],
        'claude-code': ['claude-code', 'Claude Code', 'claude code (CLI)', 'claude cli',
            'I am running in Claude Code'],
        chatgpt: ['chatgpt', 'ChatGPT', 'Chat GPT', 'OpenAI', 'openai chatgpt', 'GPT-5',
            'gpt-4o', 'ChatGPT Plus'],
        codex: ['codex', 'Codex CLI', 'codex-cli', 'OpenAI Codex'],
        cursor: ['cursor', 'Cursor', 'Cursor IDE', 'cursor.ai', 'Cursor editor'],
        vscode: ['vscode', 'VS Code', 'Visual Studio Code', 'GitHub Copilot', 'copilot',
            'VS Code (Copilot)', 'Copilot Chat'],
        grok: ['grok', 'Grok', 'grok.com', 'x.ai', 'xAI Grok'],
    };

    for (const [id, spellings] of Object.entries(SPELLINGS) as [AiToolId, string[]][]) {
        for (const spelling of spellings) {
            it(`"${spelling}" → ${id}`, () => {
                const r = resolveAiClient(spelling);
                expect(r.kind).toBe('known');
                expect(r.kind === 'known' && r.id).toBe(id);
            });
        }
    }

    it('the longest alias wins, so "claude code" never reads as claude.ai', () => {
        // The single most damaging collision in the table: every Claude alias is a prefix
        // relationship away from every other.
        expect(resolveAiClient('claude code')).toMatchObject({ kind: 'known', id: 'claude-code' });
        expect(resolveAiClient('claude desktop')).toMatchObject({ kind: 'known', id: 'claude-desktop' });
        expect(resolveAiClient('using Claude Code CLI here')).toMatchObject({ kind: 'known', id: 'claude-code' });
        expect(resolveAiClient('claude')).toMatchObject({ kind: 'known', id: 'claude-web' });
    });
});

describe('an app name never sends anyone to branch B', () => {
    it('the six free-tier-capable apps go straight to A', () => {
        for (const id of ['claude-web', 'claude-desktop', 'claude-code', 'codex', 'cursor', 'vscode']) {
            expect(capabilityOf(id)).toBe('yes');
            const d = branchOf(id);
            expect(d, `${id} must go straight to A`).toMatchObject({ branch: 'A', reason: 'known-capable' });
        }
    });

    it('ChatGPT, Grok and Codex users are never dropped into B on the app name', () => {
        // The specific mistake an earlier five-row capability table would have made.
        for (const claim of ['chatgpt', 'ChatGPT', 'openai', 'GPT-5', 'grok', 'x.ai', 'Grok',
            'codex', 'Codex CLI', 'OpenAI Codex']) {
            expect(branchOf(claim).branch, `"${claim}" must not land in B`).not.toBe('B');
        }
    });

    it('the two paid-tier apps are ASKED about the tier, not refused', () => {
        for (const id of ['chatgpt', 'grok'] as const) {
            expect(capabilityOf(id)).toBe('plan-dependent');
            expect(branchOf(id)).toMatchObject({ branch: 'ask', question: 'paid-plan', toolId: id });
        }
    });

    it('twenty invented app names produce a question, never B', () => {
        const INVENTED = [
            'Zorblat', 'Nebulon Assistant', 'MindWeaver 3', 'Talkbox Pro', 'Verdance',
            'Oraculum', 'Hyperion Chat', 'Lumenous', 'Quillith', 'Parabola AI',
            'Ствол', 'Kiviranta Assistant', 'Fjordbot', 'Terrazzo', 'Umbra Console',
            'Bellweather', 'Nimbus Deck', 'Halyard', 'Pomelo Studio', 'Winterlight',
        ];
        expect(INVENTED).toHaveLength(20);
        for (const name of INVENTED) {
            const r = resolveAiClient(name);
            expect(r.kind, `"${name}" must not match a real tool`).toBe('unknown');
            const d = decideBranch(r);
            expect(d, `"${name}" must produce a question`).toEqual({ branch: 'ask', question: 'which-client' });
        }
    });

    it('a missing or empty claim asks rather than assumes', () => {
        for (const claim of [null, '', '   ', '???', '---']) {
            expect(branchOf(claim as string | null)).toEqual({ branch: 'ask', question: 'which-client' });
        }
    });
});

describe('what the person answers', () => {
    const unknown = resolveAiClient('Zorblat');

    it('naming a real app re-runs the same map — the answer is not privileged', () => {
        expect(decideBranch(unknown, { clientAnswer: 'claude-code' }))
            .toMatchObject({ branch: 'A', reason: 'known-capable', toolId: 'claude-code' });
        // Answering with a paid-tier app leads to the tier question, not to B.
        expect(decideBranch(unknown, { clientAnswer: 'chatgpt' }))
            .toMatchObject({ branch: 'ask', question: 'paid-plan' });
    });

    it('"something else" and "not sure" both try A first', () => {
        for (const answer of ['other', 'dont-know']) {
            expect(decideBranch(unknown, { clientAnswer: answer }))
                .toEqual({ branch: 'A', reason: 'unknown-defaults-to-a' });
        }
    });

    it('an unrecognised free-text answer also tries A first', () => {
        expect(decideBranch(unknown, { clientAnswer: 'my own thing' }))
            .toEqual({ branch: 'A', reason: 'unknown-defaults-to-a' });
    });

    it('confirming the paid tier opens A', () => {
        expect(decideBranch(resolveAiClient('chatgpt'), { hasPaidPlan: true }))
            .toMatchObject({ branch: 'A', reason: 'plan-confirmed', toolId: 'chatgpt' });
    });

    it('B has exactly one entrance: the person said they lack the tier', () => {
        expect(decideBranch(resolveAiClient('chatgpt'), { hasPaidPlan: false }))
            .toEqual({ branch: 'B', reason: 'plan-missing', toolId: 'chatgpt' });
        expect(decideBranch(resolveAiClient('grok'), { hasPaidPlan: false }))
            .toEqual({ branch: 'B', reason: 'plan-missing', toolId: 'grok' });
    });

    it('no combination of an app name alone reaches B', () => {
        // Sweep every alias plus every id with no answers given: none may be B.
        const claims = [...Object.keys(AI_CLIENT_ALIASES), ...AI_TOOL_IDS];
        for (const claim of claims) {
            expect(branchOf(claim).branch, `"${claim}" reached B on the name alone`).not.toBe('B');
        }
    });
});
