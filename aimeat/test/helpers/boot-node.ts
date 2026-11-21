/**
 * @file test/helpers/boot-node.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Boots an AIMEAT node inside the test process, and mints again every token an earlier
 *   node of the same process handed out.
 *
 *   WHY THE RE-MINT. `initNodeKeys` (src/auth/jwt.ts) keeps the signing keypair in module-level
 *   variables, which is right for a real node (one per process). A suite that boots two or three
 *   nodes in one process gets one key between them, and the last boot wins: every token an earlier
 *   node issued stops verifying and answers 401 AUTH_REQUIRED from a live server, with a body that
 *   carries no `node` field. federation-messages.ts lost seven assertions to it for weeks, because
 *   its node C booted inside test 5b (docs/pitfalls.md §45 until 2026-11-21). A suite registers how
 *   to mint each token it holds (`remintAfterLaterBoot`), and every later boot runs those mints, so
 *   a suite that adds a fourth node needs to know none of this.
 *
 *   A NEW SUITE THAT BOOTS A NODE IN-PROCESS USES THIS. test/unit/boot-node-helper.test.ts refuses a
 *   test file that calls createServer() and does not import this helper, beyond the files listed in
 *   security/boot-node-baseline.json on the day it was written.
 * @structure bootNode(opts) · remintAfterLaterBoot(mint) · BootedNode
 * @usage
 *   const a = await bootNode({ port: 28270, nodeId: 'aimeat-hub-001-a', configure: c => { c.federationOpenJoin = true; } });
 *   a.token = await ownerToken(a.baseUrl, 'alice');
 *   remintAfterLaterBoot(async () => { a.token = await ownerToken(a.baseUrl, 'alice'); });
 * @version-history
 *   v1.0.0 — 2026-11-21 — Extracted from federation-messages.ts, which had the only re-mint.
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import type { AimeatConfig } from '../../src/config.js';
import { ownNodeDb } from './own-node-db.js';

export interface BootedNode {
    server: Server;
    config: AimeatConfig;
    storage: Awaited<ReturnType<typeof createServer>>['storage'];
    scheduler: Awaited<ReturnType<typeof createServer>>['scheduler'];
    baseUrl: string;
    nodeId: string;
    adminPw: string;
}

const REMINTS: Array<() => Promise<void>> = [];

/** Run `mint` after every node booted from now on in this process: it re-issues a token an earlier boot's key signed. */
export function remintAfterLaterBoot(mint: () => Promise<void>): void {
    REMINTS.push(mint);
}

/**
 * A node on 127.0.0.1:`port`, on the run's backend (own-node-db.ts: SQLite in memory, or a database
 * of its own on a PostgreSQL run), in dev and test mode with a fresh admin password. `configure`
 * changes the loaded configuration before the server is created.
 */
export async function bootNode(opts: { port: number; nodeId: string; dbTag?: string; configure?: (config: AimeatConfig) => void }): Promise<BootedNode> {
    const { port, nodeId } = opts;
    const adminPw = randomBytes(16).toString('base64url');
    const baseUrl = `http://127.0.0.1:${port}`;
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = baseUrl;

    const { config } = loadConfig({});
    Object.assign(config, (await ownNodeDb(opts.dbTag ?? String(port), { memory: true })).config);
    config.port = port;
    config.nodeId = nodeId;
    config.baseUrl = baseUrl;
    config.devMode = true;
    config.testMode = true;
    config.adminPassword = adminPw;
    opts.configure?.(config);

    const { app, storage, scheduler } = await createServer(config);
    // Bound to the loopback address and spoken to by it: `localhost` needs a choice between ::1 and
    // 127.0.0.1, and on a loaded runner that choice was where `fetch failed` came from.
    const server = await new Promise<Server>(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });

    // createServer has just replaced the process-wide signing key: mint every earlier token again.
    for (const mint of REMINTS) await mint();
    return { server, config, storage, scheduler, baseUrl, nodeId, adminPw };
}
