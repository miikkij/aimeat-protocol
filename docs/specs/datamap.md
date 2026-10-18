# The data map: `aimeat.datamap/2`

Status: current, checked against the code on 2026-10-18. Every node serves this file at
`GET /v1/specs/datamap.md`.

A data map says what an app is, what it is used for, where its data actually lives, and why there.
It is written for an AI that opens an app it does not know: it reads the map and knows how the
app's data is arranged without reading the source. Without it, a new feature's data goes wherever is
easiest to reach. The second audience is an auditor, whose columns are the retention and the
personal-data marks.

The map's main use is to put what the app is **meant to be** beside where its data **actually is**.
An app meant for a group whose records sit in one person's private memory shows the contradiction
in two lines, without anyone opening the source.

## Where it lives and how it is read and written

- One map per app, stored beside the app as its own record (the memory key `apps.<app id>.datamap`),
  never inside the app's HTML.
- Read: `GET /v1/datamap/apps/{owner}/{filename}`, or the MCP tool `aimeat_datamap_get`. A public
  app's map is readable by anyone; the finding (`gap`) is shown to the owner only.
- Write: `PUT /v1/datamap/apps/{owner}/{filename}` (scope `memory:write`), or `aimeat_datamap_set`.
  The owner and the owner's agents may write it; an app's own grant may not. **A write replaces the
  whole map**: read it first, change what you need, and send all of it back. A body without
  `"spec": "aimeat.datamap/2"` is refused.
- The build specification has the same rules for an AI that builds an app:
  `aimeat_handbook_get { tier: "build-app/data-map" }` or
  `GET /v1/prompts/build-app/sections/data-map`.

## The document

```
{ "spec": "aimeat.datamap/2",
  "what": "...", "usedFor": "...", "form": "group", "arrangement": "...",
  "machinery": [], "leaves": [],
  "held": [ ...one row per key family... ],
  "elsewhere": [],
  "source": "declared", "at": "<ISO 8601>" }
```

### The app level

| Field | Type | What it says |
|---|---|---|
| `spec` | `"aimeat.datamap/2"` | The format. Required. |
| `what` | string | What the app is, in a person's words. One paragraph. |
| `usedFor` | string | What it is used for, and what someone achieves with it. |
| `form` | one of the forms below | What the app is meant to be. |
| `arrangement` | string | Where the data actually is, as prose. |
| `machinery` | list | What the app relies on (values below; an unknown name is kept as written). |
| `leaves` | list of `{ what, to, recallable }` | What the app sends out: `what` it sends, `to` where, and `recallable`, whether it can be recalled. Sent mail cannot. |
| `invites` | `{ does, into }`, optional | The app invites people into organisms, and an invitation can create a new account. `does` lists what it does (values below; an unknown one is kept as written), `into` names which organisms in the app's own words. |
| `held` | list of rows | The key families the app keeps (section below). |
| `elsewhere` | list of `{ what, status, where, controlledBy, deletion }` | What is not ours or not resolved: `status` is `work-in-progress`, `copy-of-anothers-record`, `already-left` or `account-in-a-foreign-system`; `where` names the real one, `controlledBy` who decides about it, `deletion` what deleting our side does. |
| `source` | `"declared"` or `"none"` | Who wrote it. The node writes `declared` for every stated map; `none` means there is no map. |
| `at` | ISO 8601 | When it was written. |

`what` and `usedFor` are the two fields that get dropped, and the two that matter most. With the
per-row `why`, they cannot be derived from the code: whoever built the app writes them once. A
guessed value is worse than a blank, because it sits where the answer belongs and reads like one.
The node never guesses a map: an app that states nothing has a map that says there is none.

**`form`**: `one-person`, `private`, `shared-with-named`, `group`, `organism-workspace`,
`public-service`, `static`, `mixed`, `unstated`. `unstated` is an answer, never a default the node
invents.

**`machinery`**: `iam-and-roles`, `workflows`, `extensions`, `cortex`, `ai-generation`,
`scheduling`, `connections-and-publish`, `payments`, `federation`, `invites-people`.

**An app that invites people says so.** An app whose `<meta name="aimeat-scopes">` asks for
`organism:invite` can invite people into the organisms its user belongs to, and an invitation can
create a new account (an email invitation the person accepts, or an invitation code an organism
owner makes). That is allowed: sometimes it is the app's job. The map states it with the machinery
word `invites-people`, the `invites` statement, or both. **`invites.does`**:
`sends-email-invitations`, `mints-access-codes`, `creates-accounts`, `grants-workspace-access`,
`manages-members`. An app that asks for the scope and states neither has the finding
`DATAMAP_INVITES_UNSTATED`.

### A row: one key family

One row per key family or record type, never one per key: `news.<date>.*`, not 300 rows.

