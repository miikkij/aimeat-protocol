/**
 * @file src/tool-catalog/definitions/install-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entry for aimeat_admin_install_set: the operator sets up this node from an
 *   install set (install packages, phase 4). The node MCP (src/mcp/admin-install-sets.ts), the
 *   connector (src/cli/connect/mcp/tools/install-sets.ts) and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-admin.ts) all read this description.
 * @structure installSetTools
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.4.0 — 2026-10-04 — aimeat_admin_install_set names `grant_apps` and `landing`.
 *   v1.3.0 — 2026-10-02 — aimeat_package_sale: review (package sale design, phase 5).
 *   v1.2.0 — 2026-10-02 — aimeat_package_sale: offer, claim, catalogue, price, requests and decide;
 *     aimeat_package_claim (package sale design, phase 3).
 *   v1.1.0 — 2026-09-29 — aimeat_package_sale: a selling node's signed sale requests, with no token.
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const installSetTools = [
    {
        name: 'aimeat_admin_install_set',
        description: 'Operator-only. Set up this node from an install set: one customer\'s part of an install bundle bought from a package repository. The set names the bundle (its group id, and the repository node when it comes from one), the owner user everything is installed for, the other users (each with an email, and join "account" to create the account now with the login link on, or "invite" to send an email invitation), the names of the organisms, the config values, whether updates apply by themselves, `grant_apps` (default true: the owner\'s grant for each installed app is recorded for the scopes the app declares, so the apps sign in with no consent screen; the purchase is the approval, a later update that asks for more still asks, and the owner can revoke each one) and `landing` ({ group_id, app }: the app the owner\'s welcome link opens, signed in). The bundle names the packages, the organisms with their workspaces, and the crew agents. Always run action "plan" first: it writes nothing and lists `problems`, such as a required config value the set does not give; ask the person for each one and put it in the set, or a secret in `secrets`, which is never stored. Then "apply". Applying again creates nothing twice, so it is also how a crew agent that waited for a runner is deployed once the owner has connected one. "list" shows what was applied on this node. Needs the exact permission "operator:admin", which no wildcard carries. The same as POST /v1/install-sets/apply and GET /v1/install-sets.',
        caller: 'operator',
        visibility: agentEverywhere,
        // Creates accounts, installs and organisms; applying again creates nothing twice, and it reaches
        // the package repository named in the set.
        annotations: { title: 'Admin: Apply an Install Set', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'operator:admin',
        // On `admin`: Setting this node up from an install set: owner, packages, organisms, users, crew agents.
        surfaces: ['admin'],
        input: {
            action: { type: 'string', required: true, enum: ['plan', 'apply', 'list'], description: 'plan: what the set would make, and every problem, writing nothing. apply: make it. list: the sets applied on this node.' },
            install_set: { type: 'object', description: 'For plan and apply: the install set, a JSON object with spec "aimeat.install-set/1".' },
            secrets: { type: 'object', description: 'For plan and apply: secret config values, { <package group id>: { <component id>: { <field>: value } } }. Never stored in the record.' },
        },
    },
    {
        name: 'aimeat_package_sale',
        description: 'Operator-only, on a selling node (a shop\'s own AIMEAT). Sell a package repository\'s packages with no token: this node signs each request with its own key, and the repository accepts it when its author named this node a seller (aimeat_package_sellers there). action "needs": the questions the package or install bundle asks before the sale (package, component, field, required, secret, schema), so the customer answers them before paying. action "grant": serve a customer node the package; give `node` ({ url, public_key } from the customer node\'s /.well-known/aimeat) for a new node, `updates_until` (ISO date-time) when its monthly updates end, or null to run them again. action "revoke": stop serving it. action "offer": the terms the package\'s author sells it on (grant on payment, on approval or at once; the days of updates included; the renewal; the licence; tax; support), which this node reads with its own key; a sale names their `terms_id`. action "claim": a one-time code (valid 30 days) for a customer node that does not exist yet, which that node redeems with aimeat_package_claim. action "price": put the package on sale on this node at this node\'s own `price` and `renewal`, or change them, `state` on_sale, paused (renewals go on) or ended; this node\'s operator is the seller of record, and buyers buy with aimeat_package_buy. action "review": the operator approves what the version on sale can do (`latest` on action offer: its version and capability list); new sales open only while the repository\'s capability hash is the reviewed one, so a new version that can do more waits for another review, and renewals go on meanwhile. action "catalogue": what this node sells. action "requests": sales waiting for approval; action "decide" approves (the grant is made) or refuses one by `request_id`. The repository\'s answer comes back as it said it, refusals included (NOT_A_SELLER, PEER_KEY_MISMATCH). `repository` is its node id, or { node_id, url, public_key } the first time, which links it once the card of the repository answers with that id and key. A grant with `node` for a customer node that does not answer is made anyway, with `peer_pending` true: the repository registers the node on its first signed request. Needs the exact permission "operator:admin", which no wildcard carries. The same as GET, PUT and DELETE /v1/package-sales/...',
        caller: 'operator',
        visibility: agentEverywhere,
        // Reaches the package repository, and a revoke stops a customer's updates.
        annotations: { title: 'Sell a Package', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
        scope: 'operator:admin',
        // On `admin`: Selling a repository's packages from this node, signed by its own key, and redeeming a
        // package claim code for this node with that key.
        surfaces: ['admin'],
        input: {
            action: { type: 'string', required: true, enum: ['needs', 'grant', 'revoke', 'offer', 'claim', 'catalogue', 'price', 'review', 'requests', 'decide'], description: 'needs: the questions to ask; grant: serve (or change, or end the updates of) a customer node; revoke: stop serving it; offer: the author\'s terms and what the version on sale can do; claim: a one-time code for a node not known yet; catalogue: what this node sells; price: put a package on sale here at this node\'s own price, or change it; review: approve what the version on sale can do, which opens new sales; requests: sales waiting for approval; decide: approve or refuse one.' },
            repository: { type: 'string', description: 'The package repository\'s node id, e.g. "aimeat-finland-002-repository". Not for catalogue, requests or decide.' },
            repository_link: { type: 'object', description: 'The first time only: { url, public_key } of the repository, to link it as a peer of this node.', zod: z.object({ url: z.string(), public_key: z.string() }) },
            group_id: { type: 'string', description: 'The package or install bundle group id on the repository.' },
            node_id: { type: 'string', description: 'For grant and revoke: the customer node.' },
            node: { type: 'object', description: 'For grant: { url, public_key } of a customer node the repository does not know yet.', zod: z.object({ url: z.string(), public_key: z.string() }) },
            updates_until: { type: 'string', description: 'For grant and claim: versions published after this ISO date-time are not served (the monthly updates ended). Omit to keep the grant\'s date.' },
            channel: { type: 'string', enum: ['stable', 'beta'], description: 'For grant and claim: stable (the default) or beta.' },
            note: { type: 'string', description: 'For grant and claim: the order it came from.' },
            terms_id: { type: 'string', description: 'For grant and claim: the author\'s terms the sale was made on (from action offer).' },
            price: { type: 'object', description: 'For price: { amount, currency } in micro-units (1 EUR = 1000000), this node\'s one-time price; null for an offer that grants without money.', zod: z.object({ amount: z.number(), currency: z.string() }).nullable() },
            renewal: { type: 'object', description: 'For price: { amount, currency, period_days }, this node\'s renewal price; null for none.', zod: z.object({ amount: z.number(), currency: z.string(), period_days: z.number() }).nullable() },
            title: { type: 'string', description: 'For price: the name buyers see.' },
            state: { type: 'string', enum: ['on_sale', 'paused', 'ended'], description: 'For price: on_sale, paused (renewals only) or ended.' },
            request_id: { type: 'string', description: 'For decide: the request.' },
            decision: { type: 'string', enum: ['approve', 'refuse'], description: 'For decide.' },
        },
    },
    {
        name: 'aimeat_package_claim',
        description: 'Operator-only, on the node that is to receive a package. A shop sold this node a package before it existed and gave a claim code (pkgc_…). Redeem it here: this node signs the request with its own key, the repository registers this node under that key once its public card answers with it, and grants it the package for the period that was paid for. The code works once and for 30 days. From then on this node takes packages from that repository, also with package exchange switched off. Then pull the package (aimeat_package_pull) and install it. `repository` is its node id, with `repository_link` ({ url, public_key }) the first time. Needs the exact permission "operator:admin", which no wildcard carries. The same as POST /v1/package-claims.',
        caller: 'operator',
        visibility: agentEverywhere,
        annotations: { title: 'Claim a Package', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            repository: { type: 'string', required: true, description: 'The package repository\'s node id.' },
            repository_link: { type: 'object', description: 'The first time only: { url, public_key } of the repository, to link it as a peer of this node.', zod: z.object({ url: z.string(), public_key: z.string() }) },
            group_id: { type: 'string', required: true, description: 'The package or install bundle group id on the repository.' },
            code: { type: 'string', required: true, description: 'The claim code the seller gave (pkgc_…).' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
