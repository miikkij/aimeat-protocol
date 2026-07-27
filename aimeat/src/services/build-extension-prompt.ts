/**
 * @file build-extension-prompt.ts
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
    '| `ctx.caller` | `{gaii, owner, roles}` of whoever invoked this action |',
    '| `ctx.config` | Your manifest `config:` values, secrets already decrypted |',
    '| `ctx.instance` | `{id, config}` when the action runs against a named instance |',
    '| `ctx.log.info/warn/error(msg, data)` | Goes to the node log, not to the caller |',
    '| `ctx.now()` | The run\'s ISO timestamp, FIXED for the whole run |',
    '| `ctx.hash(s)` | FNV-1a 64-bit, 16 hex chars |',
    '| `ctx.notify(message, opts)` | Notify the owner, when the context offers it |',
    '| `ctx.email(to, subject, body)` | Send mail, when the context offers it |',
    '',
    '`ctx.files`, `ctx.notify` and `ctx.email` are OPTIONAL: a scheduled run with no caller does not',
    'get them. Check before use (`if (!ctx.files) ...`) rather than assuming.',
    '',
    '`ctx.fetch` returns `text`, never a parsed body. Parse it yourself and handle a non-ok status.',
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

/** Commerce, transcribed from manifest.ts validateActionPricing + exchange-projection desiredFromExtActions. */
function commerceSection(): string {
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
    commerceSection(),
    installSection(url),
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
