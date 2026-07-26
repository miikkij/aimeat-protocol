/**
 * @file src/routes/extensions/manifest.ts
 * @description Shared extension-manifest validator/builder — validates a YAML manifest + scripts map
 *   and builds the ExtensionRecord it describes. Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-07-17 — Per-action pricing: validate + carry `tollMorsels` (anti-abuse burn) and
 *     `commercial` {payMorsels, payMoney} for priced raw calls (design notes doc-r6tyr3o, C1/M1)
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { ExtensionRecord } from '../../storage/interface.js';
import { parse as parseYaml } from 'yaml';
import { SECRET_KEYS_FIELD, computeManifestSecretKeys } from '../../services/extension-secrets.js';
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
export function buildExtensionRecordFromManifest(
  manifestYaml: string | undefined,
  scripts: Record<string, string> | undefined,
  config: AimeatConfig,
  installedBy: string,
  installedAt: string,
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
  for (const action of actions) {
    if (!action.id || !action.method || !action.path || !action.script) {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'Each action must have id, method, path, and script fields' };
    }
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

  const manifestConfig = manifest.config as Record<string, unknown> | undefined;
  const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
  const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
  const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;

  const record: ExtensionRecord = {
    name: metadata.name as string,
    version: metadata.version as string,
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
  return warnings.length ? { ok: true, record, warnings } : { ok: true, record };
}
