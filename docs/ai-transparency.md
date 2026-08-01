# AI transparency on an AIMEAT node

**Audience:** anyone running a node — including us, for `aimeat.io` — and any authority who ever reads
this repository. This is an engineering description of who is on the hook and what the software does
about it. It is not legal advice.

From **2 August 2026**, Article 50 of the EU AI Act asks two things of anyone publishing what a model
wrote: tell a person, and mark it so a machine can tell. This node does both at the platform level,
so every app, agent and self-hosted copy inherits the mechanism. **Running the node does not make you
compliant. It makes the compliant path the default path.**

The live statement for a given node is machine-readable at `GET /v1/ai-transparency` (with a `.md`
mirror). This document explains what is behind it.

---

## 1. What this node does for you

### Two marking layers, deliberately

Picking only one is the expensive mistake, so there are two and they fail independently:

| Layer | What it is | Survives |
|---|---|---|
| **Attached** | the mark travels with the document — an `AI-Disclosure` header, a `<meta name="ai-disclosure">`, an `ai-disclosure` attribute on the document element, schema.org JSON-LD, YAML frontmatter on a markdown face | the record being unreachable |
| **Addressable** | a provenance record at its own URL, joined to the content by a SHA-256 of the exact bytes | the served document being stripped |

### The record

Content generated through the node carries an `aimeat.provenance/v1` document: which model, which
provider, which principal, which node, when, how much a human was involved, which sources, and the
hash of the exact bytes the statement is about. The published JSON Schema is served per version at
`/v1/schemas/ai-provenance/v1.json`.

Four fields are required — `spec`, `level`, `humanInvolvement`, `generatedAt` — so a caller can
always produce a valid record. The field that decides whether a label is owed is `humanInvolvement`,
and only a step where a person **reads the substance and can reject it** raises it above `none`.
Clicking publish is not that step.

It is served on every plane the node serves that content on: the JSON envelope (`meta.provenance`),
HTTP headers, HTML, markdown, and the MCP and WebMCP tool surfaces.

### Detection, with no account

```
GET /v1/provenance/by-hash/{sha256}   # did this node produce these exact bytes?
GET /v1/provenance/{id}               # resolve a record a label pointed at
```

Public, unauthenticated, rate-limited. This is the Code of Practice's detection access point.

**The scope rule matters as much as the endpoint.** These answer for content that is *publicly
readable on this node right now* — visibility follows the content, so a record stops resolving
anonymously the moment the thing it describes stops being public. An empty answer is therefore never
an acquittal. **Absence means unstated, never "a human wrote it".**

**And the hash only helps where the node served you the bytes it hashed.** For a memory record, the
value you receive is the value that was hashed, and the lookup works. For a document the node
re-serialises on the way out — a knowledge-package manifest, for instance — you cannot reconstruct
the hashed bytes from the response, so `by-hash` will not find it and you must use the record id from
the `Link` header instead. This is a real limit, not a bug you should keep retrying.

### The visible label

Where a person reads it, they see the official **EU AI Office icon** plus plain-language text in
English or Finnish, at first exposure, and — on the node's own surfaces — a "How this was made" link
to the record. Whether a label is owed is decided once, on the server, and pre-rendered into the
record; a surface renders it, it never re-decides it.

### For an app builder, one call

```js
const { content, provenance } = await AIMEAT.ai.complete({ prompt });
AIMEAT.ai.disclose(provenance);   // renders the EU icon + label, both themes, both languages
```

The field is `content`. An app that ignores `provenance` keeps working exactly as before.

---

## 2. What it cannot do for you

Read this section before you quote anything from section 1.

- **It does not watermark text.** The node does not sample the tokens; that layer belongs to whoever
  runs the model. What the node does is record how content was made, attributably, and show it.
- **A text mark can be stripped by copying.** Anyone can paste the words somewhere else and the
  in-band mark is gone. The addressable record survives that — which is exactly why both layers
  exist — but nothing here makes text tamper-proof, and we do not pretend otherwise.