| Field | Required | What it says |
|---|---|---|
| `what` | yes | The key family or record type. |
| `holds` | yes | In the app's own words, one short line: "people and leads". |
| `kind` | yes | What kind of data it is. |
| `usedFor` | yes | What the row is there for. |
| `where` | yes | Where it actually lives. |
| `whereExactly` | no | The address when the location alone is not one: an organism and workspace, a bucket. |
| `owner` | yes | Who owns it. |
| `readers` | yes | Who reads it. |
| `writers` | yes | Who writes it: a list. |
| `shape` | yes | The record's shape. |
| `keptFor` | yes | How long it is kept. |
| `lossRisk` | yes | What losing it would cost. |
| `personalData` | yes | `yes`, `no` or `unstated`. Silence is not a considered "no". |
| `why` | yes | One sentence: why here and not elsewhere. Empty means nobody has said; never invented. |
| `isA` | no | What the records are as a semantic type: `schema:Person`, `aimeat:Task`, or a full IRI. `GET /v1/ns` lists the node's own. A family that is nothing standard leaves it out. |
| `classification` | no | The classification label the app expects for this family by default, such as `luottamuksellinen`. A statement for comparison; it labels nothing. |
| `agent` | no | The local name of one of the owner's agents whose work this row reads. It ties the app to that agent on both pages; it grants nothing. |
| `madeFor` | no | With `agent`: true when the app was built for that agent's work. |

The values, every list open at the point of use (an unknown value is kept as written, not coerced):

| Axis | Values |
|---|---|
| `where` | `nowhere`, `browser-only`, `owner-memory-private`, `owner-memory-public`, `someone-elses-memory`, `organism-workspace`, `organism-rows`, `organism-shared`, `organism-meta`, `extension-namespace`, `cortex`, `file-storage`, `app-published-record`, `another-node`, `external-service` |
| `kind` | `settings`, `user-written`, `ai-generated`, `register`, `event-log`, `index`, `computed-or-cache`, `fetched-copy`, `foreign-identifier`, `snapshot`, `metrics`, `preferences`, `draft`, `outgoing-message`, `file`, `link-between-things`, `permissions`, `secret` |
| `usedFor` | `app-cannot-run-without`, `user-returns-to-read`, `shown-as-a-list`, `search-and-filter`, `calculation-and-reporting`, `app-resumes-where-it-left`, `to-share-with-others`, `to-send-out`, `evidence-of-what-happened`, `speed-only`, `context-for-an-ai`, `backwards-compatibility` |
| `owner` | `person`, `organism`, `extension`, `ecosystem-app`, `someone-else`, `external-controller`, `nobody` |
| `readers` | `owner-only`, `owner-and-their-agents`, `named-people`, `organism-members`, `anyone`, `the-app-itself`, `a-recipient-elsewhere` |
| `writers` | `person-in-the-ui`, `the-app-for-the-person`, `an-agent`, `a-schedule-unattended`, `an-extension-server-side`, `install-seed`, `a-foreign-system` |
| `shape` | `one-record`, `one-per-thing`, `collection-under-one-key`, `rolled-up-per-period`, `index-plus-bodies`, `files`, `no-record` |
| `keptFor` | `until-deleted`, `ttl`, `rolling-window`, `version-capped`, `append-only`, `session-only` |
| `lossRisk` | `only-copy`, `recoverable-from-source`, `recomputable`, `user-can-rewrite`, `may-vanish` |

**A workspace and its row store are different answers.** `organism-rows` is appended to rather than
edited, keeps no version history, and is counted against the organism's quota rather than the
writer's. It is the right home for a stream that keeps coming (received mail, notifications,
measurements). The test: **if `keys_per_day × 365` exceeds 1000, the shape is wrong**, and the rows
belong in the row store.

## What the node does with it

The node never invents a map; it reads the stated one, folds it into one line for a list, and names
what is missing. The findings, worst first: `DATAMAP_MISSING`, `DATAMAP_NO_PURPOSE`,
`DATAMAP_NO_ARRANGEMENT`, `DATAMAP_FORM_UNSTATED`, `DATAMAP_FORM_CONTRADICTED`,
`DATAMAP_ROW_NO_WHY`, `DATAMAP_NO_ROWS`, `DATAMAP_INVITES_UNSTATED`, `DATAMAP_ROW_BAD_AGENT`,
`DATAMAP_ROW_BAD_CLASSIFICATION`. The node reads the app's declared scopes for the invites finding,
and an app with no map that asks for `organism:invite` has it beside `DATAMAP_MISSING`.
A finding never refuses a map. The owner sees it; everyone else reads the map without it.

The app's own list entry carries a summary (`spec`, `form`, `summary`, `heldRows`,
`rowsWithoutWhy`, `missing`, `docKey`, `at`), so a list of apps shows where each one's data is
without reading every map.

## Versions

`/2` replaced `/1` on 2026-08-25: `/1` described key families and their compliance columns and never
said what the app was for. Optional fields added since (`organism-rows`, `classification`, `agent`,
`madeFor`, `invites` and the machinery word `invites-people`) are additive and keep the format at `/2`; a map carries its own `spec` so a newer node can
read an older map.
