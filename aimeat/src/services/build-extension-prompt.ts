/**
 * @file build-extension-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The canonical "build an AIMEAT server extension" prompt, served from the node so
 *   every consumer gets one non-drifting source of truth: the profile Extensions tab, an agentic
 *   coder over GET /v1/prompts/build-extension, the aimeat-extension-builder skill, llms.txt.
 *
 *   It exists because the browser-side copy it replaces taught a WORKING extension but not a
 *   SELLABLE one. Audited against the live text: zero mentions of `commercial`, of the exchange
 *   flag, of the install route, of `__secretKeys`, of `ctx.files`. Somebody following it built
 *   something that could never reach the market and had nowhere to be installed. Every claim below
 *   is read out of the code that enforces it, cited in the comments, not recalled.
 * @structure buildExtensionPrompt(config, opts) -> { full, body }
 *   - body: the platform core (sandbox contract, manifest, scripts, secrets, files, commerce,
 *     install, verification) — what the Extensions tab fetches and wraps in its own header.
 *   - full: language line + framing + body — what an agent fetches and uses as-is.
 * @usage import { buildExtensionPrompt } from '../services/build-extension-prompt.js';
 *   const { full, body } = buildExtensionPrompt(config, { lang: 'en', owner: 'alice' });
 * @version-history
 *   v1.4.0 — 2026-09-06 — The secrets section teaches `{{secret:NAME}}` beside the operator's
 *     `type: secret` config: the caller's vault fills the header on the way out, and the script
 *     never holds the value. Additive; the operator path reads as before.
 *   v1.3.0 — 2026-09-05 — ctx.workspace in the ctx table, with the manifest declaration that
 *     makes it exist and the scopes the caller must hold.
 *   v1.2.0 — 2026-09-03 — versionsSection: kept versions, pinned addresses and the dependency map.
 *   v1.1.0 — 2026-07-30 — Beneficiary splitting: how to route part of what you earn to other
 *     accounts, and the `_revenue` key an action returns to name a destination PER CALL. The
 *     capability shipped with no way for an author to discover it, so nobody but its implementer
 *     could have used it.
 *   v1.0.0 — 2026-07-27 — Moved off the Extensions tab into the node and completed with the four
 *     things it never said: the commercial block + exchange listing, the install route, secret
 *     config fields, and binary file I/O.
 */
import type { AimeatConfig } from '../config.js';

export interface ExtensionPromptOpts {
  /** Reply language for the built extension's own copy; the instructions stay English. */
  lang?: string;
  /** The owner the extension will be installed for, so namespaces read concretely. */
  owner?: string;
  /** What the person wants it to do, when the caller already knows. */
  idea?: string;
}

