/**
 * @file mcp/catalog/definitions/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entries for the component-package tools (/v1/packages).
 *
 *   These are NOT the single-file web apps. Until 2026-08-16 the aimeat_app_* tools on both
 *   connector doors pointed at /v1/packages while the same names on the node's MCP meant /v1/apps,
 *   so an agent on a fleet daemon could not reach a single real app: told to list apps it got four
 *   ::system example packages, told to publish an app it created a package with no app address.
 *   Measured on production that day: 50 apps, 4 packages.
 * @structure packagesTools[] -- catalog entries, folded into definitions.ts
 * @usage import { packagesTools } from './packages.js';
 * @version-history
 *   v1.12.0 -- 2026-10-02 -- aimeat_package_offer and aimeat_package_buy (package sale design, phase 3).
 *   v1.11.0 -- 2026-10-02 -- aimeat_package_install names packages:install-code, and the dry run's
 *     `capabilities` and `source` (package sale design, phase 2).
 *   v1.10.0 -- 2026-09-30 -- aimeat_package_compose: `include_skills`, the composer's own skills bound to the apps.
 *   v1.9.0 -- 2026-09-29 -- aimeat_package_sellers: the nodes that sell your packages with no token.
 *   v1.9.0 -- 2026-10-01 -- aimeat_package_config_needs answers anyone for a public package;
 *     aimeat_package_get returns the "what you get" sheet; compose takes `outcome` and `prompts`.
 *   v1.8.0 -- 2026-09-28 -- aimeat_package_config_needs: the questions a shop asks before payment.
 *   v1.7.0 -- 2026-09-28 -- aimeat_package_entitlements: `node`, the packages-only peer registered with a grant.
 *   v1.6.0 -- 2026-09-28 -- aimeat_package_instance_set, aimeat_package_check_updates,
 *     aimeat_package_repository and aimeat_package_entitlements (the package repository).
 *   v1.5.1 -- 2026-09-28 -- aimeat_package_install takes `config` (PACKAGE_CONFIG_PARAM).
 *   v1.5.0 -- 2026-09-28 -- aimeat_package_install takes `mode` (managed | editable);
 *     aimeat_package_instances lists the installed copies and aimeat_package_fork releases a managed one.
 *   v1.4.0 -- 2026-09-25 -- aimeat_package_install_requests: list, read, approve or decline the
 *     owner's package install requests; install and update say that lacking the memory words makes
 *     a request instead of a refusal.
 *   v1.3.1 -- 2026-09-24 -- aimeat_package_install names the two memory words a package that seeds
 *     memory records costs an agent.
 *   v1.3.0 -- 2026-09-05 -- aimeat_package_status_set, because publishing was reachable on no
 *     surface at all; aimeat_package_list gains the parameters the route actually reads (its `query`
 *     was sent as ?q= and the route reads ?search=, so the filter was dropped in silence).
 *   v1.2.0 -- 2026-08-23 -- aimeat_package_install: taking a package into use was reachable over
 *     HTTP and nowhere else, so a conversation could name a package and not install it.
 *   v1.1.0 -- 2026-08-23 -- aimeat_package_publish declared {name, description, content} while
 *     POST /v1/packages requires a `components` array and never reads `content`, so every call the
 *     catalog described was answered 400 INVALID_INPUT. The entry now says what the route takes.
 *   v1.0.0 -- 2026-08-16 -- Split out when the app tools were pointed back at apps.
 */
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

/** What `config` on aimeat_package_install is, on every interface. */
export const PACKAGE_CONFIG_PARAM = 'Each part\'s config, keyed by component id: { "<component id>": { "<field>": value } }. An app part takes the fields its config schema declares; an extension part takes its config fields, and a secret field there is stored encrypted and never shown. Run with dry_run first: the answer lists every part\'s fields and which required ones are still empty, so you can ask your owner for them. A required field left empty refuses the install with CONFIG_REQUIRED naming it.';

