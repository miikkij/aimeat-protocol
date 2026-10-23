# Data classification, the compliance register and the cookie banner

Three optional features an operator turns on when the node's people or the law need them: levels that
decide what an AI may read and what may leave a group, a register of how the node uses AI with the
records of processing beside it, and a cookie consent banner. All three are off on a new node. This page describes them as implemented; it
stands until AIMEAT Core 2026-11 specifies classification as an optional profile of the protocol.

## Data classification

**What it gives.** A record, a file or a workspace row carries a level, and the level decides three
things everywhere the node reads it: whether a person is shown it, whether an AI may read it, and
whether it may leave its group (to another organism, or to another node). A person sees and manages
their levels on the Data Wallet page (`/v1/profile?tab=dataWallet`); an operator sets the node's
policy on the admin Security page (`/v1/admin?tab=security`).

### The switch

`classification.mode` (environment `AIMEAT_CLASSIFICATION`) is `off`, `owner` or `all`:

- `off`: nothing is classified and no check reads anything. This is the default.
- `owner`: each person turns it on for their own content in their policy, and each organism for its
  content. Personal content of a person's agents and apps reads the person's switch.
- `all`: on for everyone.

Only an operator changes it: on the admin Config page, with `PUT /v1/admin/config`, or with
`PUT /v1/classification/switch`. Turning it off, or from `all` down to `owner`, needs the operator in
person: an AI credential is refused (`PERSON_REQUIRED`). Every change writes an audit row.

### Levels

The node ships four levels; a node, an owner or an organism can add labels inside them (with an
audience of roles, groups or people) and detection rules:

| Level | An AI may read it | Reads are audited | May leave its group | Lowering it needs a reason |
|---|---|---|---|---|
| `julkinen` (Public) | yes | no | yes | no |
| `sisainen` (Internal) | yes | no | no | no |
| `luottamuksellinen` (Confidential) | with a warning | yes | no | yes |
| `erittain-luottamuksellinen` (Highly confidential) | with a warning | yes | no | yes |

A level's AI visibility can also be `hidden`; none of the shipped levels uses it. A level can also
refuse an outside model (`externalAi: refused`): an AI still reads its content, but only a model on this
machine. An agent whose model runs elsewhere finds such content absent, an AI call with a model that is
not `local:` is refused (`CLASSIFIED`), and no exception opens it. Only an agent whose runtime report
says `llm: "local"` (`aimeat_agent_runtime_report`) reads it; the node records that claim and cannot
check it. New content gets the policy's default label (Internal).

### Security class packs (TL and NATO)

The operator switches two packs on from the admin Security page, or with `PUT /v1/classification/packs`
(`aimeat_classification` action `pack_set`):

| Pack | Classes, lowest first | Rank |
|---|---|---|
| `tl` (Finnish security classes, laki 906/2019, VNA 1101/2019) | TL IV Käyttö rajoitettu, TL III Luottamuksellinen, TL II Salainen, TL I Erittäin salainen | 40, 50, 60, 70 |
| `nato` | NATO RESTRICTED, NATO CONFIDENTIAL, NATO SECRET, COSMIC TOP SECRET | 45, 55, 65, 75 |

Every class: an AI sees it with a warning and only a model on this machine reads it, every use is
audited, it never leaves its organism, lowering needs a reason, and it is shown to at most the
organism's members. The need to know is the label's reader list (a group of cleared people). A pack's
rules recognise its markings in upper case ("TL III", "ST II", "KÄYTTÖ RAJOITETTU", "NATO SECRET",
"COSMIC TOP SECRET"), never the bare words LUOTTAMUKSELLINEN or SALAINEN. A pack is switched on up to
a class (`upTo`); a marking above it raises content to the highest class that is on. The two highest
classes of each pack need the operator's acknowledgement that this node is not an accredited system
(Katakri, Traficom approval, NATO accreditation), and the compliance report warns for as long as they
are on. Switching a pack off retires its classes with every field kept, so labelled content stays as
protected as it was. Source: `aimeat/src/data/classification-packs.ts`. Policies are kept at three levels, node, owner and organism, and a
lower level can only make the node's policy stricter (`aimeat/src/services/classification/levels.ts`).
Defaults and limits: `aimeat/src/services/classification/defaults.ts`.

