/**
 * @file src/data/getting-started.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `getting_started` narrative in the node's discovery response (GET /). This is
 *   the FIRST thing an AI reads about this node, and for a long time it was wrong: it told agents
 *   to ask their user for a "connectivity key", a flow removed in v1.1.0, and it never mentioned
 *   how an account gets created at all. An agent that followed it reached a dead end.
 *
 *   It lives in its own file for that reason. It is the most consequential prose the node serves to
 *   machines, and it was buried in the middle of an 800-line route where nobody looked at it.
 *
 *   Two doors, matching what actually exists:
 *     - the person HAS an account → device authorization (RFC 8628), then prove the connection by
 *       writing the Hello MCP key through it;
 *     - the person has NO account → POST /v1/registration-invites with their email, and they finish
 *       it from the link. The AI never picks the username.
 * @structure buildGettingStarted(base, instruction, anonymousMode)
 * @usage import { buildGettingStarted } from '../data/getting-started.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted from routes/bootstrap.ts and rewritten off the removed
 *     connectivity-key flow onto device authorization + the registration invite (remake 4b).
 */

/**
 * Build the getting-started narrative.
 * @param base the node's base URL, no trailing slash
 * @param instruction the operator-configurable opening line (a managed prompt)
 * @param anonymousMode whether this node also offers an anonymous identity
 */
export function buildGettingStarted(
  base: string, instruction: string, anonymousMode: boolean,
): Record<string, unknown> {
  return {
      instruction,

      step_1_identify_your_capabilities: {
        question: 'What can you do as an AI?',
        options: [
          { if: 'You can connect to MCP servers or use integrations/connectors', then: `Connect via MCP at ${base}/v1/mcp for the full built-in tool set, or ${base}/v2/mcp/agent for a focused owner-agent surface (see endpoints.connection_methods.mcp_connection.surfaces)` },
          { if: 'You can make POST requests with custom headers (curl, code execution, fetch)', then: 'Use JWT auth flow — proceed to step_3_authenticate after connecting to your user' },
          { if: 'You can only open/fetch GET URLs', then: 'You are Tier 0/0.5. You can browse public data. For writes, connect over MCP or ask your human for help.' },
        ],
      },

      step_2_connect_to_user: {
        question: 'Ask your user: "Do you already have an account on this node?"',
        paths: {
          has_account: {
            action: `POST ${base}/v1/agents/device-authorize`,
            body: '{ "agent_name": "<a short name for yourself>", "owner": "<their username>" }',
            result: 'You get back a user_code. Show it to them; they approve it in their browser and choose what you may do.',
            then: `Poll POST ${base}/v1/agents/device-token every 5 seconds with { "device_code": "<device_code>", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" } until it returns 200 with an access_token.`,
            prove_it: `Write the key onboarding.hello_mcp through the connection (POST ${base}/v1/memory). Until that key exists the connection is unverified, and their home is not finished.`,
            next: 'You are connected. Use the token only within the approved scopes.',
            standard: 'OAuth 2.0 device authorization, RFC 8628. The owner approves every agent and picks its scopes.',
          },
          no_account: {
            action: `POST ${base}/v1/registration-invites`,
            body: '{ "email": "<ask them for it>", "agent": { "model": "<your model>", "vendor": "<who made you>", "client": "<the app you are running in>" } }',
            result: 'We email them a link. They press it, choose a username, and the account exists. There is no code for them to type, and you never choose the username.',
            ask_for: 'ONLY their email address. Nothing else.',
            tell_them: 'The message shows the IP address this call came from and which AI made it, so they can see it was you and not someone else.',
            next: 'Once they have the account, come back to the has_account path and connect yourself as their agent.',
            if_you_cannot_post: `Say so plainly and send them to ${base}/v1/portal to register themselves. A silent failure leaves them waiting.`,
          },
        },
        note: 'The connectivity-key flow this step used to describe was removed in v1.1.0. There is no key to ask for.',
      },

      ...(anonymousMode ? {
        step_2b_anonymous: {
          note: 'This node has anonymous mode enabled. Ask your user: "I noticed this node supports anonymous access too — would you like to use your GHII identity, or should we connect anonymously?"',
          anonymous_flow: {
            action: `POST ${base}/v1/auth/anonymous`,
            result: 'JWT token for anonymous access. Memory keys are limited to the anonymous.* namespace.',
            available_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
            note: 'Anonymous access is fully functional but scoped. You can read/write anonymous.* memory keys, browse the catalogue, read boards, and use storage.',
          },
        },
      } : {}),

      step_3_authenticate: {
        description: 'Device authorization already handed you a token. This is the OTHER way in: when you hold an agent keypair (from POST /v1/agents), sign a challenge for a JWT.',
        flow: [
          `1. GET ${base}/v1/auth/challenge → receive a challenge nonce`,
          '2. Sign: Ed25519_sign(your_private_key, your_gaii + current_iso_timestamp)',
          `3. POST ${base}/v1/auth/token with { "gaii": "your_gaii", "timestamp": "ISO string", "signature": "base64 signature" }`,
          '4. Receive JWT. Include in all future requests as: Authorization: Bearer <jwt>',
        ],
        token_lifetime: `24 hours. Refresh before expiry via POST ${base}/v1/auth/refresh`,
      },

      step_4_what_now: {
        instruction: 'You are connected. Now help your user with what they want to accomplish. Browse the capability sections below to find the right endpoints. Each section groups related endpoints by purpose.',
      },
    };
}