/** The sandbox context, transcribed from services/extension-runtime.ts ExtensionCtx. */
function sandboxSection(): string {
  return [
    '## What your code receives',
    '',
    'An action script is an ES module with ONE default export. It runs in a QuickJS sandbox with no',
    'DOM, no Node built-ins, no network except `ctx.fetch`, and no globals you did not create.',
    '',
    '```js',
    'export default async function (ctx, input) {',
    '  // input is the caller\'s JSON, already validated against your action\'s `input` schema',
    '  return { ok: true };            // your return value becomes the response',
    '}',
    '```',
    '',
    'Helpers and consts declared ABOVE the export are preserved, so you may structure the file.',
    '',
    'The `ctx` object, in full:',
    '',
    '| Call | What it does |',
    '|---|---|',
    '| `ctx.memory.get(key)` | Read one key in this extension\'s own `ext:{name}` namespace |',
    '| `ctx.memory.set(key, value)` | Write one key there |',
    '| `ctx.memory.search(prefix, opts)` | List `{key, value}` under a prefix |',
    '| `ctx.memory.delete(key)` | Remove one key |',
    '| `ctx.memory.getPublic(namespace, key)` | Read someone else\'s PUBLIC key, e.g. the caller\'s own data |',
    '| `ctx.fetch(url, {method, headers, body})` | The only way out. Returns `{status, ok, text, headers}` |',
    '| `ctx.files.read(ref)` | A stored file as `{base64, mime, size, key}`, or null |',
    '| `ctx.files.write(key, base64, {mime, visibility})` | Store bytes, returns `{key, gaii, url, size}` |',
    '| `ctx.workspace.index(orgId, ws)` | The CALLER\'s organism workspace: manifest, schemas, titles (no bodies) |',
    '| `ctx.workspace.get(orgId, ws, ids, {space})` | Full values of those records; `_draftVersion` is what `ifVersion` swaps against |',
    '| `ctx.workspace.write(orgId, ws, space, id, value, {ifVersion})` | A schema-validated DRAFT record, as the caller. `ifVersion: 0` = only if no draft yet |',
    '| `ctx.workspace.writeDoc(orgId, ws, space, {title, markdown}, {id, section})` | A DRAFT document in a document space |',
    '| `ctx.workspace.publish(orgId, ws, namespace, id, {expectedVersion})` | Publish the draft; `.latest` lands under the member |',
    '| `ctx.caller` | `{gaii, owner, roles}` of whoever invoked this action |',
    '| `ctx.caller.member` | Their standing in the app this extension gates, or null |',
    '| `ctx.caller.isAppOwner` | True when the caller owns that app |',
    '| `ctx.config` | Your manifest `config:` values, secrets already decrypted |',
    '| `ctx.instance` | `{id, config}` when the action runs against a named instance |',
    '| `ctx.log.info/warn/error(msg, data)` | Goes to the node log, not to the caller |',
    '| `ctx.now()` | The run\'s ISO timestamp, FIXED for the whole run |',
    '| `ctx.hash(s)` | FNV-1a 64-bit, 16 hex chars |',
    '| `ctx.notify(message, opts)` | Notify the CALLER\'s owner, when the context offers it |',
    '| `ctx.email(to, subject, body)` | Send mail, when the context offers it |',
    '',
    '`ctx.files`, `ctx.notify` and `ctx.email` are OPTIONAL: a scheduled run with no caller does not',
    'get them. Check before use (`if (!ctx.files) ...`) rather than assuming.',
    '',
    '`ctx.workspace` exists only when your manifest declares it at the top level:',
    '`workspace: { read: true, write: true }` (read alone makes the writers throw PERMISSION). It acts',
    'on the CALLER\'s organism workspace AS THE CALLER, through the same operations',
    'aimeat_workspace_read / _write / _publish perform, so every refusal those make (not a member of',
    'the organism, no contributor grant, an agent token without `memory:write`, a record the locked',
    'schema rejects, an `ifVersion` that no longer matches, the publish gate) reaches your script as a',
    'thrown `CODE: message`. Let it propagate and the caller gets the service\'s status and code; catch',
    'it and answer in your own words. A scheduled run never has it. Every call costs one API call. A',
    'record written this way carries provenance naming your extension, because a script produced it.',
    '',
    '`ctx.notify` reaches the CALLER, never a third party. Read literally: "notify the owner" means',
    'the owner of whoever just invoked this action, not the owner who installed the extension. So an',
    'approval flow cannot use it to reach the person being approved (at that moment the caller IS the',
    'approver, who would only notify themselves), and a request flow cannot use it to reach the owner',
    '(there the caller is the applicant). Telling someone else something is a NODE job: the node emits',
    'it off an event it authorised and whose two parties it verified, which is why approving a member',
    'through an EXCHANGE grant notifies them and an extension writing to `ctx.notify` cannot.',
    '',
    '`ctx.fetch` returns `text`, never a parsed body. Parse it yourself and handle a non-ok status.',
    '',
    'GATING AN APP: declare the app in your manifest `config:` as `app: owner/file.html`, and the node',
    'resolves the caller against that app\'s member roster BEFORE your script runs, handing you',
    '`ctx.caller.member` = `{role, level, since, note}` or null, plus `ctx.caller.isAppOwner`. Do NOT',
    'keep your own roster in `ctx.memory`: the roster the node keeps is private, notifies the person',
    'when they are approved or removed, and takes their free access with the role, and none of those',
    'three are things an extension can do for itself. Keep the CAPABILITY vocabulary here (which role',
    'may do what) and read the role from ctx.caller. A role belongs to the PERSON, so a member calling',
    'through their agent resolves to the same row without a second entry.',
    '',
  ].join('\n');
}