### How content gets a level

1. **Detection rules, no model.** The shipped rules raise a record that holds a Finnish personal
   identity code, an API key or a password to Highly confidential, and one that holds an IBAN or an
   email address to Confidential. Rules are keywords or patterns.
2. **A model, only when allowed.** Then, if the policy's AI mode allows it, the current label lets an
   AI read the content, and the daily limits allow, a model judges it: the node's decision model or the
   person's own text model. Personal data is removed before anything leaves the node.

On a write, the rules always run, and the model runs only for the kinds of content the policy names.
On request (`POST /v1/classification/scan`) a few keys are judged at once and larger sets are queued
for the hourly job `core:classification-queue`.

**What an AI may change.** A label a person set is locked. A rule or an AI never lowers a label. The
policy's AI mode decides the rest: `off` refuses, `suggest` (the default) leaves a suggestion for a
person (`POST /v1/classification/label/review`), and `auto` applies a raise at or above the confidence
threshold. An AI that relays the person's own words (`human_said`) counts as the person for a raise; a
lowering still waits for the person.

### The review rule

A person's change to their policy applies at once. An AI's change applies at once only when it makes
the policy stricter. A change that gives anything away waits as a proposal until the person accepts it
in their own session (`POST /v1/classification/policy/review`). The policy keeps its recent history.

### Exceptions

A person can allow one thing the policy refuses: content leaving a group, or being sent to an AI, with a
reason and an optional end date (`POST /v1/classification/exceptions`). An AI cannot make an exception
(`PERSON_REQUIRED`). What an app does under the person's credential that gives something away is
recorded as an exception automatically. Exceptions are withdrawn with
`DELETE /v1/classification/exceptions/{id}`, from the Data Wallet or the admin Security page.

### Audit

Shown, used by an AI, refused, changed and excepted reads are written to the classification audit
(`GET /v1/classification/audit`), kept for the policy's audit retention and pruned by a scheduled job.

### Where it is enforced

One component answers every check (`aimeat/src/services/classification/reader.ts`): show, use for an AI
(refused with `CLASSIFIED`), and leave. An anonymous reader is treated as an AI. Federation exits ask
`aimeat/src/services/classification/egress.ts`. Exports leave records under an organism's
classification behind and list them under `left_out`; the account export includes them
([data ownership](data-ownership.md)).

### For an AI

`aimeat_classification` carries every act as an `action`: read and set a label, review a suggestion,
read and set the policy, the audit, a scan, the explorer, the switch, and exceptions (listing only; an
AI cannot make one). Routes: `/v1/classification/*` in [openapi.yaml](../openapi.yaml).

## The compliance register

**What it gives.** A record of how the node uses AI: use cases, the systems and models behind each,
its purpose, whose data it touches, and a risk class from a questionnaire (prohibited, high, limited,
minimal; an unanswered use case reads unclassified). A report joins the register to what the node
logged about AI use and names the gaps. Beside it, the records of processing below.

## Records of processing and the documents beside them

**What it gives.** The GDPR record of processing activities (art. 30) and what goes with it, kept by
whoever is the controller: the node's own by the operator, an organism's by its creator or an admin,
an app's by its owner. The operator reads all of them; an organism's members read its own.

| Document | What it holds | Scopes |
|---|---|---|
| `registers` | one register each: type (personal, pseudonymised, anonymised, none), purpose, role, legal basis (art. 6, and art. 9(2) for special data), subjects, data categories, data domains, recipients, processors, transfers, retention, the containers it covers, review date | node, organism, app |
| `processors` | the contract, country, transfer basis, HIPAA BAA and ITAR eligibility the operator adds to each processor; the node lists the AI providers whose prompts leave the machine, mail and hosting itself | node |
| `requests` | data subject requests with their one-month deadline; an account export and an erasure log themselves | node, organism, app |
| `breaches` | personal data breaches with the 72-hour clock (GDPR) and the 60-day one (HIPAA) | node, organism, app |
| `dpias` | data protection impact assessments (art. 35) | node, organism, app |
| `frameworks` | answers to GDPR, NIS2, DORA, CRA, EAA, DSA, HIPAA and export-control question sets; an unanswered one reads unclassified, never "does not apply" | node, organism |

