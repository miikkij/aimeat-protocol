/**
 * @file glossary.ts
 * @description The AIMEAT vocabulary as ONE registry. AIMEAT's terms are dense and several of them
 *   are near-homophones for each other — GHII/GAII/GEAI differ by one letter and mean three
 *   different principals; memory, record and document are three storage shapes; skill, capability
 *   and offer are three different things an agent can carry. An agent that guesses wrong writes
 *   data under an identity nobody reads back, and nothing errors.
 *
 *   The definitions are editorial and are not derived from code — that is deliberate. A definition
 *   generated from a type or a comment reads as authoritative and is usually wrong, which is worse
 *   than having none. What IS enforced is that there is one copy: the SPA page, the markdown
 *   rendering, the JSON endpoint and the page's JSON-LD all render this array.
 *
 *   Maintenance is the campsite rule, not automation: a new core concept in the protocol gets a
 *   row here in the same commit. No regeneration, nothing to go stale unnoticed.
 *
 * @structure
 *   - GlossaryTerm  — one entry: term, form, example, definition, cross-references
 *   - GLOSSARY      — the registry, grouped by area, alphabetical within an area
 *   - GLOSSARY_AREAS — display order + heading for the areas
 *   - findTerm(t)   — case-insensitive lookup by term or alias
 * @usage
 *   import { GLOSSARY, findTerm } from '../data/glossary.js';
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial: 36 terms across six areas (agent-readability phase 06)
 */

/** The areas a term can belong to, in display order. */
export const GLOSSARY_AREAS = [
  { id: 'identity', title: 'Identity' },
  { id: 'data', title: 'Data' },
  { id: 'economy', title: 'Economy' },
  { id: 'extensibility', title: 'Extensibility' },
  { id: 'action', title: 'Action' },
  { id: 'federation', title: 'Federation' },
] as const;

export type GlossaryArea = typeof GLOSSARY_AREAS[number]['id'];

/** One defined term. */
export interface GlossaryTerm {
  /** The term as it is written in the protocol. */
  term: string;
  area: GlossaryArea;
  /** Other names the same thing goes by, for lookup. */
  aka?: string[];
  /** The literal shape, when the term names a format. */
  form?: string;
  /** A concrete instance of `form`. */
  example?: string;
  /**
   * One to three sentences. Precise enough to act on, short enough to read.
   *
   * Plain text, no markdown: this string is rendered verbatim by the SPA page, so a backticked
   * `term` shows up on screen with the backticks around it. Use `form` and `example` for anything
   * that needs monospace.
   */
  definition: string;
  /** Terms whose definitions a reader of this one usually needs next. */
  seeAlso?: string[];
}

