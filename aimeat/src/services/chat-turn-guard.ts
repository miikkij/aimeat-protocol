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
 *   - progressText(locale, step) / stoppedText(locale) / appReadyText(locale, url) — the person's
 *     language, from locales/
 * @version-history
 *   v1.2.6 — 2026-10-31 — The sentences between steps are in the person's language too. On crew36 the
 *     Finnish answer began "Fetching template for a list app. Publishing the shopping-list app."
 *   v1.2.5 — 2026-10-31 — The app path says the publish ends the turn and their data is not read
 *     after it, and appReadyText gives the address of an app the turn published. On crew34 gpt-oss
 *     published, then called aimeat_discover to look at the person's data, ran out of time, and the
 *     turn ended in "say continue" with no address in the words (v31 K35).
 *   v1.2.4 — 2026-10-31 — The turn note asks for plain words: a shared place, not an organism, and the
 *     person's name, never an identity such as name@node-id. A store buyer's first chat answer said
 *     "organismeja" and printed their full identity (Jouni v27 P7). One added line; the rest unchanged.
 *   v1.2.3 — 2026-10-31 — The app path names only genres that come whole in one answer (genre-receipt
 *     9.9 kB, genre-almanac, genre-departures) and says not to fetch further parts. genre-workbench,
 *     named first before, comes in two parts (22 kB): on crew33 gpt-oss fetched the second and ran out
 *     of the turn ("Fetching the rest of the template…"), where crew32 had published in 64 s.
 *   v1.2.2 — 2026-10-31 — A news or web agent also gets the runtime's `notify` tool and the
 *     notifications:send scope, which mails its result (crewfive notify_tool.py, aimeat_notify email).
 *   v1.2.1 — 2026-10-31 — The app path names the genre ids every AIMEAT ships (genre-workbench first),
 *     and says a template not found is no reason to stop. On crew31 with gpt-oss-120b the turn read
 *     the specification, looked for "a template" in the person's content, found none and published
 *     nothing (v31 K35, the check turn on koeajo-uusi459833).
 *   v1.2.0 — 2026-10-31 — The turn note says an agent can read the web (the runtime's news, web and
 *     article_fetch tools), sends a clock with the proposal, and delivers by email by default. The
 *     chat had told a buyer it found no web search and left the schedule for another turn (v31 K45-K47).
 *   v1.1.0 — 2026-10-31 — The turn note has a path for an app (one read of the specification, a genre,
 *     the publish, the address; no interview) and says the person is signed in and their own apps sign
 *     them in; the answer phase publishes a page already written; a published app gets the same grace
 *     as a proposal. On grokkoe3110b the first message read five parts of the specification, ran out
 *     of rounds and asked the buyer to say "continue", and told them to sign in (v31 K35, K38).
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
        'Write one short sentence to the person before your first tool call, and one between steps, so they see what you are doing while you work. Write these sentences in the person\'s language too, never in English when they wrote in another.',
        'Keep this turn to about a minute and a few rounds of tool calls. After that the node asks you to answer with what you have.',
        'Speak to the person in plain words in their language: say "shared place" for an organism and "workspace" for a workspace, call the person by their name, and never write an identity such as name@node-id, a key or an id to them.',
        'When the person asks for a new agent: read their organisms with aimeat_organism_list (the handbook is not needed for this), and the workspaces of the organism the job needs with aimeat_workspace_list, which takes that organism\'s id. One step of reading is enough; when they have no organisms, go straight on. Then call aimeat_agent_propose in the next step, with a crew_def in the smallest shape its description gives. Propose also when the data the agent needs does not exist yet: then name what is missing in `purpose` and in your answer. Give them the approval address from the answer.',
        'An agent can read the web: give a news agent the tools ["news", "article_fetch", "notify"] (Finnish publishers\' feeds; topics politiikka, kotimaa, paauutiset) and any other subject ["web", "article_fetch", "notify"]. When it works on a clock, send `schedule` with the proposal as a five-field cron ("0 7 * * *" every morning at 7), so their one press starts it on that clock. Its result goes to them by email unless they said otherwise: its last task sends the result with the notify tool, and the proposal\'s scopes include notifications:send. Tell them that, and that they can ask for it in their AIMEAT instead.',
        'When the person asks for an app: finish it in this turn, with their sentence as the whole brief and no interview. Read the build specification once, aimeat_handbook_get with tier "build-app-atelier", and no other part unless the app cannot work without it. Then take a genre with aimeat_app_template_get, one that comes whole in one answer: id "genre-receipt" for a list, "genre-almanac" for a calendar or a log, "genre-departures" for a board of items. Every AIMEAT ships these, so one is always there. When an answer says it has more parts, do not fetch them: build on the first part. Build the page from its `content` and keep every script tag it has, and publish with aimeat_app_publish. A template you did not find is never a reason to stop: write the page yourself from the specification and publish it. Give them `url` from the answer.',
        'When aimeat_app_publish has answered, the app is done: give them its `url` in your next words and end the turn. Their own data is not part of building it, so do not read it after the publish.',
        'The person is signed in here, and an app of their own signs them in by itself when they open it, so never ask them to sign in.',
    ].join('\n');
}

/** What the node asks when the main phase ran out. */
export function wrapUpPrompt(reason: GuardReason): string {
    const why = reason === 'time' ? 'the time' : reason === 'rounds' ? 'the rounds of tool calls' : 'the tool calls';
    return [
        `[A note from this node, not from the person] This turn has used ${why} it has, so stop looking for more and answer the person now, in their language, from what you already found.`,
        'If they asked for a new agent, call aimeat_agent_propose once now with a crew_def built from what you found, name in `purpose` any data it still needs, and give them `approval_url` and `next_step` from the answer.',
        'If they asked for an app and you have its page, publish it now with aimeat_app_publish and give them `url` from the answer.',
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
        // The same for a published app: what is left is to give the person its address.
        const grace = this.completed(/\b(agent propose|app publish)\b/) ? TURN_LIMITS.wrapUpMs : 0;
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

/**
 * The address of the app a finished tool call published, or undefined. Only a publish counts: a list
 * of apps also answers with an app card, and that app was not made in this turn.
 */
export function publishedAppUrl(title: string, card: { kind: string; url?: string } | null | undefined): string | undefined {
    if (card?.kind !== 'app' || !card.url) return undefined;
    return /\bapp (draft )?publish\b/.test(title.toLowerCase().replace(/[_:]+/g, ' ')) ? card.url : undefined;
}

/** The line the node writes for an app the turn published, when the agent ran out before saying so. */
export function appReadyText(locale: Locale, url: string): string {
    return createT(locale)('chatTurn.appReady', { url });
}
