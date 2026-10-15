/**
 * @file src/data/builtin-skills.extension-builder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-extension-builder` built-in skill: how an AI builds, installs, prices and
 *   verifies a sandboxed server extension. The full `ctx` table and manifest reference stay in the
 *   node's served build prompt (GET /v1/prompts/build-extension, services/build-extension-prompt.ts);
 *   this skill is the path through it and the rules a builder gets wrong.
 *
 *   WHY A BUILT-IN. Until 2026-10-11 the skill existed only as an operator-published copy on
 *   aimeat.io (1.0.0, 2026-07-27), so every other node had none, and its selling section still
 *   priced an action in morsels. The AI-facing half of docs/manuals/service-extensions-manual.md
 *   (writing scripts, the ctx rules, instances, schedules, best practice) moved here in the same
 *   change, corrected: top-level helpers are kept (services/extension-runtime.ts transformScript,
 *   since 2026-07-18), an update is PUT /v1/extensions/{name} in place, `instance_scope` on a
 *   manifest schedule does not exist, there is no /v1/federation/capabilities route, and a morsel
 *   is pacing, never a price (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). A
 *   skill ships with every installation and seeds by hash (services/skill-seeds.ts).
 *
 *   WHAT IT MUST AGREE WITH. services/build-extension-prompt.ts (the canonical table it points
 *   to), services/extension-ctx-contract.ts (ctx members), services/extension-manifest.ts (manifest
 *   validation, tollMorsels, commercial, the 4.0.0 refusal of payMorsels), routes/extensions/
 *   paywall.ts and pacing.ts (who pays what per call), routes/extensions/crud.ts and instances.ts
 *   (install, PUT redeploy, instances), services/extension-schedules.ts (schedule fields),
 *   services/schedule-write.ts (instance_id on POST /v1/schedules), config.ts (the limits and
 *   AIMEAT_EXT_INSTALL_ROLE).
 * @structure EXTENSION_BUILDER_SKILL_ENTRY
 * @usage import { EXTENSION_BUILDER_SKILL_ENTRY } from './builtin-skills.extension-builder.js';
 * @version-history
 *   2026-10-16 — A run ends at a wall-clock limit, waiting included (QA audit S7-02).
 *   v2.1.0 — 2026-10-12 — Instances: calling an action asks ext:invoke, reading the instances ext:invoke or
 *     ext:write (the REST scope gates of 4.0.0, auth/rest-scope-gate.ts).
 *   v2.0.0 — 2026-10-11 — Built in, extended with the AI half of the service-extensions manual,
 *     and selling rewritten to a money price plus a pacing amount (docs audit phase 2).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const EXTENSION_BUILDER_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-extension-builder',
  visibility: 'public',
  skillMd: `---
name: aimeat-extension-builder
description: Build, install, price and verify a sandboxed server extension on an AIMEAT node over MCP (the aimeat_extension_* tools) or REST. The path for any "make an extension", "call an outside API from the node", "run this on the node on a schedule" or "sell this capability" request. Covers fetching the canonical build spec, the manifest essentials, the script rules builders get wrong, what an extension cannot do, instances, schedules, secrets, the money price and the pacing amount, who may install, and how to prove it works. Use whenever a capability must run server-side, hold a secret, or be sold.
license: MIT
metadata:
  audience: agent
---

# Building AIMEAT server extensions

An **extension** is sandboxed code that runs **on the node**, one script per action, reachable as
\`POST /v1/ext/{name}/{action}\`. It is the answer when something cannot live in a browser: an
outside call that needs a credential, work that must run when no tab is open, data only the node
should compute, or a capability you intend to **sell**. An app never calls an extension directly:
the app calls a cortex method, and the cortex calls the extension.

## 1. Fetch the canonical spec first

The node serves the authoritative specification, the one source for the \`ctx\` table (which run
gets which member), the manifest, secrets, files, selling and installing. Fetch it before you write
anything, every time; it changes:

\`\`\`
GET /v1/prompts/build-extension          the spec
GET /v1/app-grants/scopes                what an app grant may hold (ext:write is not there)
GET /v1/exchange/offerings?q=<name>      whether somebody already sells this
\`\`\`

**Research before building.** \`aimeat_appdev_overview\` lists the person's apps and extensions in one
call, \`aimeat_extension_list\` what is installed, and the offerings what is for sale. When the work is
"fetch something every morning", load \`node:aimeat-recurring-work\` first: one of the person's agents
may already do it.

## 2. Workflow

1. **Fetch the spec** (section 1).
2. **Write the manifest and the scripts**: one YAML document and a map of script path to source.
3. **Install**: \`aimeat_extension_install\` with \`manifest\` and \`scripts\` (omit both to get an
   \`upload_url\` for a ZIP with \`manifest.yaml\` at the root; use that for anything with real code
   in it). REST: \`POST /v1/extensions\` with \`{ manifest, scripts }\`.
4. **Activate**: \`aimeat_extension_activate\` (REST \`POST /v1/extensions/{name}/activate\`). An
   uploaded extension installs inactive and runs nothing until then. Activation registers its
   schedules and runs the \`@activate\` ones.
5. **Set its secrets**: \`aimeat_extension_config_set\` for a \`type: secret\` config field.
6. **Invoke it for real**: \`aimeat_extension_invoke\` with \`extension_name\`, \`action_id\`, \`input\`
   (and \`instance_id\` for an instance). Then make it fail once on purpose.
7. **Update in place**: \`aimeat_extension_install\` with \`update: true\`, or
   \`PUT /v1/extensions/{name}\`. It replaces the manifest and scripts and keeps the \`ext:{name}\`
   memory, the instances and the activation. Never DELETE and reinstall to update: that loses them.

## 3. Manifest essentials

- \`metadata\` holds \`name\`, \`version\`, \`description\` and \`author\`; all four are required.
- Every action needs \`id\`, \`method\`, \`path\` and \`script\`, and declares \`input\` and \`output\`
  schemas: a buyer contracts against them, and an action without both is not listed for sale.
- \`capabilities: [network, ai, email, payments]\` at the top level: what the scripts may do beyond
  their own memory. Without \`network\`, \`ctx.fetch\` throws \`CAPABILITY_NOT_DECLARED\`; without the
  others, \`ctx.ai\`, \`ctx.email\` and \`ctx.buy\` are \`undefined\`. \`network: { hosts: [api.example.com] }\`
  limits \`ctx.fetch\` to those hosts.
- \`workspace: { read: true, write: true }\` gives \`ctx.workspace\`, which acts on the caller's
  organism workspace as the caller.
- Write it in YAML **block style**. A flow mapping with a comma inside a value breaks the value and
  the install fails; quote a description that contains \`: \`.
- \`federation.advertise\` is stored with the extension and read by nothing yet.

## 4. Script rules builders get wrong

- One \`export default async function (ctx, input)\` per file. **Helpers declared above it are kept**
  (top-level \`const\` and \`function\` work). There is no DOM, no Node built-in, no timer and no
  network except \`ctx.fetch\`.
- **The node does not check \`input\` against the action's schema.** Check every field you read and
  throw when it is wrong.
- **On a schedule, a workflow step or an \`on_done\` callback, a normal return is a success** whatever
  it contains, so a failed precondition must \`throw\`.
- An \`undefined\` or \`null\` argument to a \`ctx\` call throws, naming the method.
- \`ctx.fetch(url, opts)\` answers \`{ status, ok, text, headers }\`. \`text\` is the body as a string:
  \`JSON.parse(res.text)\`; there is no \`json()\`. It reads at most 4 MB of one answer.
- \`ctx.log\` is \`{ info, warn, error }\`, not a function. Log calls cost no API call.
- \`ctx.memory\` is the extension's own namespace, \`ext:{name}\`. **A key is public unless the write
  passes \`{ visibility: 'private' }\`**: pass it on every write that holds personal data. Write one
  key per period or per collection, never one per item: the namespace holds 1000 keys by default.
- \`ctx.now()\` is the run's start time, fixed for the run; \`ctx.hash(s)\` is the FNV-1a hash an app
  can compute the same way.
- A run has 500 host calls and 5 seconds by default (\`AIMEAT_EXT_MAX_API_CALLS\`,
  \`AIMEAT_EXT_TIMEOUT_MS\`, which counts the script's own running time). The whole run, waiting on
  host calls included, ends at twelve times that limit, at least one minute, so a run that awaits
  something that never answers fails instead of hanging. \`ctx.memory.search(prefix)\` returns values too, so do not read each key
  again. Many workspace records go through \`ctx.workspace.publishRecords\` in one call.
- The sandbox starts fresh for each call. All state lives in memory.
- Check the caller in the script: \`ctx.caller.roles\` (an owner in person has \`['owner']\` and no
  scopes, an unattended run has \`['operator']\`), \`ctx.caller.scopes\` (what an agent's or app's
  credential carries).

## 5. What an extension cannot do

- **Act on the node in the caller's name.** There is no \`ctx.api\` and no \`ctx.task\`, and
  \`ctx.fetch\` carries no session. An agent's task is created by the cortex in the person's session
  (\`POST /v1/agents/{name}/tasks\`); work the extension leaves for an agent goes into a workspace
  record with \`ctx.workspace\` (skill \`aimeat-workspace-contracts\`).
- **Push live updates to an app.** \`ctx.notify(message, opts)\` sends a notification to a person; it
  is not an app channel. An app re-reads when the node's event stream names a domain it shows.
- **Take a payment in morsels.** \`ctx.wallet.consume\` burns the caller's morsels and credits nobody.
  A morsel paces use and is never a price, a fee or a currency, so a script never charges a price
  with it. Pacing and money are declared on the action (section 8), and the node charges them.
- **Read another namespace's private data.** \`ctx.memory.getPublic(namespace, key)\` reads only
  public keys. Translations and settings are the person's data: the cortex reads them from the
  owner namespace, and nothing copies them into \`ext:\`.

## 6. Instances

With \`instances: { supported: true, config_per_instance: { ... } }\`, one installation serves several
independent copies. Create one with \`POST /v1/extensions/{name}/instances\` \`{ id, config }\` (the
installer or the operator). Call it at \`POST /v1/ext/{name}/{instanceId}/{action}\`. Calling an
action asks \`ext:invoke\` of an agent or an app, and reading the instances asks \`ext:invoke\` or
\`ext:write\` (node 4.0.0 refuses a call without the word; before that it works and says it is
deprecated), so an app that calls an extension through its cortex declares \`ext:invoke\`. Each instance
has its own namespace, \`ext:{name}.{instanceId}\`, and the script reads \`ctx.instance.config\`. A
\`type: secret\` field in the instance config is encrypted per instance: bring-your-own-key per tenant.

## 7. Schedules

\`\`\`yaml
schedules:
  - id: first-run
    action: setup
    cron: "@activate"            # once, each time the extension is activated
  - id: refresh
    action: refresh
    cron: "0 */6 * * *"
    timezone: Europe/Helsinki    # optional; UTC otherwise
    input: { full: false }       # optional; the same input on every fire
