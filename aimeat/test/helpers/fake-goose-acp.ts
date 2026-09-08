/**
 * @file test/helpers/fake-goose-acp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An ACP agent that answers the way goose does, so a chat turn can be driven end to end
 *   without goose being installed.
 *
 *   WHY A WHOLE PEER AND NOT A STUB. Everything below runChatTurn's first three lines needs a live
 *   agent process: the handshake, the session, the callbacks the agent makes BACK to the node, the
 *   updates a turn emits, the cancel, the exit. None of it can be reached by a fake client, because
 *   the node is the client. So this is the other end of the pipe: real JSON-RPC, one object per
 *   line, on stdin and stdout.
 *
 *   HOW IT BECOMES THE "BINARY". services/goose-acp.ts spawns `spawn(bin, ['acp'])` with the
 *   argument list fixed, and Node 24 on Windows refuses to spawn a .cmd or .bat without `shell:true`
 *   (EINVAL, thrown synchronously, not even an `error` event). So the shim is not a script file at
 *   all: `bin` is node itself, and NODE_OPTIONS carries `--import tsx --import <this file>`. This
 *   module then CLAIMS the process when the entry point it was handed is called `acp`, runs the peer
 *   and exits before the missing entry module is ever resolved. The same env reaches the node under
 *   test, where the entry is src/index.ts and this module does nothing at all.
 *
 *   WHAT THE TURN DOES IS DRIVEN BY THE PROMPT TEXT, so one peer serves every case: STALL waits to
 *   be cancelled, DIENOW dies mid-turn. Everything else gets the full script.
 *
 *   EVERY MESSAGE IS WRITTEN DOWN. FAKE_GOOSE_LOG names a JSONL file, and the suite asserts against
 *   what the node actually sent: the capabilities it declared, the MCP server and token it handed
 *   over, the prompt with the attachments quoted into it, and how it answered the callbacks.
 * @structure
 *   - claimed() — is this process the spawned "goose", or the node that spawned it
 *   - the JSON-RPC plumbing: out(), record(), send(), ask()
 *   - handle()/dispatch() — one line in, one answer out
 *   - runTurn() — the scripted turn, including the two callbacks and the cancel
 * @usage
 *   AIMEAT_GOOSE_BIN=<path to node>
 *   NODE_OPTIONS="--import tsx --import file:///…/test/helpers/fake-goose-acp.ts"
 *   FAKE_GOOSE_LOG=<path to a JSONL file>
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial, with test/e2e-chat-agent.ts.
 */
import { appendFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

interface JsonRpcMessage {
    jsonrpc?: string;
    id?: number | string;
    method?: string;
    params?: Record<string, any>;
    result?: unknown;
    error?: { code: number; message: string };
}

const LOG = process.env.FAKE_GOOSE_LOG ?? '';

/**
 * One line of stdout, written SYNCHRONOUSLY.
 *
 * process.stdout to a pipe is asynchronous on Windows, and this peer exits on purpose in the middle
 * of a turn to prove what the node does when its agent dies. An async write queued behind that exit
 * is lost, and the turn under test then hangs instead of failing.
 */
function out(line: string): void {
    const buf = Buffer.from(`${line}\n`, 'utf8');
    let written = 0;
    while (written < buf.length) {
        try {
            written += writeSync(1, buf, written, buf.length - written);
        } catch (err) {
            // A full pipe is the one recoverable case; anything else is a real failure to write.
            if ((err as NodeJS.ErrnoException).code !== 'EAGAIN') throw err;
        }
    }
}

function record(entry: Record<string, unknown>): void {
    if (!LOG) return;
    appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), ...entry })}\n`, 'utf8');
}

function send(msg: unknown): void {
    out(JSON.stringify(msg));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Whether this process is the child that was spawned as the agent, rather than the node itself. */
function claimed(): boolean {
    return basename(process.argv[1] ?? '') === 'acp';
}

if (claimed()) {
    await runPeer();
}

async function runPeer(): Promise<void> {
    let nextId = 900;
    let sessionCount = 0;
    let saidSomethingHuman = false;
    /** Requests this peer made to the node, waiting for the node's answer. */
    const pending = new Map<number, (msg: JsonRpcMessage) => void>();
    /** Turns waiting to be cancelled, by session. */
    const cancels = new Map<string, () => void>();

    record({
        kind: 'started',
        argv: process.argv.slice(1),
        // The env the node built for its child: the operator's model, provider and key, and the path
        // root. Set only when the node was configured with them, which is the assertion.
        env: {
            GOOSE_MODEL: process.env.GOOSE_MODEL ?? null,
            GOOSE_PROVIDER: process.env.GOOSE_PROVIDER ?? null,
            GOOSE_PATH_ROOT: process.env.GOOSE_PATH_ROOT ?? null,
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? null,
        },
    });

    /** A request BACK to the node, answered by services/goose-acp.ts answerAgentRequest(). */
    function ask(method: string, params: Record<string, unknown>): Promise<JsonRpcMessage> {
        const id = nextId++;
        return new Promise((resolve) => {
            pending.set(id, resolve);
            send({ jsonrpc: '2.0', id, method, params });
            // A client that never answers must not hang the suite: the turn goes on and the log says
            // the answer never came, which is a failed assertion rather than a timeout.
            setTimeout(() => {
                if (pending.delete(id)) {
                    record({ kind: 'no-answer', method, id });
                    resolve({ id });
                }
            }, 20_000).unref?.();
        });
    }

    function update(sessionId: string, body: Record<string, unknown>): void {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } });
    }

    function textOf(params: Record<string, any> | undefined): string {
        const blocks: any[] = Array.isArray(params?.prompt) ? params!.prompt : [];
        return blocks.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n');
    }

    async function runTurn(requestId: number | string, params: Record<string, any>): Promise<void> {
        const sessionId = String(params.sessionId ?? '');
        const text = textOf(params);

        update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Working out what they want.' } });
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Here is ' } });

        // A goose that dies with a turn in flight. The node's child `exit` handler is what has to
        // turn this into an answer rather than a hang.
        if (text.includes('DIENOW')) {
            record({ kind: 'dying', sessionId });
            process.exit(3);
        }

        // A turn that runs until it is stopped, so the abort path has something to interrupt. It
        // keeps talking while it waits: a turn that goes silent is indistinguishable from one the
        // node stopped listening to, and the difference is the whole assertion.
        if (text.includes('STALL')) {
            let beat: NodeJS.Timeout | null = null;
            let stopped = false;
            await new Promise<void>((resolve) => {
                cancels.set(sessionId, () => { stopped = true; resolve(); });
                beat = setInterval(() => {
                    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } });
                }, 1000);
                // A ceiling, so a client that never cancels does not hold the suite for a minute.
                setTimeout(resolve, 8_000).unref?.();
            });
            if (beat) clearInterval(beat);
            cancels.delete(sessionId);
            send({ jsonrpc: '2.0', id: requestId, result: { stopReason: stopped ? 'cancelled' : 'end_turn' } });
            return;
        }

        // The two callbacks. Permission is asked with allow_once listed FIRST, so a client that
        // simply takes the first option cannot pass: goose-acp is supposed to prefer allow_always.
        const permission = await ask('session/request_permission', {
            sessionId,
            toolCall: { toolCallId: 'call-1', title: 'aimeat_app_publish' },
            options: [
                { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
                { optionId: 'never', name: 'Never', kind: 'reject_always' },
            ],
        });
        record({ kind: 'permission-answer', result: permission.result ?? null, error: permission.error ?? null });

        const readFile = await ask('fs/read_text_file', { sessionId, path: '/etc/hosts' });
        record({ kind: 'fs-answer', result: readFile.result ?? null, error: readFile.error ?? null });

        update(sessionId, {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-1',
            title: 'aimeat_app_publish',
            status: 'pending',
        });
        update(sessionId, {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-1',
            status: 'completed',
            content: [{
                type: 'content',
                content: {
                    type: 'text',
                    text: JSON.stringify({ ok: true, filename: 'pong.html', url: 'https://apps.example.test/pong' }),
                },
            }],
        });

        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'your game.' } });
        // Whatever goose adds next: the node keeps it rather than dropping it.
        update(sessionId, { sessionUpdate: 'usage_update', usage: { totalTokens: 11 } });

        if (!saidSomethingHuman) {
            saidSomethingHuman = true;
            // goose writes the occasional human line to stdout. It is not a protocol error, and the
            // node has to keep reading the stream after it.
            out('starting the model, this may take a moment');
            process.stderr.write('fake-goose: warming up the model\n');
            await sleep(50);
        }

        send({ jsonrpc: '2.0', id: requestId, result: { stopReason: 'end_turn', usage: { totalTokens: 1234 } } });
    }

    function dispatch(msg: JsonRpcMessage): void {
        const method = msg.method!;
        const params = msg.params ?? {};
        record({ kind: 'request', method, params });

        if (method === 'initialize') {
            send({
                jsonrpc: '2.0', id: msg.id,
                result: { protocolVersion: 1, agentInfo: { name: 'fake-goose', version: '9.9.9' }, agentCapabilities: {} },
            });
            return;
        }

        if (method === 'session/new') {
            const sessionId = `fake-session-${++sessionCount}`;
            send({
                jsonrpc: '2.0', id: msg.id,
                result: {
                    sessionId,
                    // A session is created even when a server failed to load, and the failure shows
                    // only here. The node is supposed to say so out loud.
                    extensionLoadResults: [
                        { name: 'aimeat', success: true },
                        { name: 'broken-mcp', success: false, error: 'the node was not reachable' },
                    ],
                },
            });
            return;
        }

        if (method === 'session/prompt') {
            void runTurn(msg.id!, params);
            return;
        }

        if (method === 'session/cancel') {
            cancels.get(String(params.sessionId ?? ''))?.();
            send({ jsonrpc: '2.0', id: msg.id, result: {} });
            return;
        }

        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no such method: ${method}` } });
    }

    function handle(line: string): void {
        let msg: JsonRpcMessage;
        try {
            msg = JSON.parse(line) as JsonRpcMessage;
        } catch {
            record({ kind: 'unparseable', line: line.slice(0, 200) });
            return;
        }
        // An answer to something this peer asked.
        if (msg.id !== undefined && !msg.method) {
            const waiter = pending.get(msg.id as number);
            if (waiter) { pending.delete(msg.id as number); waiter(msg); }
            else record({ kind: 'orphan-answer', id: msg.id });
            return;
        }
        if (msg.method && msg.id !== undefined) { dispatch(msg); return; }
        record({ kind: 'notification', method: msg.method ?? null, params: msg.params ?? null });
    }

    await new Promise<void>((resolve) => {
        const rl = createInterface({ input: process.stdin });
        rl.on('line', (line: string) => { if (line.trim()) handle(line.trim()); });
        rl.on('close', () => { record({ kind: 'stdin-closed' }); resolve(); });
    });
    record({ kind: 'exiting' });
    process.exit(0);
}
