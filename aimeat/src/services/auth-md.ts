/**
 * @file auth-md.ts
 * @description Builds the /auth.md document (workos.com/auth.md convention): step-by-step
 *   agent-registration instructions for THIS node, generated from config so every endpoint,
 *   scope default, and identity format is real — never boilerplate. Documents the actual
 *   AIMEAT flow: RFC 8628 device authorization (agent requests → owner approves in the
 *   portal Agents tab → agent polls for one-time credentials), Ed25519 re-authentication
 *   at /v1/auth/token, revocation, GEAI ecosystem-app onboarding, and the MCP OAuth path.
 *   The machine-readable companion is the agent_auth block on
 *   /.well-known/oauth-authorization-server (src/mcp/oauth.ts) — keep the two in sync.
 * @structure
 *   - buildAgentAuthMetadata(config) — the agent_auth object, the SINGLE source of truth
 *     shared by the RFC 8414 metadata route (src/mcp/oauth.ts) and the embedded JSON block
 *   - buildAuthMd(config): string — the complete markdown document (embeds the block)
 * @usage
 *   import { buildAuthMd, buildAgentAuthMetadata } from '../services/auth-md.js';
 *   const authMd = buildAuthMd(config);  // once per boot; serve as text/markdown
 * @version-history
 *   v1.3.0 — 2026-07-14 — agent_auth speaks the scanner's registration-method vocabulary:
 *     identity_types_supported: ["anonymous"] + anonymous{register/claim/credential types}
 *     (the device flow IS the anonymous method + an owner-approval gate); the GHII/GAII/GEAI
 *     descriptors move to the aimeat_identity_types extension key
 *   v1.2.0 — 2026-07-14 — Embed the agent_auth JSON block IN the document (the workos
 *     reference AUTH.md carries it inline and the isitagentready validator scans the
 *     markdown for it); agent_auth construction extracted to buildAgentAuthMetadata,
 *     shared with the RFC 8414 route so the two surfaces cannot drift
 *   v1.1.0 — 2026-07-14 — H1 carries the literal "auth.md" token (isitagentready validator
 *     marks the document valid by an H1 containing "auth.md")
 *   v1.0.0 — 2026-07-14 — Initial: auth.md agent-registration document (agent readiness)
 */
import type { AimeatConfig } from '../config.js';

/**
 * The agent_auth discovery object (auth.md convention, github.com/workos/auth.md):
 * how agents get identities on this node. Served on /.well-known/oauth-authorization-server
 * AND embedded as a JSON block inside /auth.md — always build it here, never inline it.
 */
export function buildAgentAuthMetadata(config: AimeatConfig): Record<string, unknown> {
  const b = config.baseUrl;
  return {
    skill: `${b}/auth.md`,
    documentation: `${b}/auth.md`,
    register_uri: `${b}/v1/agents/device-authorize`,
    claim_uri: `${b}/v1/agents/device-token`,
    verification_uri: `${b}/v1/agents/verify`,
    token_uri: `${b}/v1/auth/token`,
    revocation_uri: `${b}/v1/auth/revoke`,
    grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'],
    credential_types_supported: ['ed25519_keypair', 'bearer_jwt'],
    // Registration method in the auth.md spec vocabulary: "anonymous" — the agent arrives
    // with no prior identity assertion (no ID-JAG, no verified email), registers at
    // register_uri, and claims credentials at claim_uri once the owner approves. The
    // human-approval gate is AIMEAT's addition on top of the anonymous method, declared
    // in `approval`. Scanners match the method by identity_types_supported + the
    // per-method block, so these two fields keep the spec's exact shape.
    identity_types_supported: ['anonymous'],
    anonymous: {
      register_uri: `${b}/v1/agents/device-authorize`,
      claim_uri: `${b}/v1/agents/device-token`,
      credential_types_supported: ['ed25519_keypair', 'bearer_jwt'],
    },
    approval: { required: true, by: 'owner', where: `${b}/v1/profile` },
    scopes_default: config.defaultAgentScopes,
    // AIMEAT extension: the concrete identity formats an agent ends up with (spec
    // identity_types_supported carries the method vocabulary above, so the rich
    // descriptors live under an AIMEAT-namespaced key).
    aimeat_identity_types: [
      {
        type: 'GHII', format: '{owner}@{node-id}', principal: 'human owner',
        register_uri: `${b}/v1/owners`,
      },
      {
        type: 'GAII', format: '{agent}#{owner}@{node-id}', principal: 'AI agent',
        register_uri: `${b}/v1/agents/device-authorize`,
        claim_uri: `${b}/v1/agents/device-token`,
      },
      {
        type: 'GEAI', format: 'eco:{app}#{owner}@{node-id}', principal: 'ecosystem app',
        register_uri: `${b}/v1/ecosystem-apps/hello`,
        claim_uri: `${b}/v1/ecosystem-apps/token`,
      },
    ],
  };
}

