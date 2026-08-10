/**
 * @file src/routes/extensions/manifest.ts
 * @description Shared extension-manifest validator/builder — validates a YAML manifest + scripts map
 *   and builds the ExtensionRecord it describes. Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.3.0 — 2026-08-10 — A manifest can no longer set the node's own config keys. __-prefixed
 *                         ones are written from validated sections; emailPolicy needs an operator,
 *                         which the code reading it always assumed and nothing checked.
 *   v1.2.0 — 2026-07-26 — validateManifestShape: type-check every field the builder later reads as a
 *     string. `(a.method as string).toUpperCase()` on a mis-typed field threw a TypeError out of the
 *     builder, which the presigned-upload router turned into a bare 500 with no mention of the
 *     manifest. Mis-typed fields are now a 400 naming the field and what the YAML produced.
 *   v1.1.0 — 2026-07-17 — Per-action pricing: validate + carry `tollMorsels` (anti-abuse burn) and
 *     `commercial` {payMorsels, payMoney} for priced raw calls (design notes doc-r6tyr3o, C1/M1)
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { ExtensionRecord } from '../../storage/interface.js';
import { parse as parseYaml } from 'yaml';
import { SECRET_KEYS_FIELD, computeManifestSecretKeys, stripClientEncryptedValues } from '../../services/extension-secrets.js';
import { MONEY_CURRENCIES } from '../../commerce/money.js';

/** Discriminated result of validating an extension install/upsert payload. */
export type ExtBuildResult =
  | { ok: true; record: ExtensionRecord; warnings?: string[] }
  | { ok: false; status: number; code: string; message: string };

/**
 * APIs an author reaches for that the QuickJS sandbox either does NOT have, or that make an action
 * non-deterministic. These are WARNINGS, never errors: the code still installs, but the author is
 * told at install time instead of discovering it in production.
 *
 * This exists because of a real, expensive failure: a browser app hashed values with
 * `crypto.subtle`, its extension could not (no WebCrypto in QuickJS) so it used a different
 * algorithm, and every value the app computed then looked stale to the server — silently
 * recomputing and re-charging AI work forever. `ctx.hash()` is the fix; this scan is what makes
 * anyone reaching past it notice.
 */
