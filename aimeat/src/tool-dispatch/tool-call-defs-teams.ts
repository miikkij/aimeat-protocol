/**
 * @file src/tool-dispatch/tool-call-defs-teams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team tools on the CLI dispatch (`aimeat connect call` and `POST /local/call/<tool>`):
 *   thin REST proxies over POST /v1/teams/setup and GET /v1/teams/status (src/routes/teams.ts).
 *   Every rule is the route's (services/team/); this file adds none.
 * @structure teamCliTools[] — the handler table, spread by index.ts
 * @usage import { teamCliTools } from './tool-call-defs-teams.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalBoolean, optionalString } from './tool-call-helpers.js';

export const teamCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/teams/setup
        name: 'aimeat_team_setup',
        handler: ({ client }, input) => {
            const body: JsonObject = { teams: input.teams ?? [] };
            const dryRun = optionalBoolean(input, 'dry_run'); if (dryRun !== undefined) body.dry_run = dryRun;
            return client.post('/v1/teams/setup', body);
        },
    },
    {
        // → GET /v1/teams/status
        name: 'aimeat_team_status',
        handler: ({ client }, input) => {
            const orgId = optionalString(input, 'organism_id');
            return client.get(`/v1/teams/status${orgId ? `?organism_id=${encodeURIComponent(orgId)}` : ''}`);
        },
    },
];
