/**
 * @file chat-session.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One turn of the chat, end to end: the person's identity, the agent process, the
 *   conversation record, and what came back.
 *
 *   WHICH PROCESS RUNS A TURN (services/goose-env.ts, services/chat-agent-pool.ts).
 *   - The node route, the default (no AIMEAT_GOOSE_PROVIDER_API_KEY): each person has an agent
 *     process of their own, started on their first turn and closed when idle. Its model calls go to
 *     this node's /v1/llm with that person's chat token, so the owner's model policy, budget and
 *     allowance apply and the usage is recorded to them. A process never runs another person's turn,
 *     because its token would spend the wrong person's budget.
 *   - The shared key, the operator's special case: ONE process for everybody, on the operator's key,
 *     with no per-person metering. This is how every node ran before 2026-09-28.
 *   In both, each conversation gets a goose session inside the process, with its own MCP server list,
 *   so a session speaks to this node as the person who owns it and the tool surface refuses
 *   everything they may not do.
 *
 *   Session ids belong to a running process. When a process is replaced, every id it handed out
 *   means nothing, so they are stamped with the generation that issued them and a stale one is
 *   silently replaced rather than used. The conversation itself is unaffected: it lives in the
 *   person's memory, and goose's own store is a cache.
 * @structure
 *   - chatEnabled() — whether this node has an agent at all
 *   - chatPayer() — who pays for this person's turns, and on which model, as the node decides it
 *   - runChatTurn() — the whole turn, yielding updates as they happen and persisting both sides
 *   - shutdownChat() — stop every agent process
 * @usage
 *   for await (const u of runChatTurn({ storage, config }, ownerName, threadId, text)) { … }
 * @version-history
 *   v1.9.0 — 2026-10-04 — A goose session runs in the chat's own empty directory, not the node's.
 *   v1.8.0 — 2026-10-02 — The node speaks in the turn and the turn has a ceiling
 *     (services/chat-turn-guard.ts). A progress line within 1.5 s and one per kind of step, in the
 *     page's language; a note asks the model to write between its steps and says how a new agent is
 *     proposed; past the main phase's limit the turn is cancelled and the agent asked, in the same
 *     session, to answer from what it found; past that, the node ends the turn in words of its own.
 *     The words after a round of tool calls start a new paragraph. Measured on deepseek-v4-pro on
 *     the node route: the agent request went from first words at 141.8 s and no proposal to a line
 *     at 1.7 s and a proposal at 64.7 s.
 *   v1.7.0 — 2026-09-29 — Attachments are read through the classification reader (TARGET-082).
 *   v1.6.0 — 2026-09-28 — System 2 plan, V5: without the shared key each person's turns run in a
 *     process of their own whose model calls go through /v1/llm with their chat token, so the model
 *     policy, the budget and the metering apply to the chat (Jouni's ruling J6). chatPayer() answers
 *     who pays. The model a turn records is the operator's only on the shared key, because /v1/llm
 *     chooses the model per call.
 *   v1.5.1 — 2026-09-12 — resolveGhii takes the node; the composed GHII moved into the helper.
 *     wish-identity-gate-sees-resolveghii.
 *   v1.5.0 — 2026-09-08 — An agent process that exited is replaced on the next turn instead of
 *     being kept as a client that refuses everything.
 *   v1.4.0 — 2026-08-17 — A spreadsheet, a Word document and a PDF become text instead of being
 *     turned away. A .xlsx arrives as CSV, which is what the next question usually wants. The
 *     pre-2007 binary formats are named as unsupported with the one step that fixes them.
 *   v1.3.0 — 2026-08-16 — Attachments are files, not only pictures: a text file is quoted into the
 *     prompt under its own name, and a format that needs parsing is named to the agent so it can
 *     tell the person it never saw it.
 *   v1.2.0 — 2026-08-16 — A turn takes an AbortSignal and CANCELS the agent when it fires. Stopping
 *     used to close the stream and nothing else: goose kept answering a question nobody would read,
 *     on the node's key. Leaving the page is the same event.
 *   v1.1.0 — 2026-08-16 — An agent turn records the model when the node is the one that chose it
 *     (AIMEAT_GOOSE_MODEL). ChatTurn.model has existed since the first version and nothing ever
 *     wrote it, so the chip naming the model never appeared.
 *   v1.0.1 — 2026-08-16 — The work log keys tool calls by id rather than title. Only the opening
 *     event carries a title, so every call stayed at "starting" no matter how it ended. Seen in a
 *     browser against a real agent, where one completed call read as still running.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { GooseAcpClient, aimeatMcpServer, type PromptImage, type SessionUpdate } from './goose-acp.js';
import {
    TURN_LIMITS, TurnWatch, stepForTool, turnNote, wrapUpPrompt, withTicks, progressText, stoppedText,
    type GuardReason, type NodeUpdate, type ProgressStep,
} from './chat-turn-guard.js';
import { DEFAULT_LOCALE, type Locale } from '../i18n.js';
import { CHAT_AGENT_NAME, ensureChatAgent, mintChatAgentToken } from './chat-agent.js';
import { AgentPool, type AgentLease, type PoolStart } from './chat-agent-pool.js';
import { chatUsesSharedKey } from './goose-env.js';
import { ensureChatGooseConfig } from './goose-chat-config.js';
import { prepareAiCall } from './ai/completion.js';
import { appendTurn, readThread, setGooseSession, type ChatTurn } from './chat-threads.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { readAttachments, MAX_ATTACHMENTS_PER_TURN } from './chat-attachments.js';
import { systemReader } from './classification/reader.js';
import { logger } from '../utils/logger.js';

export interface ChatDeps { storage: Storage; config: AimeatConfig }

/** What a turn streams: the agent's own updates, and the node's progress and guard events. */
export type ChatUpdate = SessionUpdate | NodeUpdate;