**Data domains.** A register names the law its data falls under: health, other special categories,
biometric and genetic, children, criminal, employment, payments, public authority, defence and
security-classified, export-controlled, legal privilege and trade secrets
(`aimeat/src/data/compliance-domains.ts`). Each has a floor label, and writing a register raises the
classification of every workspace, organism or app it names to that floor, never lower; a label a
person set lower waits for them as a suggestion. Health, biometric, defence and export-controlled
data refuse an outside model, and a domain that needs an impact assessment makes a missing one a gap.

**What an app's users see.** An app's data map read (`GET /v1/datamap/apps/{owner}/{filename}`,
`aimeat_datamap_get`) carries `records_of_processing`, each register's title, type, purpose, legal
basis, data and retention, and `privacy_notice`, for the same readers as the map. The App Catalog's
"Where this app puts what" shows them as "Personal data this app keeps".

**Drafts and gaps.** `GET /v1/compliance/draft` hands a filled draft: the node's own registers
(accounts, the sign-in and security log, the consent ledger, the AI usage ledger), an organism's member
register, or an app's register read from its data map. `GET /v1/compliance/gaps` lists what a scope
leaves open, and the operator's report carries every scope's gaps under `processing`.

**Where.** `GET /v1/compliance/catalog`, `GET`/`PUT /v1/compliance/docs/{kind}`, `/draft` and `/gaps`,
with `scope=node|organism|app`, `organism_id`, `app` and `app_owner`. Something acting for a person
needs `compliance:read` or `compliance:write`. An AI uses `aimeat_compliance_register_read` and
`aimeat_compliance_register_write` with the same parts and scope. Not legal advice: the node checks
the documents against its own records and cannot check them against the world.

**Where.** The admin Compliance tab (`/v1/admin?tab=compliance`). Routes, operator only:
`GET /v1/admin/compliance/report`, `GET /v1/admin/compliance/reports`,
`POST /v1/admin/compliance/snapshot`, `GET /v1/admin/compliance/draft`, and
`GET`/`PUT /v1/admin/compliance/usecases` and `/v1/admin/compliance/questionnaire`. They need
`compliance:read` or `compliance:write`. A person reads their own part with
`GET /v1/compliance/report/mine`. An operator's AI uses `aimeat_compliance_report`,
`aimeat_compliance_register_read`, `aimeat_compliance_register_write` and
`aimeat_compliance_snapshot`.

A monthly job stores the previous month's report and tells the operators. The public AI transparency
statement (`GET /v1/ai-transparency`) is separate: see [AI transparency](ai-transparency.md).

## The cookie consent banner

**What it gives.** Visitors to the node's own pages choose which cookie categories they allow, and the
analytics tags a person adds to their pages wait for that choice.

| Setting | Environment | What it does |
|---|---|---|
| `cookies.consent_enabled` | `AIMEAT_COOKIE_CONSENT_ENABLED` | turns the banner on (off by default) |
| `cookies.consent_categories` | `AIMEAT_COOKIE_CONSENT_CATEGORIES` | the categories offered; with `necessary` alone no banner is shown |
| `cookies.consent_policy_url` | `AIMEAT_COOKIE_CONSENT_POLICY_URL` | the privacy notice the banner links to |

All three change live on the admin Config page, group Cookies. The banner is the vendored
vanilla-cookieconsent library with English, Finnish and Spanish texts
(`aimeat/src/middleware/cookie-consent.ts`). `necessary` cannot be turned off. Withdrawing analytics
consent clears the listed cookies and reloads the page. A small mark lets the visitor reopen the
choices. The library keeps the choice in its own cookie. A page outside the node's own HTML can load the
banner from `GET /v1/portal/cookie-consent.js`, which answers 404 while the banner is off.

**Analytics.** A person can add Microsoft Clarity or Google Analytics 4 to their public pages
(`PUT /v1/visibility/settings`, or `aimeat_visibility_settings_set`), where the node allows it
(`AIMEAT_ANALYTICS_TAGS`). With the banner on, the tags wait for consent to `analytics`, and advertising
storage is always denied. With the banner off, the tags load at once and the person is warned. A
browser that sends Global Privacy Control gets no tag at all.
