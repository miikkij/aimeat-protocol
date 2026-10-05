/**
 * @file src/routes/cortex/caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is asking, as services/cortex-lifecycle.ts wants the question put. Extracted
 *   from routes/cortex.ts (max-file-lines) when the federated-session answer below was written;
 *   the body moved unchanged and the route imports it.
 * @structure cortexCallerOf(req, nodeId, storage) → Promise<CortexCaller>
 * @usage
 *   import { cortexCallerOf } from './cortex/caller.js';
 *   const out = await installCortex({ storage, config }, await cortexCallerOf(req, config.nodeId, storage), { manifest, libs });
 * @version-history
 *   v1.3.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2). cortexCallerOf is async and takes storage.
 *   v1.2.0 — 2026-09-26 — The caller carries `identity`, resolveIdentity's answer (a person's GHII),
 *     and an activation publishes the cortex's actions under it (secaudit 2026-09, R3 7c).
 *   v1.1.0 — 2026-09-24 — The visitor's name is homeIdentityOf's: verifyJWT hands a visitor its home
 *     GHII as `owner` since this day, so appending the home node again would have named it twice.
 *   v1.0.0 — 2026-09-14 — Extraction, with the federated session no longer answering to the local
 *     account's name.
 */
import type { Request } from 'express';
import type { CortexCaller } from '../../services/cortex-lifecycle.js';
import type { Storage } from '../../storage/interface.js';
import { homeIdentityOf, isForeignPrincipal, resolveIdentity } from '../../utils/gaii.js';
import { isOperatorCaller } from '../../services/operator-override.js';

/**
 * `req.auth!.owner` is the bare owner name for an owner session and for that owner's agents alike,
 * which is what `installedBy` holds; `req.auth!.sub` is the acting principal, recorded on the schema
 * locks, memory and boards an activation materialises. A published action is keyed on the resolved
 * identity instead (`identity`, a person's GHII), as POST /v1/actions keys one: every work door
 * finds a provider's actions and work under it.
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
export async function cortexCallerOf(req: Request, nodeId: string, storage: Storage): Promise<CortexCaller> {
  return {
    ownerName: isForeignPrincipal(req.auth) ? homeIdentityOf(req.auth!) : req.auth!.owner,
    gaii: req.auth!.sub,
    identity: resolveIdentity(req.auth!, nodeId),
    // The operator in person, or the operator's agent holding operator:admin: the answer the MCP
    // tools give (services/operator-override.ts).
    isOperator: await isOperatorCaller(storage, req.auth),
  };
}