const SANDBOX_CAPABILITY_WARNINGS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /\bcrypto\s*\.\s*subtle\b/,
    message: 'crypto.subtle is NOT available in the sandbox (no WebCrypto in QuickJS). Use ctx.hash(s) — the node publishes that exact function so a browser app can compute the identical value; a hand-rolled hash on one side only is how an app and its extension stop agreeing about what is up to date.',
  },
  {
    pattern: /\bcrypto\s*\.\s*randomUUID\b|\brequire\s*\(\s*['"]node:crypto['"]/,
    message: 'Node crypto is not available in the sandbox. Derive ids from your input with ctx.hash(s), or let the caller supply them.',
  },
  {
    pattern: /\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(\s*\)/,
    message: 'Date.now() / new Date() make the action non-deterministic and un-replayable. Use ctx.now() — one timestamp captured at the start of the run, stable across the whole action.',
  },
  {
    pattern: /\bMath\s*\.\s*random\s*\(/,
    message: 'Math.random() makes the action non-deterministic, so an identical request stops returning an identical result (and cannot be cached or sold with an accuracy claim). Derive from the input instead, e.g. ctx.hash(JSON.stringify(input)).',
  },
  {
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
    message: 'eval() / new Function() are refused by the app-origin CSP on the browser side and are a code-injection risk here. Parse explicitly instead.',
  },
];

/**
 * Scan every action script for sandbox-unavailable or non-deterministic APIs.
 * Pure and side-effect free; returns one message per distinct problem found, naming the scripts.
 */
export function scanSandboxCapabilityWarnings(scripts: Record<string, string>): string[] {
  const out: string[] = [];
  for (const { pattern, message } of SANDBOX_CAPABILITY_WARNINGS) {
    const hits = Object.entries(scripts)
      .filter(([, content]) => pattern.test(content))
      .map(([name]) => name);
    if (hits.length) out.push(`${hits.join(', ')}: ${message}`);
  }
  return out;
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && Number.isFinite(v);
const fail = (message: string): ExtBuildResult => ({ ok: false, status: 400, code: 'INVALID_MANIFEST', message });

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Describe what a manifest field actually turned out to be, so the error names the mistake instead
 * of the type. A YAML flow map (`input: { type: object, description: a, b }`) is the usual way a
 * field silently becomes the wrong shape: the comma starts a new entry, and what the author read as
 * prose ends up as a key.
 */
function describeYamlValue(v: unknown): string {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return `a map (${Object.keys(v as object).slice(0, 4).join(', ')})`;
  return `${typeof v} (${JSON.stringify(v)})`;
}

/**
 * Every manifest field this builder later treats as a string MUST be checked here first.
 *
 * The bug this closes: `actions[].method` was read as `(a.method as string).toUpperCase()` with no
 * check, so a manifest where the field parsed as anything else threw a TypeError out of the whole
 * builder. On the REST/MCP paths that surfaced as a message; on the presigned ZIP path the router's
 * catch-all turned it into a bare `500 PROCESSING_FAILED`, which tells the author nothing about
 * their manifest. A mis-typed field is the author's mistake to fix, so it must be a 400 that names
 * the field, the action and what the YAML actually produced.
 */
function validateManifestShape(
  metadata: Record<string, unknown>,
  actions: Array<Record<string, unknown>>,
): ExtBuildResult | null {
  for (const field of ['name', 'description', 'author'] as const) {
    if (!isNonEmptyString(metadata[field])) {
      return fail(`metadata.${field} must be a non-empty string, got ${describeYamlValue(metadata[field])}`);
    }
  }
  // A YAML scalar like `version: 1.0` parses as a number, which is a legitimate thing to write.
  // Accept it and coerce at build time; refuse the shapes that cannot be a version at all.
  if (!isNonEmptyString(metadata.version) && typeof metadata.version !== 'number') {
    return fail(`metadata.version must be a string (quote it, e.g. "1.0.0"), got ${describeYamlValue(metadata.version)}`);
  }

  for (const [i, action] of actions.entries()) {
    if (typeof action !== 'object' || action === null || Array.isArray(action)) {
      return fail(`actions[${i}] must be a map with id, method, path and script, got ${describeYamlValue(action)}`);
    }
    const label = isNonEmptyString(action.id) ? `"${action.id}"` : `at index ${i}`;
    for (const field of ['id', 'method', 'path', 'script'] as const) {
      if (!isNonEmptyString(action[field])) {
        return fail(`Action ${label}: ${field} must be a non-empty string, got ${describeYamlValue(action[field])}`);
      }
    }
    // input/output are JSON Schema documents. A comma inside an unquoted flow-map description is
    // the common way these stop being maps, and storing the wreckage means the action advertises
    // an input contract nobody wrote.
    for (const field of ['input', 'output'] as const) {
      const v = action[field];
      if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v))) {
        return fail(`Action ${label}: ${field} must be a JSON Schema map, got ${describeYamlValue(v)}`
          + '. A comma inside an unquoted flow map splits it into another entry — quote the text.');
      }
    }
  }
  return null;
}

/**
 * Validate a raw action's pricing (design: notes doc-r6tyr3o). `tollMorsels` is an optional
 * anti-abuse burn (non-negative integer). `commercial` (optional) prices the call: `payMorsels`
 * must be a non-negative integer, `payMoney` (optional) is `{amount>0, currency ∈ MONEY_CURRENCIES}`,
 * and C1 requires at least one real payment channel (`payMorsels>0` OR `payMoney`). Returns an error
 * result on any violation, or `null` when valid. Enforces M1 by construction: morsels are revenue
 * only inside `commercial.payMorsels`.
 */