- **It marks what it observes or what someone declares.** Content that existed before the node
  started recording carries no record, and will not acquire one: a statement about bytes nobody
  witnessed would be a fabrication. Expect a mixed corpus for as long as your node has history.
- **It does not label what other people publish through you and do not declare.** An agent that says
  nothing is recorded as model-written (that default is deliberate), but a principal that lies to the
  node is recorded as having said what it said, attributed to it.
- **Running it does not make you compliant.** See section 3.

---

## 3. Which hat are you wearing?

Three distinct legal persons commonly touch one piece of content here. Fuller analysis:
[docs/internal/EUAct/04-aimeat-role-analysis.md](internal/EUAct/04-aimeat-role-analysis.md).

**You are a deployer, by default.** You run the systems on your node. Article 50(4) — deepfakes and
text on matters of public interest — lands on the account that publishes, which on a multi-tenant node
is often an owner rather than you. Autonomous publishing (a scheduled agent job that writes and
publishes with nobody reading the substance) is precisely the case the editorial-control carve-out
does *not* cover.

**You become a provider** when you put your own name on a generative system: a published app whose
function is to generate text or images, a masthead that publishes generated articles, or a node
feature you brand as your own. **Plugging in a local model does not change who the deployer is, but it
does move the Art. 50(2) marking duty for the raw generation onto you** — with a hosted model that
duty is the vendor's. See [19-future-proofing.md](internal/EUAct/19-future-proofing.md) §3.

**The model vendor** owns the marking duty for the raw generation when you reach a hosted model. That
is why `generator.upstreamMarks` exists in the record: a downstream provider may rely on an upstream
mark while staying responsible for it.

**The open-source project itself is not an AI system.** Publishing infrastructure code carries no
Article 50 duty. The duty attaches to whoever *runs* a node and *publishes* with it.

---

## 4. Your own supervisor

The AI Act market-surveillance authority follows from where the **operator** is established. There is
no safe default to ship, so the node reports it as unstated rather than guessing.

Ours (Finland) is **Traficom** (Liikenne- ja viestintävirasto). Yours depends on where you are, and
we decline to guess it for you.

This is **not** the data protection authority. Naming that one here would put a false statement into a
compliance artefact, which is why the two live in two different config fields:

```bash
AIMEAT_AI_SUPERVISORY_NAME="Liikenne- ja viestintävirasto Traficom"   # AI Act market surveillance
AIMEAT_AI_SUPERVISORY_URL="https://www.traficom.fi"

AIMEAT_OPERATOR_SUPERVISORY_NAME="Office of the Data Protection Ombudsman"   # GDPR — different regulator
AIMEAT_OPERATOR_SUPERVISORY_URL="https://tietosuoja.fi"
```

**Name the right legal person while you are here.** `AIMEAT_OPERATOR_NAME` appears in the transparency
statement and the privacy pages. If a company runs the node, that company's name and business ID
belong there — a limited company's identifiers are not personal data, and a natural person's home
address in a public compliance artefact is both the wrong legal person and unnecessary personal data.

---

## 5. Configuration

Every knob has a safe public default. All are documented in `.env.example`.

| Variable | Values | What it governs |
|---|---|---|
| `AIMEAT_AI_PROVENANCE` | `true` (default) · `false` | Whether records are minted at all. `false` is a local-dev convenience, **not** a compliance option — a node that generates and publishes owes the marking whether or not it kept a record. |
| `AIMEAT_AI_PROVENANCE_DETAIL` | `full` (default) · `minimal` | What a **public** surface *serves*. It never reduces what is stored, and the owner always sees the whole record. `minimal` serves the four required fields plus the disclosure block — for when a pipeline name or a source list would reveal something commercial. |
| `AIMEAT_AI_LABEL_PUBLIC` | `strict` (default) · `light` · `off` | How eagerly a **visible** label is shown. Presentation only: the record, the headers and the machine planes are unaffected. |

