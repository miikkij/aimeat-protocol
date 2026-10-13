# AIMEAT Platform reference

**Node version:** 4.0.0, released 2026-10-13. The clusters were checked against the code on 2026-10-12, and the 4.0.0 removals add or remove none of them. The version line follows the node at every release.
**Replaces:** the AIMEAT.IO Platform & Ecosystem Specification v4.0 ([AIMEAT-RFC-v4.0-Platform-full.md](AIMEAT-RFC-v4.0-Platform-full.md)), since node 4.0.0.
**Normative base:** [AIMEAT Core 2026-11](AIMEAT-Core-2026-11.md). Nothing in this note is normative.

## Answer first

The Platform reference is four parts. Three of them exist already and have their own checks; this note is the fourth.

| Part | Answers | Where it lives |
|---|---|---|
| Feature list | What does the node do, and how finished is each part? | [AIMEAT-Feature-List.md](AIMEAT-Feature-List.md), with status markers; it feeds `/v1/everything` |
| API contract | What does each operation take and return? | [openapi.yaml](../openapi.yaml) |
| Tool catalog | Which MCP tools exist, on which surfaces, with which scopes? | the node's tool catalog, served over MCP |
| Architecture note | How is the platform put together on top of Core, and why? | this file |

The v4.0 Platform document went stale in at least ten places in three months, because most of it was a feature inventory written as a specification. The feature list does that job and is kept current. This note keeps only what the feature list cannot say.

## 1. What the platform is

The platform is a node built on Core that adds the product a person uses. A person's own AI does their work through the node, over MCP or with a prompt the person runs in their own chat. The web shows what happened and holds the controls that need a screen. The person owns the data, and every agent and application acts under their consent.

On top of Core the reference node adds six clusters:

| Cluster | What it adds | Core it rests on |
|---|---|---|
| Hosted applications | Single-file apps served on their own origins, reaching the owner's data only through app grants; the served browser libraries | §4.6 app grants, §5 authorization, SEC-06 host-only cookies |
| Agent fleet | Onboarding steps for each kind of agent, tasks, connectors on the owner's machines, crews, stop and start, refusal reporting | §3.3 agents, §4.3 device authorization, §4.5 agent keys, §9.7 tunnels |
| Compute and AI | Sandboxed server-side extensions, cortex, AI routing across providers with roles and fallback, the scheduler, workflows, the decision model | §8.4 usage ledger, §8.5 AI resource, §10 provenance |
| Skills and capabilities | The skill registry, the capability registry with invoke and vouch | §6 records, §5.1 scopes |
| Commerce | The marketplace (offerings, needs, bids, contracts), checkout, seller payouts, invoices, the pacing pack | §8.2 offers, §8.6 payment interface |
| Public presence and outside accounts | Portfolio, company addresses, site layout, mail and social accounts, attached MCP servers as a gateway | §6.3 visibility, §11.4 MCP |

## 2. The shared living surface

A workspace is a place that people, agents and applications read and change at the same time. Change events keep every open copy current (Core DATA-28), so no participant polls and none of them waits for another. An application generated for a purpose takes the place of a purpose-built protocol feature: a tracker, a board or a booking page is an app over workspace records, not a new part of the protocol. That is why Core stays small and the platform grows in applications.

## 3. Three trust boundaries

- **An application runs on its own origin.** A compromised app never reaches the signed-in page, because session cookies are host-only (Core SEC-06) and an app reaches data only through its grant (Core §4.6).
- **Each layer trusts only the one below it.** An extension owns its storage; cortex trusts the extension interface; an app trusts cortex. No layer goes around the one below.
- **Everything the server fetches passes the outbound check** (Core SEC-04), including what an extension asks for and what the headless browser opens.

## 4. What left Core, and where it is described now

These parts of Core v4.0 are not in Core 2026-11, because a second implementation does not need them to work with an AIMEAT node. The reference node still has them.

| Topic | Where it is described |
|---|---|
| Identity assurance: the EU Digital Identity Wallet, verifiable credentials, the Finnish Trust Network | Feature list §2; [EUDIW status](aimeat-eudiw-integration.md), [credential format](aimeat-vc-spec.md). It may return to Core as an optional profile when the wallet path passes its own checks. |
| Knowledge packages and links; the librarian | Feature list §5 and §6 |
| Catalogue, directory, discover and invoke | Feature list §14 and §16 |
| Actions, the work queue, agent tasks, disputes, trust scoring and capability verification | Feature list §7 and §14 |
| Service manifests (CSM and MSM) | Feature list §14; [CSM](csm-spec.md) |
| Observability and statistics | Feature list §19; [observability guide](../aimeat/docs/observability-guide.md) |
| CORS inheritance; moderation appeals | Feature list §19 and §13 |

## 5. What moved from the Platform document into Core

| Platform v4.0 | Core 2026-11 |
|---|---|
| §1.2 App grants | §4.6 |
| §1.3 The host-only cookie rule behind origin isolation | §12 SEC-06 |
| §2 Agent v2 keys, cards and key sets | §4.5, FED-19 |
| §3.3 The metered AI resource (the model, not the provider) | §8.5 |
| §3.6 AI provenance and transparency | §10 |
| §5 Ecosystem application onboarding | §4.4 |
| §8 The payment principles | §8.6 |
| §9 Deprecations | Appendix B |

The rest of the Platform document was inventory, coding advice, screens or product status. Its facts now live in the feature list, the coding guidelines, the skills on the node and the changelog.

## 6. Where to look next

- **What a cluster contains:** the feature list, by section.
- **An exact operation:** `openapi.yaml`, by tag.
- **What an AI can call:** the tool catalog, by surface.
- **Building an agent or an outside application:** the [agent guide](building-an-aimeat-compatible-agent.md) and the [ecosystem application guide](building-an-aimeat-compatible-ecosystem-app.md).
- **Operating one capability:** the skills on the node (`aimeat_skill_list`, `aimeat_skill_get`).
- **Whether the node conforms to Core:** the [conformance evidence](AIMEAT-Core-2026-11-evidence.md).

## 7. How this note stays true

It names no counts, no endpoint paths beyond the feature list's own entry point, no configuration variables, no screens and no release states. Those live in the feature list, `openapi.yaml` and the [configuration reference](b-config.md), which have their own checks. This note is reviewed when a cluster is added or removed, and its version line is updated at every node release.