export function validateActionPricing(action: Record<string, unknown>, actionId: string): ExtBuildResult | null {
  if (action.tollMorsels !== undefined && !isNonNegInt(action.tollMorsels)) {
    return fail(`Action "${actionId}": tollMorsels must be a non-negative integer`);
  }
  const commercial = action.commercial as Record<string, unknown> | undefined;
  if (commercial === undefined) return null;
  if (typeof commercial !== 'object' || commercial === null) {
    return fail(`Action "${actionId}": commercial must be an object`);
  }
  const payMorsels = commercial.payMorsels ?? 0;
  if (!isNonNegInt(payMorsels)) {
    return fail(`Action "${actionId}": commercial.payMorsels must be a non-negative integer`);
  }
  const payMoney = commercial.payMoney as Record<string, unknown> | undefined;
  if (payMoney !== undefined) {
    if (typeof payMoney !== 'object' || payMoney === null) {
      return fail(`Action "${actionId}": commercial.payMoney must be an object`);
    }
    if (typeof payMoney.amount !== 'number' || !Number.isInteger(payMoney.amount) || payMoney.amount <= 0) {
      return fail(`Action "${actionId}": commercial.payMoney.amount must be a positive integer (6-decimal micro-units)`);
    }
    if (typeof payMoney.currency !== 'string' || !(MONEY_CURRENCIES as readonly string[]).includes(payMoney.currency)) {
      return fail(`Action "${actionId}": commercial.payMoney.currency must be one of ${MONEY_CURRENCIES.join(', ')}`);
    }
  }
  // C1: at least one real payment channel.
  if (Number(payMorsels) <= 0 && payMoney === undefined) {
    return fail(`Action "${actionId}": commercial must set at least one payment channel (payMorsels>0 or payMoney)`);
  }
  // Optional EXCHANGE pricing plans (bundle / subscription) — amounts in the action's unit (TARGET-045 Phase B).
  const plans = commercial.plans;
  if (plans !== undefined) {
    if (!Array.isArray(plans)) return fail(`Action "${actionId}": commercial.plans must be an array`);
    const ids = new Set<string>();
    for (const raw of plans) {
      const plan = raw as Record<string, unknown>;
      if (typeof plan.id !== 'string' || !plan.id) return fail(`Action "${actionId}": each plan needs a non-empty id`);
      if (ids.has(plan.id)) return fail(`Action "${actionId}": duplicate plan id "${plan.id}"`);
      ids.add(plan.id);
      const posInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;
      if (plan.model === 'bundle') {
        if (!posInt(plan.blockSize) || !posInt(plan.blockPrice)) {
          return fail(`Action "${actionId}" plan "${plan.id}": bundle needs positive integer blockSize + blockPrice`);
        }
      } else if (plan.model === 'subscription') {
        if (!posInt(plan.periodSeconds) || !posInt(plan.periodPrice) || !posInt(plan.callsPerWindow) || !posInt(plan.windowSeconds)) {
          return fail(`Action "${actionId}" plan "${plan.id}": subscription needs positive integer periodSeconds, periodPrice, callsPerWindow, windowSeconds`);
        }
      } else {
        return fail(`Action "${actionId}" plan "${plan.id}": model must be 'bundle' or 'subscription'`);
      }
    }
  }
  return null;
}

/**
 * Validate an extension install payload (YAML manifest + scripts map) and build the
 * ExtensionRecord it describes. Shared by POST (install) and PUT (upsert) so both validate the
 * manifest identically and produce the same record. Does NOT enforce quota, duplicate-name, or
 * permission — those are caller-specific (create vs. update). The caller supplies the lifecycle
 * fields (installedBy/installedAt); status defaults to 'inactive'.
 */
/**
 * Config keys the NODE owns, which an installer's manifest must never set.
 *
 * `__`-prefixed keys are the node's own namespace inside `ext.config`: `__schedules` is what makes
 * the scheduler run this extension on a clock, and `__secretKeys` is what tells the runtime which
 * fields to decrypt before the VM. Both are written below from validated manifest sections. An
 * installer writing them directly bypasses that validation, and a declared-but-untrue `__secretKeys`
 * points the decrypt step at plaintext.
 *
 * `emailPolicy` is the one that mattered. `'unrestricted'` lifts the email capability's recipient
 * check entirely, and the code that reads it has always called that operator-granted. Nothing
 * enforced it: config comes only from the manifest, and installing needs `requireAuth()` plus
 * whatever `extInstallRole` says, which defaults to `owner`. So on a node with more than one
 * account, anyone who could install an extension could send mail to any address under the node's
 * own SMTP identity. On a personal node the installer IS the operator, which is why this held for
 * as long as it did.
 */
const NODE_OWNED_CONFIG_KEYS = ['emailPolicy'];

/** Strip the keys an installer must not set. Operator installs keep `emailPolicy`, which is what
 *  "operator-granted" meant; everything `__`-prefixed goes regardless of who is installing. */
