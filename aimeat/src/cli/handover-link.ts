/**
 * @file src/cli/handover-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat handover-link [--account <name>] [--lang fi|en|es]`: print one JSON line with a
 *   one-time sign-in link for the person this node was set up for, valid for ten minutes and landing
 *   on their Home. Run inside the node's own container by the fleet's control service
 *   (`docker exec <place>-node node dist/src/index.js handover-link --lang fi`); the work is
 *   services/handover-link.ts. Exit status 0 with {"url","account","expires_at","lands_on"}, 1 with
 *   {"error","message"} when no link could be issued.
 * @structure runHandoverLink(config, { account, lang })
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni v27 P3).
 */
import type { AimeatConfig } from '../config.js';
import { createStorage } from '../storage/storage-factory.js';
import { issueHandoverLink } from '../services/handover-link.js';

export async function runHandoverLink(config: AimeatConfig, opts: { account?: string; lang?: string }): Promise<number> {
    if (config.storageProvider === 'memory') {
        console.log(JSON.stringify({ error: 'NO_DATABASE', message: 'handover-link needs the node\'s persistent database (PostgreSQL or SQLite).' }));
        return 1;
    }
    const storage = await createStorage({ provider: config.storageProvider, sqlitePath: config.sqlitePath, dbUrl: config.dbUrl ?? undefined });
    const out = await issueHandoverLink(storage, config, opts);
    if (!out.ok) {
        console.log(JSON.stringify({ error: out.code, message: out.message, ...(out.candidates ? { candidates: out.candidates } : {}) }));
        return 1;
    }
    console.log(JSON.stringify({ url: out.url, account: out.account, expires_at: out.expires_at, lands_on: out.lands_on }));
    return 0;
}
