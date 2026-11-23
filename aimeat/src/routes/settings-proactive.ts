/**
 * @file src/routes/settings-proactive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The switch for proactive guidance (services/proactive-mode.ts).
 *
 *   GET /v1/settings/proactive — whether this account's AIs are equipped to offer things.
 *   PUT /v1/settings/proactive — change it.
 *
 *   THE WRITE IS THE ACCOUNT HOLDER'S OWN; THE READ IS NOT. PUT is for a person changing the switch
 *   in their settings, so it is person-only and records `by: 'person'` without asking. An agent
 *   changes the setting through the memory key instead: `settings.proactive` is an ordinary owner
 *   memory key, not a reserved one, so an agent told "stop suggesting things" writes it there and
 *   then instead of sending somebody to a settings page. That is the whole point of the setting
 *   being a memory record. GET answers whoever the memory read of that key serves: the account
 *   holder, and an agent or an app of theirs that holds memory:read. The answer carries one thing
 *   the key does not, `available_here`, the operator's switch; without this read an agent that
 *   interrupts people could not know the feature is off on this node.
 *
 *   IT REPORTS THE OPERATOR SWITCH SEPARATELY. `enabled` is what actually happens; `owner_choice`
 *   is what this account asked for. On a node whose operator turned the feature off they differ,
 *   and a surface that only had `enabled` would show the person a switch that does nothing and no
 *   reason why.
 * @structure settingsProactiveRouter(config, storage): GET + PUT /v1/settings/proactive
 * @usage Mounted in mountRoutes() (server-bootstrap/routes-loader.ts).
 * @version-history
 *   v1.1.0 — 2026-11-23 — GET answers the owner's own agents and apps that hold memory:read, with
 *     the checks GET /v1/memory/:key applies to the setting's own key; a session from another node
 *     and an ecosystem app are refused. The PUT hint is sent only to the account holder in person.
 *     PUT is unchanged.
 *   v1.0.0 — 2026-08-22 — Initial.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireExternalPrincipal, requireRole, requireScope } from '../auth/middleware.js';
import { deny403 } from '../auth/deny.js';
import { callerOf } from '../middleware/caller.js';
import { success, error } from '../middleware/envelope.js';
import { requireOwnerSession } from './home/welcome-mat.js';
import { readProactiveMode, servesProactiveRead, writeProactiveMode, type ProactiveMode } from '../services/proactive-mode.js';

/** One shape for both verbs, so a client never has to handle two. */
function payload(mode: ProactiveMode) {
    return {
        enabled: mode.enabled,
        /** True while nothing has been chosen and this is simply the default. */
        defaulted: mode.defaulted,
        /** What this account asked for, which differs from `enabled` only on a node that opted out. */
        owner_choice: mode.ownerChoice,
        /** False when this node's operator switched the feature off for everybody. */
        available_here: mode.availableHere,
        set_by: mode.setBy,
        set_at: mode.setAt,
    };
}

export function settingsProactiveRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // The read is for whoever the memory read of PROACTIVE_KEY serves, and nobody else: the same
    // checks in the same order as GET /v1/memory/:key (routes/memory/key.ts), then the kinds of
    // caller that read gives none of the owner's own records (servesProactiveRead). The account is
    // the token's own; no parameter names another.
    router.get('/v1/settings/proactive', requireAuth(), requireExternalPrincipal(), requireScope('memory:read'),
        async (req, res) => {
            const caller = callerOf(req, config.nodeId, storage);
            if (!servesProactiveRead(caller)) {
                deny403(req, res, 'ACCESS_DENIED',
                    'This setting belongs to an account on this node. A session from another node and an ecosystem app do not read it.');
                return;
            }
            const mode = await readProactiveMode(storage, config, caller.owner);
            // Only the account holder in person can make the change this hint names (the PUT below).
            res.json(success(config.nodeId, payload(mode), caller.inPerson ? [{
                description: mode.enabled
                    ? 'Turn off ideas about what else you could do here'
                    : 'Turn ideas about what else you could do here back on',
                method: 'PUT',
                url: '/v1/settings/proactive',
                example_body: { enabled: !mode.enabled },
            }] : undefined));
        });

    router.put('/v1/settings/proactive', requireAuth(), requireRole('owner'),
        requireOwnerSession(config.nodeId), async (req, res) => {
            const enabled = (req.body ?? {}).enabled;
            if (typeof enabled !== 'boolean') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                    'Say whether you want these ideas on or off: send enabled as true or false.'));
                return;
            }

            // A person is at the other end of this route; the agent path writes the key itself.
            const mode = await writeProactiveMode(storage, config, req.auth!.owner, enabled, 'person');
            res.json(success(config.nodeId, payload(mode)));
        });

    return router;
}