export const GLOSSARY: GlossaryTerm[] = [
  // ── Identity ─────────────────────────────────────────────────────────────────────────────
  {
    term: 'GHII', area: 'identity', aka: ['human identity', 'owner identity'],
    form: 'owner@node-id', example: 'alice@aimeat-fi-001-genesis',
    definition: 'A human user on a node. The GHII owns everything: the data, the files, the morsel balance, the trust score, and every agent connected under it. Any question of "who does this belong to" resolves to a GHII.',
    seeAlso: ['GAII', 'Owner', 'Morsel'],
  },
  {
    term: 'GAII', area: 'identity', aka: ['agent identity'],
    form: 'agent#owner@node-id', example: 'claude#alice@aimeat-fi-001-genesis',
    definition: 'An AI agent acting under a human owner. It has its own token, its own scopes and its own trust score, but no balance of its own — what it spends, its owner pays. Agents are never created implicitly: the owner approves each one and picks its scopes.',
    seeAlso: ['GHII', 'Scope', 'Device authorization'],
  },
  {
    term: 'GEAI', area: 'identity', aka: ['ecosystem app identity'],
    form: 'eco:app#owner@node-id', example: 'eco:drum-news#alice@aimeat-fi-001-genesis',
    definition: 'An external application connected to a node as a principal in its own right, consented like an agent. It writes into its own eco: namespace and is fenced to an approved scope and data-area list. Onboarded by a hello-approve-token handshake with key pinning on first use.',
    seeAlso: ['GAII', 'Scope', 'Namespace'],
  },
  {
    term: 'Owner', area: 'identity',
    form: 'alice',
    definition: 'The bare account name, without a node suffix. It is what appears in an owner session token and what every principal resolves back to for ownership and billing. A bare owner name becomes a GHII by appending the node id.',
    seeAlso: ['GHII'],
  },
  {
    term: 'Node', area: 'identity',
    form: 'aimeat-fi-001-genesis',
    definition: 'One running AIMEAT server and everything stored on it. A node has its own id, its own Ed25519 keypair and its own operator. Identities are node-qualified, which is what lets two nodes tell each other\'s users apart.',
    seeAlso: ['Federation', 'GHII'],
  },
  {
    term: 'Scope', area: 'identity',
    form: 'memory:write', example: 'memory:read, wallet:read, task:write',
    definition: 'One named permission on a token. The owner picks the set at approval time, and every mutating endpoint checks for the scope it needs. A missing scope answers 403 naming the scope, never an empty result — a silent empty answer would read as "no data".',
    seeAlso: ['GAII', 'App grant'],
  },
  {
    term: 'App grant', area: 'identity',
    definition: 'The consent a person gives a hosted app to act inside their own space. The app resolves to the owner but is fenced to the scopes and data areas the grant names, so it can do its job without becoming the owner.',
    seeAlso: ['Scope', 'App'],
  },
  {
    term: 'Device authorization', area: 'identity', aka: ['RFC 8628', 'device flow'],
    definition: 'How an agent gets an identity. The agent asks for a device code, the owner approves it in their portal and selects scopes, and the agent then claims a signed token. The owner is in the loop by construction; there is no key an agent can present to enrol itself.',
    seeAlso: ['GAII', 'Scope'],
  },

  // ── Data ─────────────────────────────────────────────────────────────────────────────────
  {
    term: 'Memory', area: 'data',
    definition: 'The node\'s key-value store: a JSON value under a dotted key, owned by an identity, carrying a visibility, tags and version history. It is where anything an agent needs to remember between sessions goes.',
    seeAlso: ['Namespace', 'Visibility', 'Record'],
  },
  {
    term: 'Namespace', area: 'data',
    form: 'ext:prh', example: 'alice@node-id, ext:prh, eco:drum-news#alice@node-id',
    definition: 'The identity a memory key is stored under. Owner data, extension data and ecosystem-app data live in separate namespaces and are never interchangeable: an extension owns ext:{name} and can read an owner\'s public keys, but the owner\'s settings and translations remain owner data.',
    seeAlso: ['Memory', 'Extension', 'GEAI'],
  },
  {
    term: 'Visibility', area: 'data',
    form: 'private | members | owner | public',
    definition: 'Who may read a stored item. It is enforced at the storage layer rather than at each route, so a new endpoint cannot accidentally widen it. public items are readable without a token.',
    seeAlso: ['Memory', 'Consent'],
  },
  {
    term: 'Organism', area: 'data',
    definition: 'A shared space: a group of people and their agents, the workspaces they work in, and the material inside them. It is the unit of collaboration — membership, access and pooled knowledge are all organism-level.',
    seeAlso: ['Workspace', 'Record', 'Member'],
  },
  {
    term: 'Workspace', area: 'data',
    form: 'ws-mq664uyfz21',
    definition: 'A named area inside an organism holding typed records and documents, each with a draft and a published state. Access is granted per workspace, so one organism can hold both an open handbook and a closed roadmap.',
    seeAlso: ['Organism', 'Record', 'Document'],
  },
  {
    term: 'Record', area: 'data',
    definition: 'A typed, structured item in a workspace — a decision, a feature, a target, a contact. It has a namespace, an id and a schema, which is what lets an agent query for "every open bug" instead of grepping prose.',
    seeAlso: ['Workspace', 'Document'],
  },
  {
    term: 'Document', area: 'data',
    definition: 'A markdown document in a workspace, versioned with the same draft-and-publish cycle as a record. Records carry structure; documents carry the reasoning.',
    seeAlso: ['Record', 'Workspace'],
  },
  {
    term: 'Knowledge package', area: 'data',
    definition: 'A portable bundle of knowledge with a manifest: what it contains, how the parts link, and how to import or export it whole. It is how material moves between organisms and between nodes without being retyped.',
    seeAlso: ['Organism', 'Document'],
  },
  {
    term: 'Consent', area: 'data',
    definition: 'A recorded, revocable permission for a named party to use named data for a named purpose. Every grant is auditable and every revocation takes effect at the access check, which is what makes the data story defensible rather than merely stated.',
    seeAlso: ['Scope', 'Visibility'],
  },
  {
    term: 'Member', area: 'data',
    definition: 'A person who belongs to an organism. Membership is keyed by the bare owner name, so a person is one member regardless of which of their agents is doing the work.',
    seeAlso: ['Organism', 'Owner'],
  },

  // ── Economy ──────────────────────────────────────────────────────────────────────────────
  {
    term: 'Morsel', area: 'economy',
    form: 'integer',
    definition: 'The node\'s usage meter, counted in whole units. It throttles and it rewards; it is not a currency and does not convert to one. There is one balance per human: agent and ecosystem-app balances are always zero, and their spending resolves to their owner.',
    seeAlso: ['GHII', 'Ledger', 'Meter'],
  },
  {
    term: 'Meter', area: 'economy',
    definition: 'The framing the protocol uses for value: things are measured, not priced in a currency the protocol mints. Morsels meter node usage, and money metering records real spend. Payment itself is a pluggable interface, not a protocol requirement.',
    seeAlso: ['Morsel', 'Ledger'],
  },
  {
    term: 'Ledger', area: 'economy',
    definition: 'The record of metered usage — which principal spent what, on which model or capability, when. It is what turns "the agents cost something" into a number somebody can check.',
    seeAlso: ['Meter', 'Morsel'],
  },
  {
    term: 'Offering', area: 'economy', aka: ['offer'],
    definition: 'Something an agent publishes that others can buy: a described capability with a price and terms. A public offering appears in the node\'s commerce feed and in EXCHANGE.',
    seeAlso: ['Capability', 'Checkout', 'EXCHANGE'],
  },
  {
    term: 'Need', area: 'economy',
    definition: 'The mirror of an offering: a stated requirement that providers can bid against. Offerings say what exists; needs say what is missing.',
    seeAlso: ['Offering', 'EXCHANGE'],
  },
  {
    term: 'Checkout', area: 'economy',
    definition: 'The purchase flow: open a session, complete it, receive the result. For a priced tool, completing the checkout IS the invocation — an unpaid call answers 402 with the payment terms attached.',
    seeAlso: ['Offering', 'Meter'],
  },
  {
    term: 'EXCHANGE', area: 'economy',
    definition: 'The marketplace surface where offerings and needs meet across owners: listings, bids, proposals and contracts, with the resulting work delivered through the node.',
    seeAlso: ['Offering', 'Need'],
  },

  // ── Extensibility ────────────────────────────────────────────────────────────────────────
  {
    term: 'App', area: 'extensibility',
    form: 'owner/filename.html', example: 'happydude500001/nuotta.html',
    definition: 'A single-file HTML application published on the node and served on its own origin. The app id is a filename and carries its extension; the subdomain does not, and guessing the id from the subdomain is the most common way a tool lookup misses.',
    seeAlso: ['App grant', 'App origin'],
  },
  {
    term: 'App origin', area: 'extensibility',
    form: '<app>.apps.<node-host>', example: 'nuotta.apps.aimeat.io',
    definition: 'The isolated host a published app is served from. Separating it from the main site means an app cannot reach the session or storage of the page that framed it; what it may touch comes from its app grant instead.',
    seeAlso: ['App', 'App grant'],
  },
  {
    term: 'Extension', area: 'extensibility',
    definition: 'Server-side logic running in a sandbox, with its own ext: namespace and its own outbound fetch. It decides how it stores and returns things; the layers above trust that decision rather than reaching past it.',
    seeAlso: ['Cortex', 'Namespace'],
  },
  {
    term: 'Cortex', area: 'extensibility',
    definition: 'A browser-side library that gives apps a clean interface over an extension: it reads the extension\'s public data, calls its actions, and reads and writes the user\'s own data. An app calls the cortex; it never reaches the extension directly.',
    seeAlso: ['Extension', 'App'],
  },
  {
    term: 'Skill', area: 'extensibility',
    definition: 'A packaged instruction set an agent can load to become competent at something specific, versioned and published on the node. Where a capability is something the node can run, a skill is something an agent learns.',
    seeAlso: ['Capability', 'GAII'],
  },
  {
    term: 'Capability', area: 'extensibility',
    definition: 'A named, invocable unit of work registered on the node, with a declared input and output. It can be priced, vouched for, and called by an agent or through a checkout.',
    seeAlso: ['Skill', 'Offering'],
  },
  {
    term: 'MCP', area: 'extensibility', aka: ['Model Context Protocol'],
    definition: 'The protocol most AI platforms use to reach external tools. The node runs an MCP server, so a platform that speaks MCP gets the node\'s surface as tools without any AIMEAT-specific integration.',
    seeAlso: ['WebMCP', 'Scope'],
  },
  {
    term: 'WebMCP', area: 'extensibility',
    definition: 'The in-page version of the same idea: a published app declares its tools on the page itself, so an agent running in the browser can call them where they are rather than being told they exist.',
    seeAlso: ['MCP', 'App'],
  },

  // ── Action ───────────────────────────────────────────────────────────────────────────────
  {
    term: 'Task', area: 'action',
    definition: 'A unit of work assigned to an agent, with a lifecycle an observer can follow: created, progressed through events and todos, then completed or failed. It is how work becomes visible to the person who asked for it.',
    seeAlso: ['Workflow', 'GAII'],
  },
  {
    term: 'Workflow', area: 'action',
    definition: 'A saved sequence of steps the node runs, with branching and points where it stops to ask a human. It is the difference between an agent that does one thing and a process that runs.',
    seeAlso: ['Task', 'Schedule'],
  },
  {
    term: 'Schedule', area: 'action',
    definition: 'A recurring trigger that starts work without anybody asking — the mechanism behind an agent that reports every morning rather than when prompted.',
    seeAlso: ['Workflow', 'Task'],
  },
  {
    term: 'Fleet', area: 'action',
    definition: 'The set of agents one owner has connected, seen as a group: what each may do, what each is doing, and what it has cost. An owner with a dozen agents manages a fleet, not a dozen integrations.',
    seeAlso: ['GAII', 'Ledger'],
  },

  // ── Federation ───────────────────────────────────────────────────────────────────────────
  {
    term: 'Federation', area: 'federation',
    definition: 'How two nodes recognise each other\'s users and material. Its practical use is cross-node identity: a person on one node can be known and trusted on another without either node holding the other\'s data.',
    seeAlso: ['Peer', 'Node'],
  },
  {
    term: 'Peer', area: 'federation',
    definition: 'Another node this one has approved. Every federated request is verified against the peer\'s Ed25519 signature without exception, so an approved peer is a known key rather than a trusted address.',
    seeAlso: ['Federation', 'Node'],
  },
];

/** Case-insensitive lookup by term or alias. */
export function findTerm(needle: string): GlossaryTerm | undefined {
  const n = needle.trim().toLowerCase();
  return GLOSSARY.find(
    (t) => t.term.toLowerCase() === n || (t.aka ?? []).some((a) => a.toLowerCase() === n),
  );
}

/** The registry grouped by area, in display order, skipping areas with no terms. */
export function glossaryByArea(): Array<{ id: GlossaryArea; title: string; terms: GlossaryTerm[] }> {
  return GLOSSARY_AREAS
    .map((a) => ({ id: a.id, title: a.title, terms: GLOSSARY.filter((t) => t.area === a.id) }))
    .filter((g) => g.terms.length > 0);
}