/** How one phase of a turn ended: its `done` or `error`, the limit it reached, and whether goose ignored the cancel. */
interface PhaseEnd { end: SessionUpdate | null; limit: GuardReason | null; stuck: boolean }

/** What goes before a new paragraph so that it is one: nothing at the start, or after a blank line. */
function paragraphBreak(answer: string): string {
    if (!answer || answer.endsWith('\n\n')) return '';
    return answer.endsWith('\n') ? '\n' : '\n\n';
}

/** How long a person's own agent process stays up with no turn in flight. */
export const CHAT_AGENT_IDLE_MS = 15 * 60_000;
/** The most agent processes this node runs at once on the node route. */
export const CHAT_AGENT_MAX_LIVE = 20;
/** A turn may run 15 minutes (goose-acp TURN_TIMEOUT_MS); a process whose token expires sooner than
 *  this is replaced before the next turn, so the key does not expire in the middle of one. */
const TOKEN_RENEW_BEFORE_MS = 20 * 60_000;
/** The pool key of the one shared process. An owner name never contains `*`. */
const SHARED_KEY = '*';

/** The running agent processes: one per person on the node route, one on the shared key. */
const pool = new AgentPool<GooseAcpClient>({
    idleMs: CHAT_AGENT_IDLE_MS, maxLive: CHAT_AGENT_MAX_LIVE, renewBeforeMs: TOKEN_RENEW_BEFORE_MS,
});

/** Whether this node has a chat agent configured at all. */
export function chatEnabled(config: AimeatConfig): boolean {
    return !!(config.gooseBin || '').trim();
}

/**
 * The process that runs this person's turn, held for the length of the turn.
 *
 * A process that died is dropped and the next turn starts a fresh one (until 2026-09-08 a dead one
 * was kept, and chat answered "goose agent is not running" until the node restarted); the generation
 * stamp then retires every session the old one issued. Concurrent first turns share one start.
 */
