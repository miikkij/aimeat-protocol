# Sealed configuration: settings the node's host sets and its operator cannot move

**Created:** 2026-08-18
**Status:** Built. `src/services/config-sealing.ts` holds the rule; 24 tests across
`test/unit/config-sealing.test.ts` (10) and `test/e2e-sealed-config.ts` (14, on both backends).
**Applies to:** any node one party runs on behalf of another

## The problem

A node has exactly one authority over its settings: whoever holds the `operator` role. That is the
right answer when the person who runs the machine and the person who operates the node are the same
person, which is every self-hosted node.

It is the wrong answer whenever they are not. A hosting provider, a university running one node per
department, a company running one per team: in all three the node is started by one party and
operated by another, and there is a set of settings the second party must be able to READ and must
not be able to CHANGE. Resource quotas. Rate limits. Whether metrics are collected. How far a
federated request may relay.

Today there is no way to express that, and the failure is not a gap but an active one. Three
findings, all verified against the code on 2026-08-18:

1. **The database beats the environment at every boot.** `applyConfigOverrides()`
   ([config.ts:737](../../aimeat/src/config.ts#L737)) runs after storage initialises and writes
   DB-persisted values over whatever the environment set. It skips one class only: fields marked
   `immutable: true`.
2. **Every field of the kind above is `immutable: false`.** `quota.memory_mb`, `quota.storage_mb`,
   `quota.micro_memory_kb`, all thirteen of `rate_limits.*`, `metrics.enabled`, `metrics.access`,
   the eight `extensions.*` fields, `federation.max_relay_hops`
   ([config-schema.ts](../../aimeat/src/services/config-schema.ts)).
3. **`PUT /v1/admin/config` needs only `requireRole('operator')`**, persists what it applies, and
   `applyConfigOverrides()` re-applies it at the next boot. So the change survives a restart and an
   image swap.

The end of that path: the operator of a node raises the ceilings the node's host set, permanently,
from the admin UI the host gave them, and turns off the metrics the host uses to see it happen.

Marking those fields `immutable: true` is not the fix. On an ordinary self-hosted node the operator
legitimately owns every one of them, and taking them away there would be a breaking change to solve
a problem that node does not have.

## What the capability has to do

A set of dot-paths nominated by the node's HOST must be:

- readable by the operator, with the value shown, so they can see what their limits are;
- refused to the operator on every write door;
- ignored when anything persisted inside the node tries to set them;
- nominated from outside the node's own data, so compromising the node cannot un-nominate them;
- labelled in the admin surface, so the refusal explains itself rather than reading as a bug.

And, for every node that does not use it, byte-identical behaviour to today.

## Two mechanisms

**A new `fleet-owner` role above `operator`.** Sealed paths require it; the operator does not hold
it. Against: it adds a principal type, an authentication path and a credential that has to reach
every node. `docs/coding-guidelines/identity-model.md` has three principal types and each one costs
a chapter of the security model. A fourth is a large price for a boundary that already exists.

**A sealed-config layer keyed to the boot environment.** A list of dot-paths is read from the
environment at boot; those paths become read-only for everything, for the life of the process. No
new role, no new credential, nothing to authenticate.

**Decision: the second.** The trust boundary it encodes is the one the deployment already has.
Whoever starts the process decides; nothing inside the process can argue, because the decision was
never stored anywhere the process can write. It is also unescalatable by construction rather than by
a check somebody has to remember: there is no door to it, sealed or otherwise.

The security cost of the two is not close. Option A adds an actor to the model and every invariant
in `security-development-dna.md` then applies to it. Option B adds a predicate.

## Design

### The nomination

```
AIMEAT_SEALED_CONFIG_KEYS=quota.memory_mb,quota.storage_mb,rate_limits.global,metrics.enabled
```

Read at boot into `config.sealedConfigKeys: string[]`. It gets a `CONFIG_FIELDS` row at dot-path
`node.sealed_config_keys` with `immutable: true`, which does three things at once: it satisfies
`check:config-coverage` (every `AIMEAT_*` variable read in `src/config*.ts` owes a row), it makes
`applyConfigOverrides()` skip it through the existing `isImmutable()` path so the list cannot seal or
unseal itself from the database, and it puts the list on the admin Config tab where the operator can
read which of their settings are sealed and which are theirs.

Only the NAMES come from this variable. The VALUES come from the ordinary `AIMEAT_*` variables they
already have, which is the plumbing the host is already using. A seal says "this path holds what boot
decided", and boot decides from env, file and CLI as it always has.

**An unknown path refuses the boot.** If the list names something that is not a dot-path in
`CONFIG_FIELDS`, the process exits with a message naming the offender. The alternative is a node that
boots looking sealed and is not, which is a revenue leak and a security hole that nothing reports. A
deploy-time failure is loud, cheap and lands in front of the party that made the typo. A path that is
already `immutable: true` is a redundant no-op and only warns.

### One rule, one home

`src/services/config-sealing.ts`:

```typescript
export interface SealedConfig { sealedConfigKeys: string[] }
export function sealedKeysFromEnv(raw: string | undefined): string[]   // parses AND validates
export function isSealed(config: SealedConfig, dotPath: string): boolean
export function hasSealedKeys(config: SealedConfig): boolean
export function sealRefusal(dotPath: string): { code: string; message: string }
export function sealedView(config: SealedConfig): Array<{ path; value; description }>
```

No door re-implements the predicate and no door writes its own refusal sentence.

The config FIELD lives here too rather than in `config-types.ts`, which was six lines from the
800-line ceiling: the same reason `config-security.ts` exists. Taking `SealedConfig` rather than the
whole `AimeatConfig` means nothing here imports the config types, so the rule and the object it
reads are not circular. `applyConfigOverrides` moved to `src/config-overrides.ts` by pure extraction
for the same ceiling, re-exported from `config.ts` so no importer changed.

`isSealed` reads `config.sealedConfigKeys` with no optional chain, deliberately. A config that
silently has no seal list is the exact failure the mechanism exists to prevent, so it throws rather
than quietly disabling sealing everywhere. One existing unit fixture (`consul-config.test.ts`) had
to gain the field; that is the third of the three cases in `pitfalls.md` §19, a setup that no longer
matched production.

### Where the seal bites

Six writers reach a config value. The spec this work came from named three of them; the other three
were found by grepping for who calls `setConfigValue` and who assigns into `config` dynamically.
There are exactly three dynamic assignment sites in the tree, and all three are below.

| Site | Change |
|---|---|
| `config.ts` → `applyConfigOverrides()` | A DB row for a sealed path goes to `skipped` and is logged by name. This is the regression that started the whole thing. |
| `services/consul-config.ts` → `applyConsulValues()` | A sealed path goes to `skipped`. One edit covers three callers: the boot-time Consul load, the LIVE WATCH LOOP that re-applies on every KV change, and `POST /v1/admin/consul/import`. The watch loop was in nobody's list and is the only one of the three that fires without anyone asking. |
| `routes/admin-config.ts` → `PUT /v1/admin/config` | 403 `SEALED_CONFIG`. |
| `routes/admin-config.ts` → `DELETE /v1/admin/config/:path` | 403 `SEALED_CONFIG`. Removing a DB override is a way to move a value, so it is a write. |
| `routes/admin-config.ts` → `POST /v1/admin/consul/export` | A sealed path is not pushed. It would land in the KV store looking editable, be edited, and be silently discarded on the next import. |
| `cli/config-import.ts` | Sealed paths get their own reported bucket and are not written. The DB write would be inert anyway, but telling someone you imported a value you will ignore is its own defect. |

`hooks.*` (`routes/admin-maintenance.ts`) also writes through `setConfigValue`, into a key space that
is not a `CONFIG_FIELDS` dot-path. It is outside this mechanism and stays there.

### Refuse before you write

Invariant 14 read strictly. `PUT /v1/admin/config` currently applies what it can and reports the rest
in an `errors` array with a 200. A sealed path does not join that array: the handler scans every
`path` in `changes` FIRST, and if any of them is sealed the whole request is refused 403 with nothing
applied. Partial application across a security boundary means "we applied three of your four
changes", and the operator then has to work out which. The refusal is the answer to the request, not
a footnote inside a success.

### The refusal has to explain itself

The person reading it is a customer looking at their own admin UI.

```json
{ "ok": false,
  "error": {
    "code": "SEALED_CONFIG",
    "message": "quota.memory_mb is set by whoever runs this node and cannot be changed here. The value is shown so you can see what it is."
  },
  "hints": { "next_actions": [{ "description": "Ask whoever runs this node to change it." }] }
}
```

`SEALED_CONFIG` gets an entry in `NEXT_STEP_BY_CODE`
([message-audience.ts](../../aimeat/src/middleware/message-audience.ts)) so the envelope carries
somewhere to go, which is what `check:plain-language` gates.

### The value stays visible

`GET /v1/admin/config` reports a sealed field as `sealed: true`, `mutable: false`, `editable: false`,
`canReset: false`, `source: 'sealed'`. The value itself is unchanged and present.

`source: 'sealed'` replaces the provenance value rather than sitting beside it, because for a sealed
field the operative answer to "where did this come from" is the seal, not whether the host happened
to pass it as env or file. The admin tab keys its badge off `source`, so it gets a visibly different
badge from one new line in `SOURCE_BADGE`, and it already renders `mutable: false` as read-only.

### Three doors, one answer

`aimeat_admin_config` exists on all three surfaces. It is read-only on all three, so there is no MCP
write to refuse. What the MCP surface owes is the seal on read.

- The **connector MCP tool** and the **CLI dispatch entry** both proxy `GET /v1/admin/config`
  verbatim. They inherit the seal with no code change.
- The **node MCP tool** builds its own flat payload straight from `config`, which is why it needs
  work: it shows twelve fields and none of the sealed classes. It gains a `sealed` block from
  `sealedView(config)`, so a sealed path and its value are reachable from chat. Its catalog
  description is updated to say so.

## Tests

The brief listed eight. One of them does not survive contact with the code as written, and the list
was missing three doors.

**`test/e2e-sealed-config.ts`** (14 assertions), registered in `test/run-e2e-ci.ts`. Sealed
behaviour needs a server booted with the variable set, so the suite spawns its own, the way
`e2e-app-origin.ts` and three others do. Unlike those four it follows the runner's backend from the
pinned `AIMEAT_STORAGE`, so the both-backends gate is met rather than nominally met. It boots twice
against the same database: once unsealed, once sealed, so the only difference between the two halves
is the seal.

1. **Unset changes nothing.** No field carries `sealed`, `quota.memory_mb` is still `mutable` and
   `editable` with its real provenance, and the operator's `PUT` still applies.
2. **The regression.** The value phase 1 persisted is ignored at boot and the environment value
   stands. Without the rule this reads `expected 1024, got 4096 (the persisted 4096 came back)`.
3. **The value is visible and marked**, on all three sealed fields: `sealed`, `mutable: false`,
   `editable: false`, `source: 'sealed'`, `canReset: false`, value present.
4. **`PUT` → 403 `SEALED_CONFIG` for every sealed setting**, message naming the path and saying who
   set it. The denial case `check:denial-coverage` looks for.
5. **The refusal leaves somewhere to go** (`next_actions` points at the host).
6. **A mixed `PUT` applies nothing**, not the half that was allowed.
7. **`DELETE /v1/admin/config/:path` → 403 `SEALED_CONFIG`.**
8. **A non-sealed path still applies.** The seal is a list, not a switch.
9. **The seal list cannot be edited from inside the node**, and it is the older immutability rule
   that refuses it, which is what makes the mechanism unescalatable.
10. **The node MCP read door reports the same seal, with values.** (Replaces the brief's "the MCP
    tool refuses identically": `aimeat_admin_config` is read-only on all three surfaces, so there is
    no MCP write door to refuse. The connector tool and the CLI dispatch entry proxy the REST door
    and inherit it.)

**`test/unit/config-sealing.test.ts`** (10 assertions) for what needs no running node:

11. **An unknown sealed path refuses the boot**, and the seal list and already-immutable paths are
    dropped rather than refused.
12. **Consul does not move a sealed value.** On `applyConsulValues`, the single function behind the
    boot load, the watch loop and the import route.
13. **`aimeat config import` does not write a sealed path.**

Every assertion that states the rule was confirmed to fail without it: 4 of 10 unit and 7 of 14 E2E,
with the rest asserting the unsealed path and the message shape, which hold either way.

## What else the change owes

- `openapi.yaml` in the same commit as the route, then `pnpm generate:types`: the `sealed` field on
  the GET response and the 403 `SEALED_CONFIG` on PUT and DELETE.
- `.env.example`: `AIMEAT_SEALED_CONFIG_KEYS` with an empty default, which is the safe value both
  locally and publicly.
- `locales/en.json` for the badge and the explanation line, then `fi` and `es` through
  `locale:extract` / `locale:merge`.
- The admin Config tab, verified by driving a real browser.
- `docs/coding-guidelines/environment-configs.md`: the section on running nodes for other people.
- File headers on every file touched.

## Verified

- Guard tier, both backends: 411/411 (`sqlite`, `postgres-kysely`).
- `e2e-sealed-config` through the runner: 14/14 on both backends.
- Full unit suite: 2687/2687. Every pre-commit and audit gate green, `check:config-coverage`,
  `check:route-scopes` and `check:denial-coverage` among them.
- The admin Config tab driven in a real browser against a node booted with three settings sealed:
  the sealed row shows its value, a `SEALED` badge and "(set by whoever runs this for you)" with no
  input and no Reset, beside an unsealed row that has both; the banner reads at 390x844, 1280x900
  and 1280x460 with 0 horizontal overflow at each; 0 repaints of the config content over 20 seconds
  of concurrent writes on the same account; 0 requests over 60 idle seconds; 0 console errors.

## Open, for the developer

- **`changelog.json`.** This is platform-level and would qualify, and changelog entries are on the
  ask-first list.
- **The RFC.** `AIMEAT-RFC-v4.0-Core-full.md` already has node types as a deployment-shaped concept
  and this sits next to them. Adding it is a spec change and was not asked for.
