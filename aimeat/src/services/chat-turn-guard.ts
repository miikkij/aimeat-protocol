/**
 * @file chat-turn-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node itself adds to a chat turn: a line the person sees within seconds,
 *   a line for each kind of step the agent takes, the note that asks the model to write between its
 *   steps, and the ceiling that makes a long turn answer with what it has.
 *
 *   WHY. Measured 2026-10-02 on a hosted place and again locally (scripts/chat-turn-measure.ts,
 *   deepseek/deepseek-v4-pro-0813 on the node route): asked in Finnish for an agent that reads the
 *   CRM's open deals every morning, the chat took six model rounds of 15 to 35 s each, 12 tool calls
 *   (handbook, two skills, agents, apps, MCP servers, connections, memory, goose's own todo tool
 *   twice) and 1445 thought events, wrote its first word at 141.8 s, and ended with a question and
 *   no proposal. The person saw a clock and a flickering thought fragment for two and a half
 *   minutes. Every round costs a reasoning model that much, so the only cure for the length is
 *   fewer rounds, and the only cure for the silence is the node speaking for the agent until it
 *   speaks for itself.
 *
 *   TWO LIMITS, in two phases. The main phase ends at SOFT: a number of tool calls, a number of
 *   rounds, or a time. The time is checked only when the agent is between steps (no tool call in
 *   flight, not writing words), so a call that is running or an answer being written is never cut.
 *   Then the node cancels the turn and asks once more, in the same session, for an answer from
 *   what the agent already found (wrapUpPrompt). That phase has its own, shorter limit; past it the
 *   node cancels again and writes the stopped line itself, so the turn always ends in words.
 * @structure
 *   - TURN_LIMITS — the numbers
 *   - NodeUpdate — the events the node adds to the stream: progress and guard
 *   - stepForTool(title) — which progress line a tool call earns
 *   - turnNote() / wrapUpPrompt(reason) — what the node tells the model
 *   - TurnWatch — counts one phase of a turn and says when its limit is reached
 *   - withTicks(updates, everyMs) — the update stream with a clock in it, so a limit fires in silence
 *   - progressText(locale, step) / stoppedText(locale) — the person's language, from locales/
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { createT, type Locale } from '../i18n.js';

/** The limits of one chat turn. */
export const TURN_LIMITS = {
    /** The first line appears after this long with no words, so a quick answer shows none. */
    firstLineMs: 1_500,
    /** Silence while the model thinks, after which the node says it is still at work. */
    quietMs: 20_000,
    /**
     * The main phase: past any of these the node asks for an answer with what the agent has. Rounds
     * catch the loop; the time is only the backstop for a model that thinks on in one round, because
     * a cut costs a whole new round. A round on the hosted model waits about 20 s for its first token
     * (measured 2026-10-02), so a proposal takes three (read, propose, answer), and a time of 50 s,
     * then 75 s, cut the round that was writing the proposal in three runs out of three.
     */
    softToolCalls: 12,
    softRounds: 3,
    softMs: 100_000,
    /** The answer phase: past either of these the node stops the turn and says so. */
    wrapUpToolCalls: 3,
    wrapUpMs: 45_000,
} as const;

export type ProgressStep = 'start' | 'reading' | 'proposing' | 'writing' | 'working' | 'thinking' | 'wrappingUp';
export type GuardReason = 'tool_calls' | 'rounds' | 'time';

/** The events the node adds to the stream. `text` is in the person's language. */
export type NodeUpdate =
    | { kind: 'progress'; step: ProgressStep; text: string }
    | { kind: 'guard'; phase: 'wrap_up' | 'stopped'; reason: GuardReason; text: string };

/**
 * Which progress line a tool call earns, from its title ("aimeat: aimeat organism list").
 * null for goose's own bookkeeping (the todo tool), which is not a step the person cares about.
 */
export function stepForTool(title: string): ProgressStep | null {
    const t = title.toLowerCase().replace(/[_:]+/g, ' ');
    if (/^todo\b/.test(t)) return null;
    if (/\bagent propose\b/.test(t)) return 'proposing';
    if (/\b(write|save|publish|create|update|delete|send|install|set|append|replace|grant|revoke|upload|post|approve)\b/.test(t)) return 'writing';
    if (/\b(list|get|read|search|discover|handbook|overview|inbox|status|history|members|query|rows)\b/.test(t)) return 'reading';
    return 'working';
}

/**
 * The note appended to every prompt the chat sends. The person's words stay as they wrote them in
 * the conversation record; only the model sees this.
 */
export function turnNote(): string {
    return [
        '[A note from this node, not from the person]',
        'Write one short sentence to the person before your first tool call, and one between steps, so they see what you are doing while you work.',
        'Keep this turn to about a minute and a few rounds of tool calls. After that the node asks you to answer with what you have.',
        'When the person asks for a new agent: read their organisms with aimeat_organism_list (the handbook is not needed for this), and the workspaces of the organism the job needs with aimeat_workspace_list, which takes that organism\'s id. One step of reading is enough; when they have no organisms, go straight on. Then call aimeat_agent_propose in the next step, with a crew_def in the smallest shape its description gives. Propose also when the data the agent needs does not exist yet: then name what is missing in `purpose` and in your answer. Give them the approval address from the answer.',
    ].join('\n');
}

