/**
 * @file src/routes/cortex/caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is asking, as services/cortex-lifecycle.ts wants the question put. Extracted
 *   from routes/cortex.ts (max-file-lines) when the federated-session answer below was written;
 *   the body moved unchanged and the route imports it.
 * @structure cortexCallerOf(req) → CortexCaller
 * @usage
 *   import { cortexCallerOf } from './cortex/caller.js';
 *   const out = await installCortex({ storage, config }, cortexCallerOf(req), { manifest, libs });
 * @version-history
 *   v1.0.0 — 2026-09-14 — Extraction, with the federated session no longer answering to the local
 *     account's name.
 */
import type { Request } from 'express';
import type { CortexCaller } from '../../services/cortex-lifecycle.js';

/**
 * `req.auth!.owner` is the bare owner name for an owner session and for that owner's agents alike,
 * which is what `installedBy` holds; `req.auth!.sub` is the acting principal, recorded on whatever
 * an activation materialises.
 *
 * A SESSION FROM ANOTHER NODE IS NOT THE LOCAL ACCOUNT OF THE SAME NAME. A federated login mints
 * `owner` as the local part of the visitor's HOME name (routes/ghii/register-login.ts), and every
 * ownership question in cortex-lifecycle.ts is `ext.installedBy === caller.ownerName`. So a visitor
 * called `alice` compared equal to the local `alice` and held her cortexes: her private ones in the
 * listing and on the detail door, and — because the same name gates the write side — the power to
 * update, deactivate and delete them and to claim her namespace. That is not a read leak, it is her
 * account.
 *
 * The home node is appended, which cannot collide because `installedBy` holds a bare name and
 * OWNER_RE admits no `@`. Public cortexes stay readable, which is what a visitor should see and all
 * they should see. Found by the AI triage of 2026-09-13; routes/contacts.ts answered the same
 * question with requireLocalSession() on the day, and this route had no such guard anywhere.
 *
 * requireLocalSession() was considered and not taken here: it would also shut the public catalogue
 * read, which a visitor is entitled to.
 */
export function cortexCallerOf(req: Request): CortexCaller {
  return {
    ownerName: req.auth!.federated ? `${req.auth!.owner}@${req.auth!.homeNode ?? 'unknown-home'}` : req.auth!.owner,
    gaii: req.auth!.sub,
    isOperator: req.auth!.roles.includes('operator'),
  };
}
