/**
 * @file chat-session.ts
 * @description One turn of the chat, end to end: the person's identity, the agent process, the
 *   conversation record, and what came back.
 *
 *   The node runs ONE agent process and gives each conversation a session inside it. That is the
 *   shape goose supports and the one that scales here: sessions are created on first use and each
 *   carries its own MCP server list, so a session speaks to this node as the person who owns it and
 *   the tool surface refuses everything they may not do. Fifty people with five talking at once is
 *   one process, not fifty.
 *
 *   Session ids belong to a running process. When the agent restarts, every id it handed out means
 *   nothing, so they are stamped with the generation that issued them and a stale one is silently
 *   replaced rather than used. The conversation itself is unaffected: it lives in the person's
 *   memory, and goose's own store is a cache.
 * @structure
 *   - chatEnabled() — whether this node has an agent at all
 *   - runChatTurn() — the whole turn, yielding updates as they happen and persisting both sides
 *   - shutdownChat() — stop the agent process
 * @usage
 *   for await (const u of runChatTurn({ storage, config }, ownerName, threadId, text)) { … }
 * @version-history
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
import { GooseAcpClient, aimeatMcpServer, type SessionUpdate } from './goose-acp.js';
import { ensureChatAgent, mintChatAgentToken } from './chat-agent.js';
import { appendTurn, readThread, setGooseSession, type ChatTurn } from './chat-threads.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { readAttachments, MAX_ATTACHMENTS_PER_TURN } from './chat-attachments.js';
import { logger } from '../utils/logger.js';

export interface ChatDeps { storage: Storage; config: AimeatConfig }

/** The single agent process, and which generation it is. */
let client: GooseAcpClient | null = null;
let generation = 0;
let starting: Promise<GooseAcpClient> | null = null;

/** Whether this node has a chat agent configured at all. */
export function chatEnabled(config: AimeatConfig): boolean {
    return !!(config.gooseBin || '').trim();
}

/**
 * The agent process, started on first use.
 *
 * Concurrent first turns share one start rather than racing into two processes, which is the same
 * reason goose's own session manager holds a per-session creation lock.
 */
async function agent(config: AimeatConfig): Promise<GooseAcpClient> {
    if (client) return client;
    if (starting) return starting;

    starting = GooseAcpClient.start(config)
        .then((c) => {
            client = c;
            generation++;
            logger.info(`[chat] agent process started (generation ${generation})`);
            return c;
        })
        .finally(() => { starting = null; });
    return starting;
}

/** Stop the agent. Called from the node's shutdown hook. */
export function shutdownChat(): void {
    client?.close();
    client = null;
}

/** A goose session id is only meaningful for the process that issued it. */
function stamp(sessionId: string): string {
    return `${generation}:${sessionId}`;
}
function unstamp(stamped: string | undefined): string | null {
    if (!stamped) return null;
    const [gen, ...rest] = stamped.split(':');
    return Number(gen) === generation ? rest.join(':') : null;
}

/**
 * Get, or create, the goose session this conversation runs on.
 *
 * The MCP token is minted per session and never stored: it is a bearer credential for the whole of
 * the person's tool surface, and it should live exactly as long as the session that carries it.
 */
async function sessionFor(
    deps: ChatDeps, ownerName: string, gaii: string, threadId: string,
): Promise<string> {
    const { storage, config } = deps;
    const thread = await readThread(storage, gaii, threadId);
    const existing = unstamp(thread?.gooseSessionId);
    if (existing) return existing;

    const identity = await ensureChatAgent(storage, config, ownerName);
    const { token } = await mintChatAgentToken(storage, config, identity);
    const acp = await agent(config);

    const sessionId = await acp.newSession({
        mcpServers: [aimeatMcpServer(config.baseUrl, token)],
    });
    await setGooseSession(storage, gaii, threadId, stamp(sessionId));
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
    attachmentKeys: string[] = [],
): AsyncGenerator<SessionUpdate> {
    const { storage, config } = deps;
    if (!chatEnabled(config)) {
        yield { kind: 'error', message: 'This node has no chat agent configured.' };
        return;
    }

    const gaii = await resolveGhii(storage, ownerName, `${ownerName}@${config.nodeId}`);
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
    const { images, quoted, notes, skipped } = await readAttachments(storage, gaii, attachmentKeys);

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

    let sessionId: string;
    try {
        sessionId = await sessionFor(deps, ownerName, gaii, threadId);
    } catch (err) {
        const message = (err as Error).message;
        logger.warn(`[chat] could not open a session for ${ownerName}: ${message}`);
        yield { kind: 'error', message };
        return;
    }

    const acp = await agent(config);

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

    try {
        for await (const update of acp.prompt(sessionId, prompt, images)) {
            if (update.kind === 'text') answer += update.text;
            if (update.kind === 'tool_call') {
                const key = update.id || update.title;
                const seen = tools.get(key);
                if (seen) {
                    seen.status = update.status;
                    if (update.title) seen.title = update.title;
                } else {
                    tools.set(key, { title: update.title, status: update.status });
                }
                // Keyed by what it points at, so the same thing published twice in one turn is one
                // card rather than two identical ones.
                if (update.card) cards.set(update.card.url ?? update.card.ref ?? update.card.title, update.card);
            }
            yield update;
        }
    } finally {
        signal?.removeEventListener('abort', onAbort);
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
            ...(config.gooseModel ? { model: config.gooseModel } : {}),
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
