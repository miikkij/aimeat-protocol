/**
 * @file ai-provider-stub-node.ts
 * @description The node that test/e2e-ai-provider-stub.ts starts for itself, with the environment
 *   its cases depend on: the runner's pin list, egress to the loopback stub, one AI job slot, and
 *   a node key with a default image model but no default transcription model (case 5e).
 *   Moved out of the suite unchanged, so the suite stays within the 800-line limit.
 * @structure startAiStubNode(port, base) — spawns the node on its own SQLite file and waits for it;
 *   stopAiStubNode(node) — stops it and removes that file's folder
 * @usage
 *   import { startAiStubNode, stopAiStubNode } from './helpers/ai-provider-stub-node.js';
 * @version-history
 *   2026-11-21 — Moved out of test/e2e-ai-provider-stub.ts (pure extraction).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedEnv } from '../run-e2e-server.js';
import { nodeEntryArgs } from './node-entry.js';
import { ownNodeDb } from './own-node-db.js';
import { waitForServer } from './wait-for-server.js';

export interface AiStubNode { child: ChildProcess; dbDir: string }

export async function startAiStubNode(PORT: string, BASE: string): Promise<AiStubNode> {
    const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-stub-'));
    const DB_PATH = join(dbDir, 'ai-stub.db');
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const target = {
        port: PORT, baseUrl: BASE, dbType: db.provider, dbPath: db.sqlitePath, dbUrl: db.dbUrl, external: false,
    };
    const env: Record<string, string | undefined> = {
        ...process.env,
        // The runner's own pin list, so this node behaves like every other test node: no real SMTP,
        // no developer .env leaking a live OAuth client, generous ceilings, a fixed operator.
        ...pinnedEnv(target),
        ...db.env,
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        // The stub lives on loopback, which outbound validation refuses on a public node and must.
        AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
        AIMEAT_RL_OPENROUTER: '1000',
        AIMEAT_RL_GLOBAL: '10000',
        AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        // One slot, so the second job of a pair is genuinely queued rather than racing to finish.
        AIMEAT_AI_JOB_SLOTS: '1',
        // 5e: a node key and a node default IMAGE model, but no node default transcription model.
        // The node's key goes only to OpenRouter's own address, so no stub can answer it; what 5e
        // proves is which key the gate CHOSE, read off the refusal each operation reaches. No free
        // starter allowance, so the node's key is chosen and found spent rather than called.
        AIMEAT_OPENROUTER_INSTANCE_KEY: 'sk-node-e2e-never-sent',
        AIMEAT_CHAT_FREE_ALLOWANCE_USD: '0',
        AIMEAT_MODEL_DEFAULT_IMAGE: 'stub/node-image-model',
        AIMEAT_MODEL_DEFAULT_STT: '',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    // The stderr tail and the exit check that used to live here are the helper now, so the other
    // sixteen suites that spawn a node get them too.
    return { child: await waitForServer(child, BASE, { label: 'the AI-provider node' }), dbDir };
}

export async function stopAiStubNode(node: AiStubNode): Promise<void> {
    const child = node.child;
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        // Wait for the process to be GONE rather than sleeping a guessed second: on Windows the
        // SQLite file cannot be deleted while the handle is open.
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
    // A leftover temp directory is not a result, and the OS collects it either way.
    try { rmSync(node.dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }
}
