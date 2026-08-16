/**
 * @file src/routes/chat.ts
 * @description The chat surface: the person's conversations, and one turn streamed as it happens.
 *
 *   A turn takes minutes when the agent is building something, so the answer cannot be one JSON
 *   response at the end. It is an event stream, and the events are the same ones the agent emits:
 *   words as they are written, and each tool call as it starts and finishes. Showing the tool calls
 *   is not decoration — it is how a person can tell what was done on their behalf.
 *
 *   Owner-only throughout. This is the person's own chat with their own agent, and an app-grant
 *   token that could read it would be reading everything they have ever asked for.
 * @structure
 *   - chatRouter(config, storage) — GET/POST/DELETE threads, POST .../turn (SSE), GET /v1/chat/status
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.2.0 — 2026-08-16 — A closed stream aborts the turn, so Stop and "I left the page" both reach
 *     the agent instead of only the browser.
 *   v1.1.0 — 2026-08-16 — /v1/chat/status answers who PAYS for a turn and on which model, because
 *     the page was deciding both for itself and getting the first one wrong: an owner with a key
 *     stored was told it was being used while the node's key paid for every turn.
 *   v1.0.0 — 2026-08-16 — Initial. Delete and reset look the conversation up before acting, so a
 *     caller who cannot see it is told nothing exists rather than that something happened.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
    createThread, readThread, listThreads, deleteThread,
} from '../services/chat-threads.js';
import { chatEnabled, runChatTurn, resetChatSession } from '../services/chat-session.js';
import { ensureChatAgent } from '../services/chat-agent.js';
import { readAllowance, remainingOf } from '../services/ai-allowance.js';
import { logger } from '../utils/logger.js';

export function chatRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const owner = (req: Request) => req.auth!.owner;
    const identity = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

    // GET /v1/chat/status — is there an agent here, what is it called, what is left to spend.
    // The chat page asks this first: a node with no agent configured has to say so plainly rather
    // than offer a box that will never answer.
    router.get('/v1/chat/status', requireAuth(), requireRole('owner'), async (req, res) => {
        const gaii = identity(req);
        const enabled = chatEnabled(config);
        const allowance = await readAllowance(storage, config, gaii);
        res.json(success(config.nodeId, {
            enabled,
            agent_name: `chat#${owner(req)}@${config.nodeId}`,
            allowance_remaining_usd: remainingOf(allowance),
            has_own_key: !!(await storage.getMemory(gaii, 'openrouter.apikey')),
            // WHO ACTUALLY PAYS FOR A TURN, decided here rather than guessed on the page.
            //
            // The page used to derive it: an owner with a key stored was told "running on your own
            // OpenRouter key" and everyone else was shown an allowance counting down. Neither was
            // true of a chat turn. The agent is one shared `goose acp` process with one
            // process-wide provider key (AIMEAT_GOOSE_PROVIDER_API_KEY), so every person's turn is
            // spent from the node's key, no owner key is ever handed to it, and nothing debits the
            // allowance — `debitAllowance` is called from services/ai-completion.ts and from
            // nowhere on this road. A person deciding whether to bring their own key was reading a
            // sentence about their own money that described somebody else's.
            //
            // 'own' and 'allowance' stay in the vocabulary because they become the answer the day
            // the agent's provider is pointed at this node's own /v1/llm proxy, where
            // prepareAiCall makes exactly that choice per person. Until then the honest answer is
            // 'node', and it is the server that says so.
            pays: 'node' as const,
            model: config.gooseModel || undefined,
            note: enabled ? undefined
                : 'No chat agent is configured on this node. An operator sets AIMEAT_GOOSE_BIN.',
        }));
    });

    // GET /v1/chat/threads — the person's open conversations, newest first.
    router.get('/v1/chat/threads', requireAuth(), requireRole('owner'), async (req, res) => {
        const threads = await listThreads(storage, identity(req));
        res.json(success(config.nodeId, {
            threads: threads.map((t) => ({
                id: t.id, title: t.title, created_at: t.createdAt,
                updated_at: t.updatedAt, turns: t.turns.length,
            })),
        }));
    });

    // POST /v1/chat/threads — start one.
    router.post('/v1/chat/threads', requireAuth(), requireRole('owner'), async (req, res) => {
        const { title } = req.body ?? {};
        const thread = await createThread(storage, config, identity(req),
            typeof title === 'string' && title.trim() ? title.trim().slice(0, 60) : undefined);
        // Provision the agent now rather than on the first turn, so it appears in the Agents tab
        // the moment a person opens the chat and its scopes can be seen before anything runs.
        await ensureChatAgent(storage, config, owner(req));
        res.status(201).json(success(config.nodeId, { thread }, [
            { description: 'Send a message', method: 'POST', url: `/v1/chat/threads/${thread.id}/turn` },
        ]));
    });

    // GET /v1/chat/threads/:id — one conversation, in full.
    router.get('/v1/chat/threads/:id', requireAuth(), requireRole('owner'), async (req, res) => {
        const thread = await readThread(storage, identity(req), req.params.id as string);
        if (!thread) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such conversation.'));
            return;
        }
        res.json(success(config.nodeId, { thread }));
    });

    // DELETE /v1/chat/threads/:id
    //
    // The conversation is looked up before it is deleted, and a caller who cannot see it is told
    // nothing exists. Deleting by key alone would answer "deleted: true" to somebody who owns
    // nothing, which is a claim about another person's data.
    router.delete('/v1/chat/threads/:id', requireAuth(), requireRole('owner'), async (req, res) => {
        const gaii = identity(req);
        const id = req.params.id as string;
        if (!await readThread(storage, gaii, id)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such conversation.'));
            return;
        }
        await deleteThread(storage, gaii, id);
        res.json(success(config.nodeId, { deleted: true }));
    });

    // POST /v1/chat/threads/:id/reset — forget the agent session, keep the conversation.
    // What a scope change needs: the session's MCP token carries the scopes it was minted with, so
    // changing them in the Agents tab has to reach the chat. This is how, and it costs one
    // handshake rather than the reconnect a person used to have to perform by hand.
    router.post('/v1/chat/threads/:id/reset', requireAuth(), requireRole('owner'), async (req, res) => {
        const gaii = identity(req);
        const id = req.params.id as string;
        if (!await readThread(storage, gaii, id)) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such conversation.'));
            return;
        }
        await resetChatSession({ storage, config }, gaii, id);
        res.json(success(config.nodeId, { reset: true }));
    });

    // POST /v1/chat/threads/:id/turn — say something, and watch what happens.
    //
    // Server-sent events rather than one response: a turn takes minutes when the agent is building
    // something, and a person watching a spinner for four minutes cannot tell work from a hang.
    router.post('/v1/chat/threads/:id/turn', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
        const threadId = req.params.id as string;
        const { text } = req.body ?? {};
        if (typeof text !== 'string' || !text.trim()) {
            res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'text is required.'));
            return;
        }
        const thread = await readThread(storage, identity(req), threadId);
        if (!thread) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such conversation.'));
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        const flush = () => { (res as unknown as { flush?: () => void }).flush?.(); };
        const send = (event: unknown) => { res.write(`data: ${JSON.stringify(event)}\n\n`); flush(); };

        // Open immediately. Without a first byte the stream is indistinguishable from a hung
        // connection, and the first real event may be a minute away.
        res.write('retry: 3000\n\n');
        res.write(':open\n\n');
        flush();

        // A turn outlives the default socket timeout by a wide margin.
        req.setTimeout(0);
        res.setTimeout(0);

        // A keepalive comment, so an intermediary with a short read timeout does not drop a turn
        // that is thinking. Comments carry no data and the client ignores them.
        const keepalive = setInterval(() => { res.write(':keepalive\n\n'); flush(); }, 15_000);

        // A disconnect ends the TURN, not just the stream. Without this the node stops listening
        // and goose keeps working on an answer that has nowhere to go, billed to the node's key.
        const abort = new AbortController();
        let finished = false;
        req.on('close', () => {
            finished = true;
            clearInterval(keepalive);
            abort.abort();
        });

        try {
            for await (const update of runChatTurn({ storage, config }, owner(req), threadId, text, abort.signal)) {
                if (finished) break;
                send(update);
            }
        } catch (err) {
            logger.warn(`[chat] turn failed: ${(err as Error).message}`);
            if (!finished) send({ kind: 'error', message: (err as Error).message });
        } finally {
            clearInterval(keepalive);
            if (!finished) res.end();
        }
    });

    return router;
}