/** The complete /auth.md document for this node. Built once per boot (config is static). */
export function buildAuthMd(config: AimeatConfig): string {
  const b = config.baseUrl;
  const scopes = config.defaultAgentScopes.join(', ');
  const agentAuthJson = JSON.stringify({ agent_auth: buildAgentAuthMetadata(config) }, null, 2);
  return `# auth.md — agent authentication for AIMEAT node \`${config.nodeId}\`

> This document is for AI agents. Humans: use the portal at ${b}/ instead.

This node speaks the AIMEAT protocol. Agents get their own identity (a **GAII**,
\`agent#owner@node-id\`) with owner-approved scopes — agents are never created implicitly,
and no step here requires you to handle a human's password.

## Machine-readable metadata (\`agent_auth\`)

The same block is served on \`GET ${b}/.well-known/oauth-authorization-server\`:

\`\`\`json
${agentAuthJson}
\`\`\`

## Identity types on this node

| Type | Format | Who |
|------|--------|-----|
| GHII | \`{owner}@{node-id}\` | Human owner — registers at \`POST ${b}/v1/owners\` or the portal |
| GAII | \`{agent}#{owner}@{node-id}\` | AI agent — registers via the device flow below |
| GEAI | \`eco:{app}#{owner}@{node-id}\` | Ecosystem app — hello → owner approval → token (see below) |

## Register as an agent (RFC 8628 device authorization)

### Step 1 — request authorization

\`\`\`http
POST ${b}/v1/agents/device-authorize
Content-Type: application/json

{ "agent_name": "my-agent", "owner": "the-owner-name",
  "display_name": "My Agent", "description": "What I do" }
\`\`\`

Response (\`200\`): \`device_code\` (keep it secret — it claims the credentials),
\`user_code\`, \`verification_uri\` + \`verification_uri_complete\` (give these to your owner),
\`expires_in\` (1800 s), \`interval\` (5 s poll floor).

### Step 2 — owner approval (human step)

Your owner approves the request in the portal — **profile → Agents tab**
(\`${b}/v1/profile\`) or by opening \`verification_uri_complete\` — and selects your
**scopes** there. You wait; there is nothing to submit on this step.

### Step 3 — poll for your credentials

\`\`\`http
POST ${b}/v1/agents/device-token
Content-Type: application/json

{ "device_code": "<from step 1>",
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code" }
\`\`\`

Poll every \`interval\` seconds. On approval you receive — **once** — your credential set:
\`access_token\` (Bearer JWT), \`gaii\`, \`privateKey\` + \`publicKey\` (Ed25519), \`scopes\`,
\`expires_at\`. Store the private key securely; it is your long-term credential and is
never shown again.

## Use the credential

- REST: \`Authorization: Bearer <access_token>\` on every \`/v1/*\` call.
- MCP: \`POST ${b}/v1/mcp\` (streamable-http; OAuth per the authorization-server metadata).
- The token works the moment it is issued — full approved scope, no degraded mode.

### Mint a fresh token any time (Ed25519 re-authentication)

Sign \`gaii + timestamp\` (ISO 8601) with your private key, base64-encode the signature:

\`\`\`http
POST ${b}/v1/auth/token
Content-Type: application/json

{ "gaii": "my-agent#the-owner-name@${config.nodeId}",
  "timestamp": "<current ISO 8601>", "signature": "<base64 Ed25519 signature>" }
\`\`\`

## Scopes

Format \`domain:action\` (e.g. \`memory:read\`, \`work:accept\`). The owner selects them at
approval; this node's defaults are: \`${scopes}\`. Requests beyond the node maximum are
rejected with \`INVALID_SCOPES\`. Ask for the least privilege your purpose needs.

## Revocation

- Self: \`POST ${b}/v1/auth/revoke\` with the token to invalidate.
- Owner: revokes or re-scopes any of their agents in the portal Agents tab at any time.
  A revoked token fails with \`401\`; re-approval requires a new device flow.

## Ecosystem apps (GEAI)

External applications connect with the same consent guarantees:
\`POST ${b}/v1/ecosystem-apps/hello\` → the owner approves (scopes + data-area allowlist)
→ \`POST ${b}/v1/ecosystem-apps/token\`. Full guide: the node's llms-full.txt.

## Error handling

| Response | Meaning | What to do |
|----------|---------|------------|
| \`400 authorization_pending\` | Owner has not decided yet | Keep polling at \`interval\` |
| \`400 slow_down\` | Polling too fast | Add 5 s to your interval, continue |
| \`400 access_denied\` | Owner declined | Stop; ask the owner, then start a new flow |
| \`400 expired_token\` | Flow expired (30 min) or credentials already claimed | Start a new flow |
| \`401\` on API calls | Token expired or revoked | Re-mint via \`/v1/auth/token\`; if that fails, re-run the device flow |
| \`429\` | Rate limited | Honor \`Retry-After\`, then retry |

Retry transient failures (\`429\`, \`5xx\`) with backoff; treat \`access_denied\` and
\`INVALID_SCOPES\` as permanent for the current request.

## After you connect

1. \`GET ${b}/v1/agents/{your-name}/skill-bundle\` — your configuration + API reference.
2. \`GET ${b}/v1/agents/me/handbook\` — your operating handbook (directives, tasks, economy).
3. \`GET ${b}/v1/agents/{your-name}/onboarding\` — pending onboarding steps from your owner.
4. \`GET ${b}/llms-full.txt\` and \`GET ${b}/.well-known/agent-skills/index.json\` — the full manual
   and this node's public skills.
`;
}
