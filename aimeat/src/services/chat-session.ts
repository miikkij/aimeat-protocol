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
    deps: ChatDeps, ownerName: string, threadId: string, text: string,
): AsyncGenerator<SessionUpdate> {
    const { storage, config } = deps;
    if (!chatEnabled(config)) {
        yield { kind: 'error', message: 'This node has no chat agent configured.' };
        return;
    }

    const gaii = await resolveGhii(storage, ownerName, `${ownerName}@${config.nodeId}`);
    const now = new Date().toISOString();
    await appendTurn(storage, gaii, threadId, { role: 'user', text, at: now });

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
    // Keyed by the call's OWN id, not its title. A tool call arrives twice — once as it starts and
    // once as it finishes — and only the first carries a title, so matching on the title leaves
    // every call in the log reading "starting" forever, whatever actually happened to it.
    const tools = new Map<string, { title: string; status: string }>();
    let answer = '';

    try {
        for await (const update of acp.prompt(sessionId, text)) {
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
            }
            yield update;
        }
    } finally {
        // Written even when the turn ended badly: half an answer and the tools that ran is a truer
        // record than nothing, and it is what the person saw on screen.
        const turn: ChatTurn = {
            role: 'agent',
            text: answer,
            at: new Date().toISOString(),
            ...(tools.size ? { tools: [...tools.values()] } : {}),
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
