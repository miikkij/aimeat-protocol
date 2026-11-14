/**
 * @file src/tool-catalog/definitions/secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret shares on MCP: make a share or a request, list them, read one, fill a request,
 *   pick one up, revoke one. Each tool is the REST route of the same name in routes/secret-shares.ts
 *   and calls the same function in services/secret-shares/, so the maker's terms, the protection rule
 *   and every refusal are decided there.
 *
 *   END-TO-END SHARES ARE MADE AND OPENED IN A BROWSER. The fields an end-to-end share carries
 *   (envelope, e2e_keys, code_salt, code_verifier, size_bytes) are what a person's own browser
 *   computes with its device key, so they are not on these tools: an agent cannot make or open one.
 *
 *   THE DEPOSIT TOKEN IS NOT ON THESE TOOLS. A request's deposit link is for a person who has no
 *   account here; a signed-in depositor is recognised by name, so the MCP tool takes no token.
 *
 *   BEHIND secrets:share, the word the routes ask, and outside every wildcard
 *   (utils/scope-coverage.ts): a share hands content out, so "Full access" does not carry it.
 * @structure SECRET_SHARE_CREATE_FIELDS · SECRET_SHARE_DEPOSIT_FIELDS · SECRET_SHARE_PICKUP_FIELDS ·
 *   secretShareTools — aimeat_secret_share_create · _list · _get · _deposit · _pickup · _revoke
 * @usage imported by tool-catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

/** The body fields of POST /v1/secret-shares that the MCP tools forward (no end-to-end fields). */
export const SECRET_SHARE_CREATE_FIELDS = [
    'kind', 'name', 'note', 'format', 'content', 'content_base64', 'file_name', 'content_type', 'service',
    'recipients', 'organism', 'protection', 'retention', 'max_pickups', 'expires_at', 'depositors', 'request_days',
] as const;
/** The body fields of POST /v1/secret-shares/:id/deposit that the MCP tools forward. */
export const SECRET_SHARE_DEPOSIT_FIELDS = ['format', 'content', 'content_base64', 'file_name', 'content_type', 'service'] as const;
/** The body fields of POST /v1/secret-shares/:id/pickup that the MCP tools forward. */
export const SECRET_SHARE_PICKUP_FIELDS = ['to', 'name', 'host', 'code'] as const;

const SCOPE_NOTE = 'Needs secrets:share, which no wildcard carries: the owner ticks it per agent.';

const shareId = { type: 'string', required: true, description: 'The share\'s id (shr_…), from aimeat_secret_share_list or the answer that made it.' } as const;

/** The secret itself, the same fields on a share and on a deposit. */
const contentFields = {
    format: { type: 'string', enum: ['text', 'pairs', 'file'], description: 'text (the default): a key, a password or a token in `content`. pairs: NAME=value lines, such as an .env file, in `content`. file: a file in `content_base64` with `file_name` and `content_type`.' },
    content: { type: 'string', description: 'The secret as text, for format text or pairs. Up to the node\'s share size (1 MB unless the operator set another).' },
    content_base64: { type: 'string', description: 'The file as standard base64, for format file.' },
    file_name: { type: 'string', description: 'For format file: the file\'s name, such as service-account.json.' },
    content_type: { type: 'string', description: 'For format file: its media type, such as application/json.', zod: z.string().max(INPUT_LIMITS.name) },
    service: { type: 'string', description: 'Optional. The service the key is for, such as openai or elevenlabs. Where the node knows the service, it tests a text key once and records whether it works; the answer\'s `check` says so.', zod: z.string().max(INPUT_LIMITS.name) },
} as const;