async function agentFor(deps: ChatDeps, ownerName: string): Promise<AgentLease<GooseAcpClient>> {
    const { storage, config } = deps;
    if (chatUsesSharedKey(config)) {
        // The operator changed the route while per-person processes ran: they go once idle.
        pool.retireAllExcept((key) => key === SHARED_KEY);
        return pool.acquire(SHARED_KEY, async () => ({ client: await GooseAcpClient.start(config) }), { evictIdle: false });
    }
    pool.retireAllExcept((key) => key !== SHARED_KEY);
    return pool.acquire(ownerName, () => startPersonalAgent(storage, config, ownerName), { evictIdle: true });
}

/**
 * Start one person's own agent process on the node route.
 *
 * Its /v1/llm key is a chat agent token of its own, minted for this process and revoked when the
 * process closes, so the credential lives exactly as long as the process that holds it.
 */
async function startPersonalAgent(
    storage: Storage, config: AimeatConfig, ownerName: string,
): Promise<PoolStart<GooseAcpClient>> {
    const identity = await ensureChatAgent(storage, config, ownerName);
    const { token, sessionId, expiresAt } = await mintChatAgentToken(storage, config, identity);
    const revoke = () => {
        storage.revokeSession(sessionId).catch((e: Error) => {
            logger.warn(`[chat] could not revoke the model-call token of ${identity.gaii}: ${e.message}`);
        });
    };
    try {
        const client = await GooseAcpClient.start(config, { token });
        return { client, expiresAt: Date.parse(expiresAt), onClose: revoke };
    } catch (err) {
        revoke();
        throw err;
    }
}

/** Stop every agent process. Called from the node's shutdown hook. */
export function shutdownChat(): void {
    pool.closeAll();
}

/** A goose session id is only meaningful for the process that issued it. */
function stamp(generation: number, sessionId: string): string {
    return `${generation}:${sessionId}`;
}
function unstamp(stamped: string | undefined, generation: number): string | null {
    if (!stamped) return null;
    const [gen, ...rest] = stamped.split(':');
    return Number(gen) === generation ? rest.join(':') : null;
}

/**
 * Who pays for this person's chat turns, and on which model, as the node decides it.
 *
 * On the shared key the operator's key pays for every turn: 'node'. On the node route each model
 * call is decided by prepareAiCall in /v1/llm, so the same decision is asked here with the same
 * inputs: 'own' when the person's own key (or their chat agent's) pays, 'allowance' when the node's
 * key pays from their allowance. A call the gate would refuse has no payer, and the answer is null:
 * the turn itself then says why.
 */
export async function chatPayer(
    deps: ChatDeps, gaii: string,
): Promise<{ pays: 'node' | 'own' | 'allowance' | null; model?: string }> {
    const { storage, config } = deps;
    if (chatUsesSharedKey(config)) return { pays: 'node', ...(config.gooseModel ? { model: config.gooseModel } : {}) };
    try {
        const plan = await prepareAiCall(storage, config, gaii, { appId: 'llm-proxy', agent: CHAT_AGENT_NAME, caller: 'chat' });
        return { pays: plan.keyScope === 'node' ? 'allowance' : 'own', model: plan.model };
    } catch (err) {
        logger.info(`[chat] no payer for ${gaii}'s chat: ${(err as Error).message}`);
        return { pays: null };
    }
}

/**
 * Get, or create, the goose session this conversation runs on.
 *
 * The MCP token is minted per session and never stored: it is a bearer credential for the whole of
 * the person's tool surface, and it should live exactly as long as the session that carries it.
 */