/** The manifest contract, transcribed from routes/extensions/manifest.ts. */
function manifestSection(owner: string): string {
  return [
    '## The manifest',
    '',
    'One YAML (or JSON) document plus a `scripts` map. Every action names a script that must exist.',
    '',
    '```yaml',
    'metadata:',
    `  name: my-extension           # lowercase, hyphens, unique for ${owner}`,
    '  version: 1.0.0',
    '  description: What this does, in one sentence a buyer would understand',
    `  author: ${owner}`,
    '',
    'config:                        # optional; values arrive as ctx.config',
    '  apiKey:',
    '    type: secret               # encrypted at rest, decrypted only inside the sandbox',
    '    description: The upstream API key',
    '  region:',
    '    type: string',
    '    default: eu',
    '',
    'actions:',
    '  - id: lookup',
    '    method: POST',
    '    path: /lookup',
    '    script: lookup.js          # must be a key in the scripts map',
    '    description: Look one thing up',
    '    input:                     # JSON Schema. Stored as inputSchema; validated per call',
    '      type: object',
    '      properties:',
    '        businessId: { type: string, description: A Finnish business ID }',
    '      required: [businessId]',
    '    output:',
    '      type: object',
    '      properties:',
    '        name: { type: string }',
    '        found: { type: boolean }',
    '```',
    '',
    'The two schemas are not decoration. An action with an empty `input` or `output` is refused a',
    'market listing (`SCHEMA_REQUIRED`), because a buyer cannot contract for something whose shape',
    'is unstated.',
    '',
  ].join('\n');
}

/** Secrets, transcribed from services/extension-secrets.ts. */
function secretsSection(): string {
  return [
    '## Secrets, the only safe place for an API key',
    '',
    'A `config:` field declared `type: secret` is encrypted at rest with AES-256-GCM and decrypted',
    'only just before your code runs. Reads of the extension record show a mask, never the value.',
    '',
    '```js',
    'const res = await ctx.fetch(url, { headers: { Authorization: `Bearer ${ctx.config.apiKey}` } });',
    '```',
    '',
    'Never put a key in the script, in a memory value, or in a returned object. A consumer buying',
    'your action gets its RESULT and never your credential: that asymmetry is what you are selling.',
    '',
    '**When the key belongs to the PERSON calling, not to the operator, name it instead of reading it.**',
    'Every owner has a vault of named secrets, and a header value written as `{{secret:NAME}}` is',
    'filled in by the node on the way out: the caller\'s vault first, then a `type: secret` config of',
    'your own by that name, and if neither holds it the call fails before anything is sent, with',
    '`SECRET_UNKNOWN` naming the header and the secret. Your script never sees the value, so it cannot',
    'log it, return it or write it anywhere; a redirect away from the origin you aimed at drops it.',
    '',
    '```js',
    'await ctx.fetch(url, { headers: { Authorization: "Bearer {{secret:OPENWEATHER_KEY}}" } });',
    '```',
    '',
    'So a `config:` secret is for one credential the operator holds for everyone, and `{{secret:NAME}}`',
    'is for each person\'s own. Write the name in your manifest description and in every error you',
    'return, exactly as it must be stored: a person fills it in on their Access page (section 04,',
    'Secrets) or asks their own AI, which stores it with `aimeat_secret_set { name, value }` when the',
    'owner has ticked `secrets:manage` for that agent. Nothing on the node reads a stored value back,',
    'so an app or a document can only carry the placeholder, never the key.',
    '',
  ].join('\n');
}

/** Binary I/O, transcribed from ExtensionCtx.files. */
function filesSection(): string {
  return [
    '## Files, when text is not enough',
    '',
    '`ctx.fetch` gives you text. For bytes (a PDF, an image, a spreadsheet) use the file surface:',
    '',
    '```js',
    'const f = await ctx.files.read(ref);            // { base64, mime, size, key } or null',
    'const saved = await ctx.files.write("out/report.pdf", b64, { mime: "application/pdf" });',
    'return { url: saved.url };                       // hand back the address, not the bytes',
    '```',
    '',
    'Return a reference rather than a payload whenever you can. A megabyte of base64 in a response',
    'is a megabyte through the sandbox boundary, and the caller usually wants a link anyway.',
    '',
  ].join('\n');
}

/** Commerce, transcribed from manifest.ts validateActionPricing + exchange-projection desiredFromExtActions,
 *  plus beneficiary splitting from commerce/beneficiary-{split,designation}.ts. */
