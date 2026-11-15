/**
 * @file src/tool-dispatch/tool-call-defs-teams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team tools on the CLI dispatch (`aimeat connect call` and `POST /local/call/<tool>`):
 *   thin REST proxies over POST /v1/teams/setup and GET /v1/teams/status (src/routes/organisms/teams.ts).
 *   Every rule is the route's (services/team/); this file adds none.
 * @structure teamCliTools[] — the handler table, spread by index.ts
 * @usage import { teamCliTools } from './tool-call-defs-teams.js';
 * @version-history
 *   v1.3.0 — 2026-11-15 — aimeat_team_onboarding_done → POST /v1/teams/:id/onboarding.
 *   v1.2.0 — 2026-11-15 — aimeat_team_decision_share → POST /v1/teams/:id/decisions/:decision/share.
 *   v1.1.0 — 2026-11-14 — aimeat_team_waiting → GET /v1/teams/waiting.
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
        // → GET /v1/teams/waiting
        name: 'aimeat_team_waiting',
        handler: ({ client }) => client.get('/v1/teams/waiting'),
    },
    {
        // → POST /v1/teams/:id/decisions/:decision/share
        name: 'aimeat_team_decision_share',
        handler: ({ client }, input) => {
            const body: JsonObject = { to: input.to ?? [] };
            const withdraw = optionalBoolean(input, 'withdraw'); if (withdraw !== undefined) body.withdraw = withdraw;
            const dryRun = optionalBoolean(input, 'dry_run'); if (dryRun !== undefined) body.dry_run = dryRun;
            return client.post(`/v1/teams/${encodeURIComponent(String(input.organism_id ?? ''))}/decisions/${encodeURIComponent(String(input.decision ?? ''))}/share`, body);
        },
    },
    {
        // → POST /v1/teams/:id/onboarding
        name: 'aimeat_team_onboarding_done',
        handler: ({ client }, input) => client.post(`/v1/teams/${encodeURIComponent(String(input.organism_id ?? ''))}/onboarding`, {}),
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
