/**
 * @file sdk-webhook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-webhook.js, an app's call to an outside URL through the
 *   node's living-hooks extension. Its own file because library-packs/sdk.ts is at the line ceiling;
 *   placed in SDK_PACKS before aimeat-onto.
 * @structure WEBHOOK_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { LibraryPack } from './types.js';

export const WEBHOOK_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-webhook',
    kind: 'sdk',
    category: 'core',
    title: 'Webhooks (send to an outside URL)',
    description: 'POST a JSON payload to an outside URL the person allows, or read one, through the node, with a key named rather than held',
    url: '/v1/libs/aimeat-webhook.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-webhook.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.webhook',
    aiDoc: 'The browser never calls a third-party URL itself: AIMEAT.webhook sends through the node, as the signed-in person, and the node calls out only to hosts that person allows. SEND: const r = await AIMEAT.webhook.send({ url: "https://hooks.example.com/in", method: "POST", body: { ... }, headers: { Authorization: "Bearer {{secret:EXAMPLE_TOKEN}}" } }). It NEVER throws: the answer is `{ ok: true, status, ms }`, or `{ refusal: { code, message } }`; show AIMEAT.webhook.words(r.refusal) to the person. READ: AIMEAT.webhook.read({ url, path: "items[0].price" }) or { raw: true }. KEYS ARE NAMED, NEVER HELD: write `{{secret:NAME}}` in a header value and the node fills it from the signed-in person vault on the way out; tell the person the NAME to store on their Access page (section 04 Secrets), never draw a field for the key. THE ALLOWLIST: a host the person has not allowed is refused as ALLOWLIST_REFUSED with a sentence naming it. AIMEAT.webhook.hosts() lists the allowed hosts; AIMEAT.webhook.allowHost("api.example.com") adds one (a leading dot, ".example.com", allows every subdomain) and must be called ONLY from a control the person presses, because every app and agent of this person may then send there. Limits are the node: a JSON body up to 256 kB, 60 sends a minute, headers Authorization, Content-Type, Accept, X-Api-Key, X-Requested-With and X-Living-* only. Scopes: memory:write to send and to change the allowlist, memory:read to read.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['webhook', 'post to', 'send to url', 'forward', 'integration', 'zapier', 'make.com', 'callback url', 'push data'],
    sizeEstimate: '~5KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'core',
    promptLine: '- aimeat-webhook.js — send a JSON payload to an outside URL the person allows, with a key named not held (`AIMEAT.webhook`)',
  },
];