\`\`\`

A schedule names an \`action\`; an action id has no special meaning. A manifest schedule runs for the
extension, not per instance: an instance's schedule is created with \`aimeat_schedule_create\` (kind
\`extension\`, with \`instance_id\`) or \`POST /v1/schedules\`.

## 8. Money price and pacing

Every action can carry two values, and they do different jobs:

\`\`\`yaml
  - id: lookup
    method: POST
    path: /lookup
    script: actions/lookup.js
    tollMorsels: 2               # pacing: whole morsels per call, 0-100, within AIMEAT_EXT_MAX_DEBIT
    commercial:                  # optional: a money price
      payMoney: { amount: 50000, currency: EUR }   # 6-decimal micro-units: 50000 = 0.05 EUR
      exchange: true             # lists the action for sale; the manifest is the listing
\`\`\`

- **Pacing** (\`tollMorsels\`) paces how fast a capability can be used. The node charges it before the
  script runs: the burn rate's share burns and the rest is credited to the installer. The installer's
  own calls are free. A caller with too few morsels gets 402, naming the daily allowance and, when the
  operator sells one, a pacing pack.
- **A money price** (\`commercial.payMoney\`) is paid through the node's checkout; the caller settles it
  and retries with the pay token. An integer in micro-units: \`0.05\` written as a number is refused.
- A \`commercial\` block needs a money price, or the action a pacing amount above 0 for a free, paced
  action. \`commercial.payMorsels\` is the 3.x name of the pacing amount: read as pacing until node
  4.0.0, refused from 4.0.0 with \`MORSEL_PRICE_REMOVED\`. Write \`tollMorsels\`.
- Ask why a flagged action is not on the market with \`POST /v1/exchange/reconcile\`
  \`{ "dry_run": true, "ext": "<name>" }\`.

## 9. Secrets and files

- A credential lives in a \`config:\` field with \`type: secret\`: encrypted at rest, decrypted only
  inside the sandbox, \`undefined\` until somebody sets it. Or write a header as \`{{secret:NAME}}\` and
  the node fills it from the caller's own vault on the way out; the script never holds the value.
  Never put a key in a script or a return value.
- Files: a client uploads through the storage API and passes the keys; \`ctx.files\` reads and writes
  stored files by reference. Return references, not large payloads.

## 10. Who may install

The role in \`AIMEAT_EXT_INSTALL_ROLE\` (default \`owner\`), or a principal holding \`ext:write\`. An app
under an app grant cannot: \`ext:write\` is outside the grantable scopes, because an extension is
persistent code that outlives the grant and can charge in the owner's name. An app may write a
manifest and hand it over; the person or an authorised agent installs it. The node caps code at
\`AIMEAT_EXT_MAX_CODE_SIZE_KB\` (256) per script and \`AIMEAT_EXT_MAX_INSTALLED\` (20) extensions.

## Checklist

1. The spec fetched, and nothing like it already installed or for sale.
2. \`metadata\` with all four fields; every action with \`id\`, \`method\`, \`path\`, \`script\`, \`input\`,
   \`output\`; \`capabilities\` declared.
3. Scripts check their input, throw on a failed precondition, write personal data private.
4. Credentials in secret config or \`{{secret:NAME}}\`, never in code.
5. \`tollMorsels\` and, when it costs money, \`commercial.payMoney\` in micro-units; no morsel price.
6. Installed, activated, invoked for real, failed once on purpose; updated with \`update: true\`.
`,
};