async function sessionFor(
    deps: ChatDeps, lease: AgentLease<GooseAcpClient>, ownerName: string, gaii: string, threadId: string,
): Promise<string> {
    const { storage, config } = deps;
    const thread = await readThread(storage, gaii, threadId);
    const existing = unstamp(thread?.gooseSessionId, lease.generation);
    if (existing) return existing;

    const identity = await ensureChatAgent(storage, config, ownerName);
    const { token } = await mintChatAgentToken(storage, config, identity);

    const sessionId = await lease.client.newSession({
        mcpServers: [aimeatMcpServer(config.baseUrl, token)],
        // An empty directory: in the node's own, goose read the repository's AGENTS.md into every
        // round as project hints (services/goose-chat-config.ts).
        cwd: ensureChatGooseConfig(config).cwd,
    });
    await setGooseSession(storage, gaii, threadId, stamp(lease.generation, sessionId));
    logger.info(`[chat] ${identity.gaii} -> goose session ${sessionId} for thread ${threadId}`);
    return sessionId;
}

/**
 * Run one turn.
 *
 * The person's own words are written down BEFORE the agent is asked anything: a turn that fails
 * halfway should leave the conversation showing what was said, not an empty gap. The agent's side is
 * written when the turn ends, with the tools it used and the model that answered — the model per
 * turn, because a node that falls back to a free model when an allowance runs out has to be able to
 * say which turn that was.
 */