export const secretShareTools = [
    {
        name: 'aimeat_secret_share_create',
        description: 'Make a secret share or a secret request in your owner\'s name. A share holds one secret (an API key, a password, NAME=value lines such as an .env file, or a file) that your owner lets others pick up: people with an account on this node, their agents when the share allows agents, the members of an organism, or anyone who has its pickup code. A request (kind "request") is an empty share that another person fills: name them in `depositors`, or give them the `deposit_url`. The maker decides who may pick it up (`recipients`), how long it lasts (`retention`) and what an agent may receive (`protection`); a depositor changes none of these. '
            + 'Protection: "open" lets an agent receive the content. "sealed" (the default) gives the content to a person only; an agent may copy it into its owner\'s vault with aimeat_secret_share_pickup to "vault" and then use it as {{secret:NAME}} in an extension\'s request header, never reading the value. "e2e" opens only in a person\'s own registered browser, so an agent cannot make or open one: your owner makes it on the Vault page. '
            + 'Retention: "once" (the default) ends at the first pickup, "count" at `max_pickups`, "until" at `expires_at`, "keep" when it is revoked. '
            + 'The answer carries `pickup_url`, the page where a person picks the share up, and, ONCE ONLY, `code` (when recipients.code is true) and `deposit_url` (for a request). Tell your owner to pass these on outside the node, for example by phone or in another channel, and keep them out of memory, documents and messages on this node. When your owner wants to share a very sensitive secret, suggest they make the share themselves on the Vault page, so the secret stays out of this chat. '
            + SCOPE_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Make a Secret Share or Request', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'secrets:share',
        surfaces: ['agent', 'admin'],
        input: {
            kind: { type: 'string', enum: ['share', 'request'], description: 'share (the default): you send the secret now. request: an empty share that a depositor fills; it sends no content.' },
            name: { type: 'string', required: true, description: 'What the secret is called, 1 to 128 letters, digits, spaces, dots, underscores or hyphens, such as ELEVENLABS_API_KEY. A vault copy takes this name unless the picker gives another.' },
            note: { type: 'string', description: 'Optional, up to 2000 characters: what it is for. Recipients and depositors read it; it is not shown before sign-in.', zod: z.string().max(2000) },
            ...contentFields,
            recipients: {
                type: 'object',
                description: 'Who may pick it up; at least one of people, organism or code. people: account names or name@node of this node (at most 50). agents: true lets those people\'s agents pick it up too. organism: true lets the members of `organism` pick it up. code: true makes a pickup code that anyone holding it may use. code_login: true asks a code holder to sign in as well. A request without recipients goes to its maker and the maker\'s agents.',
                zod: z.object({
                    people: z.array(z.string().max(INPUT_LIMITS.id)).max(50).optional(),
                    agents: z.boolean().optional(),
                    organism: z.boolean().optional(),
                    code: z.boolean().optional(),
                    code_login: z.boolean().optional(),
                }),
            },
            organism: { type: 'string', description: 'The organism id whose vault the share sits in. Required when recipients.organism is true; your owner must be an active member.', zod: z.string().max(INPUT_LIMITS.id) },
            protection: { type: 'string', enum: ['open', 'sealed', 'e2e'], description: 'open: an agent may receive the content. sealed (the default): an agent never receives the content, but may copy it into its owner\'s vault. e2e: made in a browser only; this tool refuses it without the browser\'s encryption.' },
            retention: { type: 'string', enum: ['once', 'count', 'until', 'keep'], description: 'once (the default): ends at the first pickup. count: ends at max_pickups. until: ends at expires_at. keep: until it is revoked.' },
            max_pickups: { type: 'number', description: 'For retention count: how many pickups, 1 to 1000.', zod: z.number().int().min(1).max(1000) },
            expires_at: { type: 'string', description: 'For retention until: when it ends, an ISO 8601 date and time in the future, at most 365 days away.', zod: z.string().max(64) },
            depositors: { type: 'array', description: 'For a request: the people asked to fill it, as account names or name@node of this node. Anyone with the deposit_url can fill it too.', zod: z.array(z.string().max(INPUT_LIMITS.id)).max(50) },
            request_days: { type: 'number', description: 'For a request: how many days it can be filled, 1 to 90 (default 14). It ends sooner when it is filled.', zod: z.number().int().min(1).max(90) },
        },
    },
    {
        name: 'aimeat_secret_share_list',
        description: 'Every secret share and request that concerns your owner, in four lists: `made` (what they made, with its status and pickups), `for_me` (shares ready for them to pick up), `to_fill` (requests that wait for them to fill, with aimeat_secret_share_deposit), and `organisms` (shares in the organisms they administer). Never content, a pickup code or a deposit address. Each item\'s `you` says what you may do with it: manage (read its events, revoke), pickup, deposit. An item in for_me with you.pickup false is one whose maker did not allow agents: its person picks it up signed in, on its pickup page. '
            + SCOPE_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Secret Shares: What Concerns Me', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:share',
        surfaces: ['agent', 'admin'],
        input: {},
    },
    {
        name: 'aimeat_secret_share_get',
        description: 'One secret share or request by id: its terms (recipients, protection, retention, pickups, status), the result of its key test (`check`), and its events (made, filled, tested, picked up, refused, revoked, ended). The maker and the organism\'s admins see every event; a recipient sees the pickups made in their own name. Never content, a pickup code or a deposit address. NOT_FOUND means the share does not exist or is not your owner\'s to see. '
            + SCOPE_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read a Secret Share', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:share',
        surfaces: ['agent', 'admin'],
        input: { id: shareId },
    },
    {
        name: 'aimeat_secret_share_deposit',
        description: 'Fill a secret request that names your owner as a depositor (aimeat_secret_share_list, `to_fill`). The request\'s maker already set who picks it up, its protection and its retention; you send only the secret, once. A filled request answers NOT_WAITING. An end-to-end request is filled in your owner\'s own browser. When the secret is very sensitive and your owner would rather type it themselves, give them the deposit page, <this node\'s address>/v1/secret-deposit?share=<id>, where they fill it signed in. '
            + SCOPE_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Fill a Secret Request', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'secrets:share',
        surfaces: ['agent', 'admin'],
        input: { id: shareId, ...contentFields },
    },
    {
        name: 'aimeat_secret_share_pickup',
        description: 'Pick up a secret share that your owner, or you, may pick up (aimeat_secret_share_list, `for_me`). Every pickup is counted and can end the share (a share kept "once" ends at its first pickup), so pick it up when the secret is needed. '
            + 'to "reveal" (the default) answers the content: text or pairs in `content.text`, a file in `content.content_base64`. An agent receives content only from an "open" share. '
            + 'to "vault" copies the secret into your owner\'s vault under `name` (default: the share\'s name made into a vault name), with an optional `host` it may be sent to, and answers what was stored, never the value; an extension then uses it as {{secret:NAME}} in a request header. This is how an agent takes a "sealed" share. The vault holds values up to 4096 bytes, so a file or a larger secret is revealed only. '
            + 'An "e2e" share opens only in its person\'s own registered browser; an agent cannot open one. A share given with a pickup code takes `code`; wrong codes are counted, and ten in 15 minutes stop further tries for a while. '
            + 'When the secret is very sensitive and your owner would rather handle it themselves, give them the pickup page (the share\'s pickup_url, or <this node\'s address>/v1/secret-pickup?share=<id>) and tell them where to paste it, for example the service\'s own settings or the Secrets section of their Access page, and leave the pickup to them. '
            + SCOPE_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        // Not idempotent: each call spends one pickup, and the last one ends the share.
        annotations: { title: 'Pick Up a Secret Share', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'secrets:share',
        surfaces: ['agent', 'admin'],
        input: {
            id: shareId,
            to: { type: 'string', enum: ['reveal', 'vault'], description: 'reveal (the default): answer the content (open shares only, for an agent). vault: copy it into your owner\'s vault and answer only what was stored.' },
            name: { type: 'string', description: 'For to vault: the vault name, letters, digits, underscore and hyphen, 1 to 64 characters. This is the NAME in {{secret:NAME}}. Default: the share\'s name made into a vault name.', zod: z.string().max(64) },
            host: { type: 'string', description: 'For to vault, optional: the one host the secret may be sent to, as api.example.com or api.example.com:8443, no https:// and no path.' },
            code: { type: 'string', description: 'The pickup code, when the share was given with one (three words and four digits, such as KARHU-7215-SUMU-VALO; case and spaces do not matter).', zod: z.string().max(INPUT_LIMITS.name) },
        },
    },
    {
        name: 'aimeat_secret_share_revoke',
        description: 'Withdraw a secret share or request that your owner made, or one in an organism they administer. Its content is removed and nobody can pick it up or fill it any more. Copies already picked up stay where they went (a vault, a person\'s own device), so when the secret itself must stop working, tell your owner to change it at the service that issued it. Answers the share with its events. '
            + SCOPE_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Revoke a Secret Share', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'secrets:share',
        surfaces: ['agent', 'admin'],
        input: { id: shareId },
    },
] as const satisfies readonly AimeatToolDefinition[];