**Minting is maximal, unconditionally.** At the point of generation the node already knows the model,
the provider, the principal, the node id, the timestamp and the content hash, so it always records
them. Never store less; sometimes serve less. That split is what keeps a completeness score
comparable between nodes.

**`strict` deliberately over-labels.** It also labels what Article 50 exempts — content a person held
editorial control over, or a publisher declared not to be of public interest — and the record's
`disclosure.reason` then reads `policy` rather than an article. Under-labelling is the violation;
over-labelling costs an icon.

**`off` is refused on a public node.** A node whose resolved security profile is `public` runs
`strict` regardless and says so in the startup posture warnings. Quieting a compliance mark is a
localhost convenience and the software will not let it leave localhost.

---

## 6. Do not strip the markings

This section exists because of a specific requirement, and saying so is the point.

The EU **Code of Practice on Transparency of AI-generated Content**, Measure 1.2(b), asks a provider
to discourage downstream removal of markings. Because AIMEAT is **MIT-licensed**, we cannot and will
not add a licence term restricting what you do with the code — and the Code accepts **alerting users
in the documentation** instead. **This paragraph is that alert, and it is the reason this file has to
exist.**

So, plainly: if you fork or run this node, **do not remove the marking or labelling code, and do not
configure it away on a public deployment.** The markings are what let a reader find out how something
was made. Stripping them does not make your content compliant; it makes it unattributable.

If you deliberately run without them, say so on your own node. Silence reads as a claim.

---

## 7. If someone reports unlabelled AI content

Anyone can report content that should carry a label and does not. A visible label links to its own
provenance record, and that record id is what to report.

```
POST /v1/flags
{ "targetType": "ai_provenance", "targetId": "<record id>", "reason": "undisclosed_ai" }

POST /v1/flags/{flagId}/appeal      # appeal a decision
```

`targetType` also accepts `app` (`owner/filename`) and `memory` (`gaii::key`). Reports reach the node
operator's moderation queue — the one that already has reviewers, an auto-hide threshold and an
appeal path — and an organism admin for organism content. It is deliberately not a second inbox: a
new address would look like a procedure without being one.

An operator can see the shape of their own node's corpus, including public content that carries no
label, at `GET /v1/admin/ai-transparency-report`. An account can see its own at
`GET /v1/ai-transparency/mine`.

---

## 8. What we do not claim

Discipline for this repository, our marketing and our listings — and worth adopting for yours:

| Do not say | Say instead |
|---|---|
| "AIMEAT is EU AI Act compliant" | "AIMEAT implements the Article 50 transparency mechanisms on the node's own surfaces, and gives builders the primitives to meet their own obligations." |
| "All AI content on AIMEAT is watermarked" | "Content generated through the node carries a machine-readable provenance record and a visible label at first exposure." |
| "We are certified" | "We follow the Code of Practice's layered-marking approach." |
| "Your app is compliant because it runs on AIMEAT" | "Your app inherits the marking and labelling primitives; the deployer duties for what you publish remain yours." |

One trap the Commission states explicitly: **using the EU icons says nothing about being a signatory**
of the Code of Practice, and must never be presented as if it did. `aimeat.io` is **not** a signatory;
`/v1/ai-transparency` reports `code_of_practice.signatory: false`, and it ships as false precisely so
the answer means something if it ever becomes true.

---

## See also

- `GET /v1/ai-transparency` — the live, machine-readable statement for a running node
- [RFC v4.0 Platform §3.6](AIMEAT-RFC-v4.0-Platform-full.md) — the normative description of the record, the planes and the posture
- [`openapi.yaml`](../openapi.yaml) — the canonical API contract
- [docs/internal/EUAct/](internal/EUAct/) — the research, role analysis and design set behind all of this