function commerceSection(url: string): string {
  return [
    '## Selling it: the block that turns an action into a product',
    '',
    'This is the part most extensions are missing, and without it nothing you build can ever appear',
    'on the market. Price the ACTION, in the manifest:',
    '',
    '```yaml',
    '  - id: lookup',
    '    # ... method, path, script, input, output as above',
    '    tollMorsels: 0             # optional anti-abuse burn, charged even on a money contract',
    '    commercial:',
    '      payMorsels: 2            # whole morsels per call, non-negative integer',
    '      payMoney:',
    '        amount: 50000          # 6-decimal MICRO-units. 50000 = 0.05 EUR. 1 EUR = 1000000',
    '        currency: EUR          # EUR or USD',
    '      exchange: true           # list it on the open market',
    '      usageTerms:',
    '        derivatives: true',
    '        resale: false',
    '        attribution: true',
    '```',
    '',
    'Rules the node enforces, so get them right the first time:',
    '',
    '- At least ONE real channel. `payMorsels: 0` with no `payMoney` is refused: an action with no',
    '  price is not contractable.',
    '- `payMoney.amount` is an integer in micro-units and must be positive. Writing `0.05` is a',
    '  five-cent price expressed as zero, and it will be rejected.',
    '- `exchange: true` is what LISTS it. Priced but unflagged means callable under a contract you',
    '  arrange yourself, and invisible on the market.',
    '- A flagged action still needs both schemas and a price, or the projection skips it and says',
    '  why (`SCHEMA_REQUIRED`, `NOT_PRICED`).',
    '- Money takes precedence over morsels when both are present, so a consumer who accepts a',
    '  money listing is metered in money.',
    '',
    'You do not call a listing endpoint. The manifest IS the listing: write the price, and the',
    'market follows on the next write. Change the price later and the same card updates rather',
    'than a rival one appearing.',
    '',
    '## Sharing what you earn with somebody else',
    '',
    'Sometimes the money you take for a call is not all yours to keep. A lookup service owes the',
    'party it looked up; a dataset owes whoever maintains it. You can route part of YOUR cut to',
    'other accounts, and the buyer is not charged a cent more for it: the share comes out of what',
    'you earned, after the platform rake, never out of their price.',
    '',
    'Declare it once, as the owner, against the coordinate you sell at:',
    '',
    '```bash',
    `curl -X POST ${url}/v1/commerce/beneficiary-splits \\`,
    '  -H "Authorization: Bearer $TOKEN" -H \'Content-Type: application/json\' \\',
    '  -d \'{ "ext": "my-ext", "action": "lookup", "pool_percent": 70, "dynamic": true,',
    '        "beneficiaries": [{ "ghii": "alice@node-id", "weight": 3, "note": "data steward" }] }\'',
    '```',
    '',
    '`pool_percent` is how much of your cut leaves you. `weight` divides that pool: two rows at',
    'weight 1 split it evenly, 3 and 1 split it 75/25.',
    '',
    'That covers a standing arrangement. When WHO deserves a share depends on what the call was',
    'about, set `dynamic: true` and name the destinations from inside the action itself, by putting',
    'a `_revenue` key on what you return:',
    '',
    '```javascript',
    'export default async function (ctx, input) {',
    '  const company = await lookUp(input.businessId);',
    '  return {',
    '    company,',
    '    // Stripped by the node before the buyer sees this. They asked about a company, not about',
    '    // who you share your margin with.',
    '    _revenue: { beneficiaries: [{ ghii: company.ownerGhii, weight: 1 }] },',
    '  };',
    '}',
    '```',
    '',
    'What that key can and cannot do, because the limits are the reason it is allowed at all:',
    '',
    '- It names DESTINATIONS only. There is no way to put an amount, a percent or a currency in it.',
    '  The pool size stays your server-held declaration, so an action can redirect a share you',
    '  already committed and can never enlarge its own payout.',
    '- It is ignored unless the declaration says `dynamic: true`.',
    '- A call that names nobody simply leaves your whole cut with you. The share was never anyone',
    '  else\'s until somebody was named for it.',
    '- A malformed entry is dropped, not fatal. A bookkeeping typo must not deny a buyer the answer',
    '  they already paid for.',
    '',
    'Shares ACCRUE on every settled call and are visible to the beneficiary immediately',
    `(\`GET ${url}/v1/commerce/beneficiary/earnings\`). PAYING one out is a separate, gated act: the`,
    'node refuses until an operator has recorded that the beneficiary may be paid. Accruing to an',
    'unverified account is fine and useful; paying it is how a self-declared claimant would collect',
    'on somebody else\'s identity, so it does not happen by itself.',
    '',
  ].join('\n');
}