export function stripNodeOwnedConfig(
  manifestConfig: Record<string, unknown> | undefined,
  installerIsOperator: boolean,
): { config: Record<string, unknown> | undefined; stripped: string[] } {
  if (!manifestConfig) return { config: manifestConfig, stripped: [] };
  const stripped: string[] = [];
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(manifestConfig)) {
    if (k.startsWith('__') || (!installerIsOperator && NODE_OWNED_CONFIG_KEYS.includes(k))) {
      stripped.push(k);
      continue;
    }
    kept[k] = v;
  }
  return { config: kept, stripped };
}

export function buildExtensionRecordFromManifest(
  manifestYaml: string | undefined,
  scripts: Record<string, string> | undefined,
  config: AimeatConfig,
  installedBy: string,
  installedAt: string,
  /** Did the principal installing this hold the operator role? Decides whether the manifest may
   *  set `emailPolicy`. Defaults to false, so a caller that forgets gets the safe answer. */
  installerIsOperator = false,
): ExtBuildResult {
  if (!manifestYaml || typeof manifestYaml !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'manifest (YAML string) is required' };
  }
  if (!scripts || typeof scripts !== 'object') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'scripts object is required' };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(manifestYaml) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'Failed to parse manifest YAML' };
  }

  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST',
      message: 'metadata.name, metadata.version, metadata.description, and metadata.author are required' };
  }

  const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'actions array is required and must not be empty' };
  }
  // Type-check before ANY field is read as a string — see validateManifestShape.
  const shapeErr = validateManifestShape(metadata, actions);
  if (shapeErr) return shapeErr;

  for (const action of actions) {
    if (!scripts[action.script as string]) {
      return { ok: false, status: 400, code: 'MISSING_SCRIPT',
        message: `Script "${action.script as string}" referenced in action "${action.id as string}" not found in scripts object` };
    }
    // Pricing (design: notes doc-r6tyr3o). tollMorsels = anti-abuse burn; commercial = revenue.
    const pricingErr = validateActionPricing(action, action.id as string);
    if (pricingErr) return pricingErr;
  }

  const manifestInstances = manifest.instances as Record<string, unknown> | undefined;
  if (manifestInstances) {
    if (typeof manifestInstances.supported !== 'boolean') {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'instances.supported must be a boolean' };
    }
    if (manifestInstances.config_per_instance !== undefined
      && (typeof manifestInstances.config_per_instance !== 'object' || manifestInstances.config_per_instance === null)) {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'instances.config_per_instance must be an object (JSON Schema)' };
    }
  }

  for (const [scriptKey, scriptContent] of Object.entries(scripts)) {
    const sizeKb = Buffer.byteLength(scriptContent, 'utf8') / 1024;
    if (sizeKb > config.extensionMaxCodeSizeKb) {
      return { ok: false, status: 400, code: 'CODE_TOO_LARGE',
        message: `Script "${scriptKey}" is ${sizeKb.toFixed(1)}KB, max is ${config.extensionMaxCodeSizeKb}KB` };
    }
  }

  // Strip the node's own config keys before anything reads them, so the rest of this function sees
  // only what an installer is allowed to declare. What was removed goes back as a warning: the
  // author learns their manifest lost a key instead of wondering why it has no effect.
  const { config: nodeOwnedStripped, stripped: strippedNodeKeys } =
    stripNodeOwnedConfig(manifest.config as Record<string, unknown> | undefined, installerIsOperator);
  // And a value that arrives already encrypted: only this node mints those, from a plaintext it
  // just encrypted with its own key, so one submitted from outside is either meaningless or a
  // ciphertext taken from somewhere it should not have been.
  const { config: manifestConfig, stripped: strippedEncrypted } = stripClientEncryptedValues(nodeOwnedStripped);
  const strippedConfigKeys = [...strippedNodeKeys, ...strippedEncrypted];
  const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
  const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
  const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;

  const record: ExtensionRecord = {
    name: metadata.name as string,
    // Coerced, not cast: `version: 1.0` is a number in YAML and validateManifestShape allows it.
    version: String(metadata.version),
    description: metadata.description as string,
    author: metadata.author as string,
    status: 'inactive',
    requiredApis: (manifest.required_apis as string[]) ?? [],
    actions: actions.map(a => {
      const commercial = a.commercial as {
        payMorsels?: unknown; payMoney?: unknown; plans?: unknown;
        pricesMoney?: unknown; exchange?: unknown; usageTerms?: unknown;
        provenance?: unknown; odps?: unknown;
      } | undefined;
      type ActionCommercial = NonNullable<ExtensionRecord['actions'][number]['commercial']>;
      return {
        id: a.id as string,
        method: (a.method as string).toUpperCase(),
        path: a.path as string,
        inputSchema: (a.input as Record<string, unknown>) ?? {},
        outputSchema: (a.output as Record<string, unknown>) ?? {},
        scriptContent: scripts[a.script as string],
        // Pricing (validated above; design notes doc-r6tyr3o).
        ...(a.tollMorsels !== undefined ? { tollMorsels: a.tollMorsels as number } : {}),
        ...(commercial ? {
          commercial: {
            payMorsels: (commercial.payMorsels as number | undefined) ?? 0,
            ...(commercial.payMoney !== undefined
              ? { payMoney: commercial.payMoney as { amount: number; currency: string } }
              : {}),
            ...(commercial.plans !== undefined
              ? { plans: commercial.plans as ActionCommercial['plans'] }
              : {}),
            // TARGET-050: the action is the source of truth for its EXCHANGE listing.
            ...(commercial.pricesMoney !== undefined
              ? { pricesMoney: commercial.pricesMoney as ActionCommercial['pricesMoney'] }
              : {}),
            ...(commercial.exchange !== undefined ? { exchange: commercial.exchange === true } : {}),
            ...(commercial.usageTerms !== undefined
              ? { usageTerms: commercial.usageTerms as ActionCommercial['usageTerms'] }
              : {}),
            // ODPS: the action is also the source of its listing's Open Data Product Specification
            // document, so the descriptor travels with the manifest that declares the capability.
            ...(commercial.provenance !== undefined
              ? { provenance: commercial.provenance as ActionCommercial['provenance'] }
              : {}),
            ...(commercial.odps !== undefined
              ? { odps: commercial.odps as ActionCommercial['odps'] }
              : {}),
          },
        } : {}),
      };
    }),
    config: {
      ...(manifestConfig
        ? Object.fromEntries(
            Object.entries(manifestConfig).map(([k, v]) => {
              if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                return [k, (v as Record<string, unknown>).default];
              }
              return [k, v];
            }),
          )
        : {}),
      ...(manifestSchedules ? { __schedules: manifestSchedules } : {}),
      // Record which config fields are `type: 'secret'` so the route can encrypt their values
      // at rest and the runtime can decrypt before the VM (the descriptor type is otherwise
      // lost by the flatten above). See services/extension-secrets.ts.
      ...((): Record<string, unknown> => {
        const secretKeys = computeManifestSecretKeys(manifestConfig);
        return secretKeys.length ? { [SECRET_KEYS_FIELD]: secretKeys } : {};
      })(),
    },
    limits: {
      memoryMb: Math.min((manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb, config.extensionMaxMemoryMb),
      timeoutMs: Math.min((manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs, config.extensionTimeoutMs),
      maxApiCalls: Math.min((manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls, config.extensionMaxApiCalls),
    },
    federation: {
      advertise: (manifestFederation?.advertise as boolean) ?? false,
      capabilities: (manifestFederation?.capabilities as string[]) ?? [],
    },
    ...(manifestInstances?.supported ? {
      instances: {
        supported: true,
        configSchema: (manifestInstances.config_per_instance as Record<string, unknown>) ?? undefined,
      },
    } : {}),
    installedBy,
    installedAt,
  };

  // Non-blocking: the extension installs either way, the author just learns now instead of in
  // production. See SANDBOX_CAPABILITY_WARNINGS.
  const warnings = scanSandboxCapabilityWarnings(scripts);
  if (strippedConfigKeys.length) {
    warnings.push(
      `config: ignored ${strippedConfigKeys.join(', ')} — these keys belong to the node and cannot be `
      + 'set from a manifest. __-prefixed keys are written from the manifest\'s own schedules and '
      + 'secret fields; emailPolicy is granted by the node operator.');
  }
  return warnings.length ? { ok: true, record, warnings } : { ok: true, record };
}