export async function* runChatTurn(
    deps: ChatDeps, ownerName: string, threadId: string, text: string, signal?: AbortSignal,
    attachmentKeys: string[] = [], opts: { locale?: Locale } = {},
): AsyncGenerator<ChatUpdate> {
    const { storage, config } = deps;
    const locale = opts.locale ?? DEFAULT_LOCALE;
    if (!chatEnabled(config)) {
        yield { kind: 'error', message: 'This node has no chat agent configured.' };
        return;
    }

    const gaii = await resolveGhii(storage, ownerName, config);
    const now = new Date().toISOString();

    // What the person attached, read from THEIR OWN namespace by key. The browser uploaded through
    // the ordinary presigned path, so these are their files under their quota, and the key is all
    // that travelled through the request — bytes never go through a JSON body.
    //
    // TWO KINDS, because a model takes them differently. A picture goes as an ACP image block. A
    // text file goes as TEXT, quoted into the prompt under its own name: every model reads text,
    // which makes a CSV, a log or a piece of code work today rather than after somebody adds a
    // format negotiation nobody asked for. Anything else is left out of the prompt and said out
    // loud — a file the model never saw is worse than one it was told about.
    // The attached files go to the chat's model: the classification reader's useForAi decides (TARGET-082).
    const { images, quoted, notes, skipped } = await readAttachments(storage, systemReader({ storage, config }, gaii), gaii, attachmentKeys);

    const prompt = [
        text,
        ...quoted,
        // Said IN the prompt rather than only in a log: the agent is the one who has to tell the
        // person their file was not read, and it can only do that if it knows.
        ...notes,
        ...(skipped.length ? [`These files were attached but could not be read as text or as a picture, so you have not seen them: ${skipped.join(', ')}. Say so plainly if they matter.`] : []),
    ].join('\n\n');

    await appendTurn(storage, gaii, threadId, {
        role: 'user', text, at: now,
        ...(attachmentKeys.length ? { attachments: attachmentKeys.slice(0, MAX_ATTACHMENTS_PER_TURN) } : {}),
    });

    // The process is held for the whole turn: the pool neither closes it as idle nor counts it free
    // until release() runs in the finally block below.
    let lease: AgentLease<GooseAcpClient>;
    let sessionId: string;
    try {
        lease = await agentFor(deps, ownerName);
    } catch (err) {
        const message = (err as Error).message;
        logger.warn(`[chat] could not start an agent for ${ownerName}: ${message}`);
        yield { kind: 'error', message };
        return;
    }
    try {
        sessionId = await sessionFor(deps, lease, ownerName, gaii, threadId);
    } catch (err) {
        lease.release();
        const message = (err as Error).message;
        logger.warn(`[chat] could not open a session for ${ownerName}: ${message}`);
        yield { kind: 'error', message };
        return;
    }

    const acp = lease.client;

    // STOPPING HAS TO REACH THE AGENT. Closing the stream only stops the node LISTENING: goose is a
    // separate process that was told to answer, and it keeps answering — spending the node's key on
    // an answer nobody will ever read. `cancel()` existed from the first version and nothing called
    // it, so the Stop button was a button that stopped the page. This is also what a person leaving
    // the page means, because the route aborts on disconnect for the same reason.
    const onAbort = () => {
        acp.cancel(sessionId).catch((e: Error) => logger.warn(`[chat] cancel failed: ${e.message}`));
    };
    if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    // Keyed by the call's OWN id, not its title. A tool call arrives twice — once as it starts and
    // once as it finishes — and only the first carries a title, so matching on the title leaves
    // every call in the log reading "starting" forever, whatever actually happened to it.
    const tools = new Map<string, { title: string; status: string }>();
    const cards = new Map<string, { kind: string; title: string; url?: string; image?: string; ref?: string }>();
    let answer = '';

    // WHAT THE PERSON SEES BEFORE THE AGENT SPEAKS (services/chat-turn-guard.ts). A reasoning model
    // spends 15 to 35 s per round and writes its words at the end, so without these lines a turn of
    // several rounds is minutes of nothing. They are progress events, not words: the record keeps
    // only what the agent wrote.
    const startedAt = Date.now();
    let lastVisibleAt = startedAt;
    let lastStep: ProgressStep | null = null;
    let spoke = false;
    // Set by a tool call, cleared by words: the words after a round of tool calls are a new
    // paragraph, not the end of the sentence before the calls.
    let callsSinceWords = false;
    const progress = (step: ProgressStep): NodeUpdate => {
        lastStep = step;
        lastVisibleAt = Date.now();
        spoke = true;
        return { kind: 'progress', step, text: progressText(locale, step) };
    };

    /**
     * One phase of the turn: one prompt, read to its end, cancelled when the watch says its limit is
     * reached. The phase's own `done` or `error` is returned rather than yielded, because the caller
     * decides whether it is the end of the turn or the start of the answer phase.
     */
    async function* phase(text: string, imgs: PromptImage[], watch: TurnWatch): AsyncGenerator<ChatUpdate, PhaseEnd> {
        let limit: GuardReason | null = null;
        let cancelledAt = 0;
        for await (const update of withTicks(acp.prompt(sessionId, text, imgs), 1_000)) {
            const now = Date.now();
            if (update.kind === 'tick') {
                // A goose that does not end the turn after a cancel is left behind, and the turn ends.
                if (cancelledAt && now - cancelledAt > 15_000) return { end: null, limit, stuck: true };
                if (!spoke && now - startedAt >= TURN_LIMITS.firstLineMs) yield progress('start');
                else if (now - lastVisibleAt >= TURN_LIMITS.quietMs && lastStep !== 'thinking' && !watch.inFlight) yield progress('thinking');
            } else {
                watch.observe(update, now);
                if (update.kind === 'done' || update.kind === 'error') return { end: update, limit, stuck: false };
                if (update.kind === 'text') {
                    const out = callsSinceWords ? { ...update, text: `${paragraphBreak(answer)}${update.text.replace(/^\n+/, '')}` } : update;
                    answer += out.text;
                    callsSinceWords = false;
                    spoke = true;
                    lastVisibleAt = now;
                    lastStep = null;
                    yield out;
                } else {
                    if (update.kind === 'tool_call') {
                        callsSinceWords = true;
                        const key = update.id || update.title;
                        const seen = tools.get(key);
                        if (seen) {
                            seen.status = update.status;
                            if (update.title) seen.title = update.title;
                        } else {
                            tools.set(key, { title: update.title, status: update.status });
                            const step = stepForTool(update.title);
                            if (step && step !== lastStep) yield progress(step);
                        }
                        // Keyed by what it points at, so the same thing published twice in one turn
                        // is one card rather than two identical ones.
                        if (update.card) cards.set(update.card.url ?? update.card.ref ?? update.card.title, update.card);
                    }
                    yield update;
                }
            }
            if (!limit && !signal?.aborted) {
                limit = watch.reached(now);
                if (limit) {
                    cancelledAt = now;
                    logger.info(`[chat] ${gaii}: turn limit reached (${limit}) after ${watch.toolCalls} tool call(s), ${Math.round((now - startedAt) / 1000)}s`);
                    void acp.cancel(sessionId);
                }
            }
        }
        return { end: null, limit, stuck: false };
    }

    try {
        const main = yield* phase(`${prompt}\n\n${turnNote()}`, images, new TurnWatch({
            toolCalls: TURN_LIMITS.softToolCalls, rounds: TURN_LIMITS.softRounds, ms: TURN_LIMITS.softMs,
        }, startedAt));
        let end = main.end;

        // THE CEILING. The main phase ran out, so the agent is asked once more, in the same session,
        // to answer from what it found; past the answer phase's own limit the node ends the turn in
        // words of its own. A person who pressed Stop is not asked anything further.
        const finishedAnyway = main.end?.kind === 'done' && main.end.stopReason !== 'cancelled';
        if (main.limit && !signal?.aborted && !finishedAnyway) {
            yield { kind: 'guard', phase: 'wrap_up', reason: main.limit, text: progressText(locale, 'wrappingUp') };
            yield progress('wrappingUp');
            callsSinceWords = true;
            const wrap = main.stuck ? null : yield* phase(wrapUpPrompt(main.limit), [], new TurnWatch({
                toolCalls: TURN_LIMITS.wrapUpToolCalls, rounds: 2, ms: TURN_LIMITS.wrapUpMs,
            }, Date.now()));
            end = wrap?.end ?? null;
            if (!wrap || wrap.limit || end?.kind === 'error') {
                const stopped = stoppedText(locale);
                const words = `${paragraphBreak(answer)}${stopped}`;
                answer += words;
                yield { kind: 'text', text: words };
                yield { kind: 'guard', phase: 'stopped', reason: wrap?.limit ?? main.limit, text: stopped };
                end = { kind: 'done', stopReason: 'max_turn_requests' };
            }
        }
        if (end) yield end;
    } finally {
        signal?.removeEventListener('abort', onAbort);
        lease.release();
        // Written even when the turn ended badly: half an answer and the tools that ran is a truer
        // record than nothing, and it is what the person saw on screen.
        const turn: ChatTurn = {
            role: 'agent',
            text: answer,
            at: new Date().toISOString(),
            ...(tools.size ? { tools: [...tools.values()] } : {}),
            ...(cards.size ? { cards: [...cards.values()] } : {}),
            // Only what the node itself chose. ACP's `done` update carries a stop reason and a token
            // count and no model name, so a node that leaves the model to goose's own configuration
            // genuinely does not know which one answered — and says nothing rather than guessing.
            // On the node route /v1/llm chooses the model per call and GOOSE_MODEL is not what
            // answered, so only the shared key's model is written down.
            ...(config.gooseModel && chatUsesSharedKey(config) ? { model: config.gooseModel } : {}),
        };
        await appendTurn(storage, gaii, threadId, turn).catch((e: Error) => {
            logger.warn(`[chat] could not save the agent turn: ${e.message}`);
            return null;
        });
    }
}

/**
 * Forget the goose session a conversation was on, so the next turn starts a fresh one.
 *
 * This is what a scope change needs: the session's MCP token carries the scopes it was minted with,
 * so widening or narrowing them in the Agents tab has to reach the chat somehow. Dropping the
 * session is that somehow, and it costs one handshake rather than a reconnect the person has to
 * perform — which was the original complaint this whole feature answers.
 */
export async function resetChatSession(
    deps: ChatDeps, gaii: string, threadId: string,
): Promise<void> {
    await setGooseSession(deps.storage, gaii, threadId, undefined);
}