/** Install + activate, transcribed from routes/extensions/crud.ts. */
function installSection(url: string): string {
  return [
    '## Installing it',
    '',
    'A finished extension is not installed until you post it. Two ways, same result:',
    '',
    '```bash',
    `# inline, fine for a small one`,
    `curl -X POST ${url}/v1/extensions \\`,
    `  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\`,
    `  -d '{"manifest":"<yaml>","scripts":{"lookup.js":"export default async function(ctx,input){...}"}}'`,
    '',
    '# presigned, for anything with real code in it: mint a URL, then PUT a zip',
    `curl -X POST ${url}/v1/extensions \\`,
    `  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\`,
    `  -d '{"mode":"presigned","name":"my-extension"}'`,
    '# -> { upload_url }, then PUT a zip with manifest.yaml at the root and scripts/ beside it',
    '```',
    '',
    `Then activate it: \`POST ${url}/v1/extensions/{name}/activate\`. An installed extension that is`,
    'never activated runs nothing.',
    '',
    'Updating: `PUT /v1/extensions/{name}` replaces in place and keeps the name.',
    '',
    '**Who may install.** The owner role, or a principal holding `ext:write`. An app running on its',
    'own origin under an app grant CANNOT: `ext:write` is deliberately outside the grantable scope',
    'vocabulary, because an extension is persistent server-side code that outlives the grant that',
    'created it. So an app may write you this manifest, but a human or an authorised agent installs it.',
    '',
  ].join('\n');
}

/**
 * Versions and the dependency map. Every install and update keeps a version; an app pins the one
 * it was built against in the address; the map, read from the served bytes, says who uses what.
 */
function versionsSection(url: string): string {
  return [
    '## Versions, pinning and who uses what',
    '',
    'Every install and `PUT` keeps a snapshot under the manifest\'s `metadata.version`. The bare address',
    '`POST /v1/ext/{name}/{actionId}` runs the latest; `POST /v1/ext/{name}@{version}/{actionId}` runs that',
    'kept version\'s code with the live settings. An app or a cortex built against one version keeps',
    `running it after the extension moves on. \`GET ${url}/v1/extensions/{name}/versions\` lists them.`,
    '',
    'The rule, the same as for apps: a fix that changes no input or output keeps the version; a change',
    'that would break a caller is a NEW version, and the caller decides when to move. When you write',
    'code that calls an extension, pin the version you tested against (`@1.2.0`) unless the owner asks',
    'for the latest.',
    '',
    `Before building, read \`GET ${url}/v1/dependencies\`: which extensions and cortexes exist here and`,
    'who uses them (the map is read from the served source at publish and install, never written by',
    'hand). Reuse what exists; extend it with a new version rather than a copy. `GET /v1/extensions`',
    'carries the same as `used_by` on every row, and `GET /v1/apps` carries `requires` on every app.',
    '',
  ].join('\n');
}

/** The finish line, in the same spirit as the app prompt's "before you call it done". */
function verifySection(url: string): string {
  return [
    '## Before you call it done',
    '',
    '1. **Invoke it for real.** `POST /v1/ext/{name}/{actionId}` with a body that matches your input',
    '   schema, and read what comes back. A manifest that validates is not an action that works.',
    '2. **Make it fail.** Send a missing required field and a bad upstream response. An action that',
    '   returns `undefined` on an error path is one a buyer cannot tell from an empty answer.',
    '3. **Check the listing** if you priced it: `GET /v1/exchange/offerings?q={name}`. If it is not',
    `   there, run \`POST ${url}/v1/exchange/reconcile\` with \`{"dry_run":true,"ext":"{name}"}\` and`,
    '   read the `skipped` reason. It always says why.',
    '4. **Say what it does in the description.** It is the text a buyer reads before paying, and it',
    '   is the only thing standing between your work and someone scrolling past it.',
    '',
  ].join('\n');
}

/**
 * Build the canonical extension prompt.
 * `body` is the platform core the Extensions tab wraps; `full` is what an agent uses unchanged.
 */
export function buildExtensionPrompt(
  config: AimeatConfig,
  opts: ExtensionPromptOpts = {},
): { full: string; body: string } {
  const url = config.baseUrl || 'https://aimeat.io';
  const owner = opts.owner || 'your-account';
  const lang = opts.lang || 'en';

  const body = [
    '# Build an AIMEAT server extension',
    '',
    'A server extension is sandboxed code that runs ON the node, in the owner\'s name, reachable as',
    'an HTTP action. It is how a capability becomes something other people can call, and price.',
    '',
    `Node: ${url}`,
    `Owner: ${owner}`,
    '',
    sandboxSection(),
    manifestSection(owner),
    secretsSection(),
    filesSection(),
    commerceSection(url),
    installSection(url),
    versionsSection(url),
    verifySection(url),
  ].join('\n');

  const full = [
    lang && lang !== 'en'
      ? `Write the extension's own user-facing text in ${lang}. These instructions stay in English.`
      : '',
    opts.idea ? `What it should do: ${opts.idea}\n` : '',
    body,
  ].filter(Boolean).join('\n');

  return { full, body };
}