/** What the node asks when the main phase ran out. */
export function wrapUpPrompt(reason: GuardReason): string {
    const why = reason === 'time' ? 'the time' : reason === 'rounds' ? 'the rounds of tool calls' : 'the tool calls';
    return [
        `[A note from this node, not from the person] This turn has used ${why} it has, so stop looking for more and answer the person now, in their language, from what you already found.`,
        'If they asked for a new agent, call aimeat_agent_propose once now with a crew_def built from what you found, name in `purpose` any data it still needs, and give them `approval_url` and `next_step` from the answer.',
        'Otherwise say what you found, what is not done, and that they can say "continue" to go on.',
        'Make at most one more tool call.',
    ].join('\n');
}

/** Counts one phase of a turn and says when its limit is reached. */
export class TurnWatch {
    /** Each call's title and status, keyed by the call's own id. */
    private readonly calls = new Map<string, string>();
    private readonly statuses = new Map<string, string>();
    private rounds = 0;
    /** True from a round's first counted call until the model thinks or writes again. */
    private roundOpen = false;
    private writingAt = Number.NEGATIVE_INFINITY;

    constructor(
        private readonly limits: { toolCalls: number; rounds: number; ms: number },
        private readonly startedAt: number,
    ) {}

    /** Feed one update from the agent. */
    observe(update: { kind: string; id?: string; title?: string; status?: string }, now: number): void {
        if (update.kind === 'tool_call') {
            const key = update.id || update.title || '';
            if (!this.calls.has(key)) {
                const title = update.title ?? '';
                this.calls.set(key, title);
                // A round is one model response, which is what costs the time. Goose's own todo
                // tool is bookkeeping and opens none.
                if (stepForTool(title) !== null && !this.roundOpen) {
                    this.rounds++;
                    this.roundOpen = true;
                }
            } else if (update.title) {
                this.calls.set(key, update.title);
            }
            this.statuses.set(key, update.status ?? 'pending');
        } else if (update.kind === 'thought' || update.kind === 'text') {
            this.roundOpen = false;
            if (update.kind === 'text') this.writingAt = now;
        }
    }

    /** Tool calls that count, so far. */
    get toolCalls(): number {
        return [...this.calls.values()].filter((title) => stepForTool(title) !== null).length;
    }

    /** True while a tool call has started and not finished. */
    get inFlight(): boolean {
        return [...this.statuses.values()].some((s) => s !== 'completed' && s !== 'failed');
    }

    /** Whether a tool call named like this one has completed in this phase. */
    completed(pattern: RegExp): boolean {
        for (const [key, title] of this.calls) {
            if (pattern.test(title.toLowerCase().replace(/[_:]+/g, ' ')) && this.statuses.get(key) === 'completed') return true;
        }
        return false;
    }

    /**
     * The limit this phase has reached, or null. Counts are checked at once; the time only between
     * steps, because cancelling a running call or an answer being written loses the work.
     */
    reached(now: number): GuardReason | null {
        if (this.toolCalls > this.limits.toolCalls) return 'tool_calls';
        if (this.rounds > this.limits.rounds) return 'rounds';
        const writing = now - this.writingAt < 3_000;
        // A proposal that went through leaves only the answer to write, which is what a stop would
        // ask for anyway; it gets the answer phase's time rather than a cancel and a new round.
        const grace = this.completed(/\bagent propose\b/) ? TURN_LIMITS.wrapUpMs : 0;
        if (now - this.startedAt > this.limits.ms + grace && !this.inFlight && !writing) return 'time';
        return null;
    }
}

/** A tick in the update stream: no event arrived for a while. */
export interface Tick { kind: 'tick' }

/**
 * The update stream with a clock in it. A limit has to be able to fire while the model thinks in
 * silence, and a `for await` over the agent's updates waits for the next one however long it takes.
 */
export async function* withTicks<T>(updates: AsyncGenerator<T>, everyMs: number): AsyncGenerator<T | Tick> {
    let pending: Promise<IteratorResult<T>> | null = null;
    try {
        for (;;) {
            pending ??= updates.next();
            let timer: NodeJS.Timeout | undefined;
            const tick = new Promise<'tick'>((resolve) => { timer = setTimeout(() => resolve('tick'), everyMs); });
            const next = await Promise.race([pending, tick]);
            clearTimeout(timer);
            if (next === 'tick') { yield { kind: 'tick' }; continue; }
            pending = null;
            if (next.done) return;
            yield next.value;
        }
    } finally {
        // A reader that stops early still releases the stream underneath (its listener, in goose-acp).
        void updates.return(undefined as never);
    }
}

/** A progress line in the person's language. */
export function progressText(locale: Locale, step: ProgressStep): string {
    return createT(locale)(`chatTurn.progress.${step}`);
}

/** The line the node writes when even the answer phase ran out. */
export function stoppedText(locale: Locale): string {
    return createT(locale)('chatTurn.stopped');
}