export const packagesTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_package_list',
        description: 'List component packages on this node. These are NOT the single-file web apps — for those use aimeat_app_list.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            search: { type: 'string', description: 'Optional search over name, description and tags.' },
            author: { type: 'string', description: 'Only this author\'s packages. Your own name also shows your private ones.' },
            status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Defaults to published.' },
        },
    },
    {
        name: 'aimeat_package_get',
        description: 'Get one component package by its group id.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'Package group identifier.' } },
    },
    {
        name: 'aimeat_package_versions',
        description: "List one component package's version history.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: { group_id: { type: 'string', required: true, description: 'Package group identifier.' } },
    },
    {
        name: 'aimeat_package_delete',
        description: 'Archive one version of a component package.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier.' },
            version: { type: 'string', required: true, description: 'Version to archive.' },
        },
    },
    {
        name: 'aimeat_package_publish',
        description: 'Publish a component package: one or more components (app, extension, cortex, translation) that install together.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Package name. With the author it forms the group id, e.g. "company-brain::alice".' },
            description: { type: 'string', description: 'What the package is for.' },
            category: { type: 'string', description: 'Category for the package gallery.' },
            tags: { type: 'array', description: 'Tags for search.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Who may install it. Defaults to private.' },
            components: {
                type: 'array', required: true,
                description: 'The components, each { id, type: "app"|"extension"|"cortex"|"translation", label?, content, dependencies? }. At least one.',
            },
            manifest: { type: 'object', description: 'Package manifest: object types, schedules, the workspace it provisions.' },
        },
    },
    {
        // Authoring a package by hand meant pasting every app's source, naming its cortexes and
        // getting the dependency order right, which is why the only packages on a node were the ones
        // it seeds itself. The node already knows what each app loads, so the caller names apps.
        name: 'aimeat_package_compose',
        description: 'Make a package out of apps you already published, with the cortexes they load and your own skills bound to them. Names what the installing node must supply itself.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            name: { type: 'string', required: true, description: 'Package name. With your owner name it forms the group id.' },
            apps: { type: 'array', required: true, description: 'Filenames of your own apps, e.g. ["shop.html", "admin.html"]. At least one.' },
            description: { type: 'string', description: 'What the package is for.' },
            category: { type: 'string', description: 'Category for the package gallery.' },
            tags: { type: 'array', description: 'Tags for search.' },
            visibility: { type: 'string', enum: ['private', 'public'], description: 'Who may install it. Defaults to private.' },
            status: { type: 'string', enum: ['draft', 'published', 'archived'], description: 'Defaults to published, so you can install it at once.' },
            include_cortex: { type: 'boolean', description: 'Package the cortexes you installed yourself. Default true. Node-shipped cortexes are never packaged.' },
            include_skills: { type: 'boolean', description: 'Package your own skills bound to these apps, so the installer\'s AI has their operating guides. Default true. Installing publishes each in the installer\'s skills, bound to their copy of the app, and never overwrites a skill of theirs.' },
            allow_expectations: { type: 'boolean', description: 'Compose even when an app calls an extension the package cannot carry, recording it as a requirement instead.' },
            outcome: { type: 'string', description: 'What the package gives a person, in one sentence: the head of its "what you get" sheet. The description stands in when it is missing.' },
            prompts: { type: 'array', description: 'Up to three things a person can ask their AI once it is installed, in their words.' },
        },
    },
    {
        // Publishing was unreachable. A package is created private and, until this tool existed, the
        // only way to move it between draft, published and archived was PATCH
        // /v1/packages/{group}/versions/{version} — a door no MCP or CLI surface carried. So an agent
        // could author a package and then neither see it (the list and get doors read published) nor
        // install it (install refuses anything else).
        name: 'aimeat_package_status_set',
        description: 'Move one package version between draft, published, beta and archived. Only the author may. A beta version is served only to the customer nodes whose entitlement follows the beta channel (aimeat_package_entitlements).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier.' },
            version: { type: 'string', description: 'Which version. Defaults to the latest one.' },
            status: { type: 'string', required: true, enum: ['draft', 'published', 'beta', 'archived'], description: 'The status to set.' },
        },
    },
    {
        // Bringing a package in from another node. Idempotent on purpose, so the same call is both
        // "install that one from over there" and "bring me the newer one": a source that has nothing
        // newer answers applied:false rather than an error.
        name: 'aimeat_package_pull',
        description: 'Bring a package published on another node onto this one, verifying that node\'s signature and every component digest before anything is written.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'The package on the other node, e.g. "signage::alice".' },
            node_id: { type: 'string', description: 'A peer this node knows. Its address and key are read from the peer record.' },
            source_url: { type: 'string', description: 'A node that is not a peer. Operator only, and only with trust:"tofu".' },
            trust: { type: 'string', enum: ['tofu'], description: 'Accept and pin the key that node publishes. Needed only with source_url.' },
            version: { type: 'string', description: 'A specific version. Defaults to the latest one published there.' },
        },
    },
    {
        // Updating a whole installed package in one act. The per-component migration road still
        // exists and is what a component the owner EDITED goes through; this one moves everything
        // that can move safely and names the rest.
        name: 'aimeat_package_update',
        description: 'Update a whole installed package to its latest version. Parts you have edited are left untouched and reported, never overwritten. A new version that writes into your owner\'s memory, when you lack memory:write and memory:write-as-owner, becomes a request your owner approves (status awaiting_owner).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            instance_id: { type: 'string', required: true, description: 'The installed copy, from the instances list.' },
            dry_run: { type: 'boolean', description: 'Report what would change and change nothing.' },
        },
    },
    {
        // Taking a package into use, as opposed to authoring one. It is the step a conversation
        // reaches for by name ("install the company brain"), and until 2026-08-23 it existed on the
        // HTTP route alone, so an agent could list a package and not install it.
        name: 'aimeat_package_install',
        description: 'Install a component package as your own copy. Each component is registered under your identity. With mode "editable" (the default) what you get is yours to edit; with mode "managed" the package owns the code and layout, an update replaces them, and you change only the settings (name, description, access code, parking, search visibility, legal texts) until you fork the install. A package that seeds memory records writes them into your owner\'s memory, which takes the memory:write and memory:write-as-owner permissions; without them the install becomes a request your owner approves (status awaiting_owner, with a request_id), and nothing is installed until then. A package that carries code (an app, an extension, a cortex, a skill) takes packages:install-code in the same way. Run dry_run first: it answers `capabilities` (what each part will be able to do) and `source` (who made it and where it came from), which is what you tell your owner before they approve.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Package group identifier, from aimeat_package_list.' },
            label: { type: 'string', description: 'What to call this copy, e.g. the company it is for.' },
            version: { type: 'string', description: 'A specific version. Defaults to the latest published one.' },
            dry_run: { type: 'boolean', description: 'Report what would be registered and register nothing.' },
            mode: { type: 'string', enum: ['managed', 'editable'], description: '"managed": the package owns the code and layout. "editable" (default): you may edit everything.' },
            config: { type: 'object', description: PACKAGE_CONFIG_PARAM },
        },
    },
    {
        // The installed copies, which update and fork both address by id.
        name: 'aimeat_package_instances',
        description: 'List your owner\'s installed package copies: each one\'s instance_id, package, version, whether it is managed (the package owns the code and layout) or editable, when it was forked, and the names its components were registered under.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', description: 'Only the copies of this package.' },
            status: { type: 'string', enum: ['installed', 'paused', 'removed'], description: 'Only copies in this state.' },
        },
    },
    {
        name: 'aimeat_package_instance_set',
        description: 'Change your owner\'s choices about one installed package copy: its label, and whether the daily update check updates it by itself (auto_update true) or tells your owner that an update is ready (false). Managed installs start with auto_update on, editable ones with it off.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            instance_id: { type: 'string', required: true, description: 'The installed copy, from aimeat_package_instances.' },
            label: { type: 'string', description: 'A new name for this copy.' },
            auto_update: { type: 'boolean', description: 'true: the daily check updates this copy by itself. false: it tells your owner an update is ready.' },
        },
    },
    {
        // The daily core job, for this owner's installs and on demand.
        name: 'aimeat_package_check_updates',
        description: 'Check your owner\'s installed packages against the nodes they came from, now. A newer version is pulled; a copy with auto_update on is updated (parts your owner edited are left alone and reported), and the rest are listed as ready to update with aimeat_package_update. A source whose updates ended (the monthly fee ran out) is reported as updates_ended. The node also runs this daily.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_package_repository',
        description: 'List what a package repository serves this node: its public packages and the private ones this node is entitled to, each with the version its entitlement reaches and when its updates end. The repository must be a peer of this node. Take one with aimeat_package_pull (node_id and group_id), then install it with aimeat_package_install, usually with mode "managed".',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            node_id: { type: 'string', required: true, description: 'The repository node, a peer of this node.' },
        },
    },
    {
        // The repository side. Phase 5 (purchase) will write these; until then the author grants them.
        name: 'aimeat_package_entitlements',
        description: 'On a package repository: list, grant or revoke which customer nodes a private package of yours is served to. A grant with updates_until serves the node every version published up to that instant and nothing newer (the monthly updates ended); without it the updates run on. The node must be a peer of this one, or be registered with the grant by giving `node` (its address and the public key its /.well-known/aimeat publishes), and this node must be in the repository role (repository_role in the answer) for the grant to take effect. A node given with `node` is registered only when its own card answers with the same node id and key (PEER_ID_MISMATCH or PEER_KEY_MISMATCH otherwise, and nothing is granted). When the node does not answer, the grant is made anyway and `peer_pending` is true: the node is registered on its first signed request to this repository. A grant to an install bundle serves the packages the bundle lists as well.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'Your package group identifier.' },
            action: { type: 'string', required: true, enum: ['list', 'grant', 'revoke'], description: 'list the nodes, grant (or change) one, or revoke one.' },
            node_id: { type: 'string', description: 'For grant and revoke: the customer node.' },
            updates_until: { type: 'string', description: 'For grant: versions published after this ISO date-time are not served to the node. Omit for updates that run on.' },
            channel: { type: 'string', enum: ['stable', 'beta'], description: 'For grant: stable serves published versions (the default); beta serves versions set to beta too, whichever is newest.' },
            node: { type: 'object', description: 'For grant: { url, public_key } of a node this repository does not know yet. It is registered with the grant as a packages-only peer (active, contact tier, messages off), which can pull only what it is entitled to. A peer of that id under another key, or switched off, is refused.' },
            note: { type: 'string', description: 'For grant: why, e.g. the order it came from.' },
        },
    },
    {
        // The author's one decision that lets a shop's node sell with no token.
        name: 'aimeat_package_sellers',
        description: 'On a package repository: list, add or remove the nodes that sell your packages. A seller node (a shop\'s own AIMEAT, e.g. store.aimeat.io) then asks for a package\'s questions, grants a customer node, ends its updates and revokes it by requests signed with its own node key, with no token and no copied secret. A seller sells every package of yours and nothing of anyone else\'s. To add a node this repository does not know yet, give `node` ({ url, public_key }; the key is on its /.well-known/aimeat): it is registered as a packages-only peer once its card answers with the same node id and key, and refused with PEER_UNREACHABLE when it does not answer (try again when it is up). Only an author with a package on this repository, on a node in the repository role, names sellers (NOT_AN_AUTHOR, NOT_A_REPOSITORY). Removing a seller leaves the grants it made; revoke those with aimeat_package_entitlements. The same as GET, PUT and DELETE /v1/package-sellers.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action: { type: 'string', required: true, enum: ['list', 'add', 'remove'], description: 'list your sellers, add (or change) one, or remove one.' },
            node_id: { type: 'string', description: 'For add and remove: the seller node, e.g. "aimeat-finland-003-store".' },
            node: { type: 'object', description: 'For add: { url, public_key } of a node this repository does not know yet.' },
            note: { type: 'string', description: 'For add: why, e.g. "the shop".' },
        },
    },
    {
        // What a shop asks before payment, before the customer's node exists.
        name: 'aimeat_package_config_needs',
        description: 'The settings a package of yours, or every package of an install bundle of yours, needs the customer to give before it works: the questions to ask before a sale. Each question names its package, component and field, whether it is required, whether it is secret, and for an app field its JSON Schema (type, title, description, enum). A field the bundle already fills is not asked; its value is in `defaults`. Put the answers in the install set: `config.<package>.<component>.<field>`, and a secret in the secrets file with the same path, never in the set. A listed package this node does not hold is named in `problems`. For the author or an operator, and for anyone on this node when the package is public, so an installer answers the questions before installing. The same as GET /v1/packages/:groupId/config-needs.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'The package or install bundle group id, e.g. "yrittajan-peruspaketti::happyadmin500001".' },
        },
    },
    {
        // Releasing a managed install. It is the one act that lets the owner change code the
        // package owns, and it costs the package's updates, so the description says both.
        name: 'aimeat_package_fork',
        description: 'Fork a managed package install: it becomes your own editable copy in place, keeping every address, every record and every schedule, and it receives no further updates from its package. Use it when your owner wants to change the code or layout of a managed install. It cannot be undone; to get the package\'s updates again, install the package again beside it.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            instance_id: { type: 'string', required: true, description: 'The managed copy, from aimeat_package_instances.' },
        },
    },
    {
        // An install, update or migration that needed words its caller lacked became a request; this
        // is how one is read and answered from a chat. The owner in person answers on the
        // notification; an agent of theirs answers here, and only for a request it did not file.
        name: 'aimeat_package_install_requests',
        description: 'List your owner\'s package install requests, read one, or approve or decline one. You may approve a request only when you did not file it yourself and you hold packages:write, memory:write and memory:write-as-owner; otherwise your owner approves it on their Notifications page. You may decline any request you did not file.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            request_id: { type: 'string', description: 'One request. Omit to list them all.' },
            decision: { type: 'string', enum: ['approve', 'decline'], description: 'Decide the request named by request_id.' },
        },
    },
    {
        name: 'aimeat_package_offer',
        description: 'On a package repository, for a package\'s author: the terms seller nodes sell it on. action "get" reads the offer; "set" appends new terms, changes the state, or both. Terms: `grant` "payment" (with `price` { amount, currency }, EUR or USD in micro-units, 1 EUR = 1000000), "approval" (the seller approves each request, no money) or "automatic" (granted at once, no money); `updates` { included_days, renewal: { amount, currency, period_days } or null }; `channel` stable or beta; `licence` { spdx, terms_url, text_sha256 }; `tax` { prices_include_tax, category }; `support` { email, security_email }, and a paid offer must name security_email. A price change is new terms: a buyer keeps the terms they accepted, so a new price reaches only new sales, and a new package version changes no price. `state` on_sale, paused (no new sales, renewals go on) or ended. Only a private package has an offer. Name your sellers with aimeat_package_sellers. The same as GET and PUT /v1/packages/:groupId/offer.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            group_id: { type: 'string', required: true, description: 'The package group id on this repository.' },
            action: { type: 'string', required: true, enum: ['get', 'set'], description: 'get: the offer as it stands; set: new terms, a new state, or both.' },
            terms: { type: 'object', description: 'For set: { grant, price, updates: { included_days, renewal }, channel, licence, tax, support }. Appended; buyers keep the terms they accepted.' },
            state: { type: 'string', enum: ['on_sale', 'paused', 'ended'], description: 'For set: on_sale, paused (renewals only) or ended.' },
        },
    },
    {
        name: 'aimeat_package_buy',
        description: 'Buy a package this node sells, for your owner. This node reads the author\'s terms from the package repository for you; you never need an account there. action "offer": what you would get and at what price (this node\'s price, the renewal price and period, how many days of updates come with it, the licence, how tax is to be read, the support and security contacts, the author and the seller of record). Tell your owner before buying. action "checkout": open the checkout; give `node` ({ node_id, url, public_key } from the receiving AIMEAT\'s /.well-known/aimeat) to have it granted at once, or leave it out to get a claim code the receiving node redeems with aimeat_package_claim; `auto_renew` true keeps the card for automatic renewals. action "renew": open the checkout of the next update period for `node_id`, at the renewal price your owner accepted. Then pay with aimeat_checkout_complete; the sale is carried out when it is paid, and a failure there refunds it. An offer granted on approval waits for the seller instead. action "subscriptions": what your owner holds here, and the requests they made. action "auto_renew": turn automatic renewal on or off for `node_id`. The same as GET /v1/package-sales/offer, POST /v1/commerce/checkout-sessions with a package line, and GET and PUT /v1/package-sales/subscriptions.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            action: { type: 'string', required: true, enum: ['offer', 'checkout', 'renew', 'subscriptions', 'auto_renew'], description: 'offer: what you would buy and at what price; checkout: open the checkout; renew: open the checkout of the next update period; subscriptions: what you hold and the requests you made; auto_renew: turn automatic renewal on or off.' },
            repository: { type: 'string', description: 'The package repository\'s node id.' },
            group_id: { type: 'string', description: 'The package group id on the repository.' },
            node: { type: 'object', description: 'For checkout: { node_id, url, public_key } of the AIMEAT that is to receive the package. Leave out to get a claim code instead.' },
            node_id: { type: 'string', description: 'For renew and auto_renew: the node the package was bought for.' },
            auto_renew: { type: 'boolean', description: 'For checkout: keep the card for automatic renewals. For auto_renew: on or off.' },
        },
    },
];
