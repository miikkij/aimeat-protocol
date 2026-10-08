/**
 * @file extension-provider.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An installed extension as an AI provider (System 2 plan, V6; docs/internal/
 *   llmproviderintegrations/08): the checks when the owner saves such a provider, and the runner the
 *   route plan binds into the call's target, which runs the extension's `ai.<op>` action.
 *
 *   THE EXTENSION'S CODE NEVER SEES THE KEY (08, section 4). The owner's key for the provider is
 *   added to the request by ctx.fetch outside the sandbox, and only to a host the manifest lists;
 *   while running as a provider, ctx.fetch reaches no other host at all, and a redirect to another
 *   origin drops the header (safeFetch sensitiveHeaders). The extension must be the owner's own: a
 *   provider naming another owner's extension is refused when saved (403) and when run.
 *
 *   PRICE (08, section 6): the action's own `costUsd`; else the manifest's price for the model times
 *   the use, filled in here, so the gateway reads it as the provider's charge; else the node's
 *   fallback price.
 * @structure CAPABILITY_OP · assertOwnExtensionProvider() · extensionRunner()
 * @version-history
 *   v1.1.0 — 2026-10-08 — An operation the manifest does not list is the node's 400 INVALID_PROVIDER,
 *     not a provider status that a caller would answer as 502 (aiprov plan, A8).
 *   v1.0.0 — 2026-09-28 — Initial (V6 of the System 2 plan).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { AiCompletionError } from './errors.js';
import type { AiCapability, AiOp, ExtensionOpRunner } from './types.js';
import type { AiProvider } from './providers.js';
import { aiProviderDeclarationOf, type ExtensionAiProviderDeclaration } from '../extension-ai-provider-declaration.js';
import { runExtensionActionAsSystem } from '../extension-system-run.js';

/** The action op a capability is served by. */
export const CAPABILITY_OP: Record<AiCapability, AiOp> = {
  text: 'text', vision: 'text', files: 'text', image: 'image', speech: 'speak', transcription: 'transcribe', embed: 'embed',
};

/** The manifest's hosts this node lets the key reach: all of them, or those on the operator's allowlist. */
function reachableHosts(config: AimeatConfig, decl: ExtensionAiProviderDeclaration): string[] {
  return config.aiProviderAllowlist.length ? decl.hosts.filter(h => config.aiProviderAllowlist.includes(h)) : [...decl.hosts];
}

/**
 * Refuse, before it is stored, an extension provider the owner cannot use: an extension that is not
 * installed, is someone else's, declares no ai_provider, lacks an op for a capability turned on, or
 * whose hosts the operator's allowlist leaves out.
 */
export async function assertOwnExtensionProvider(storage: Storage, config: AimeatConfig, ownerGhii: string, p: AiProvider): Promise<void> {
  const name = p.extension ?? '';
  const ext = name ? await storage.getExtension(name) : null;
  if (!ext) throw new AiCompletionError('EXTENSION_NOT_FOUND', 404, `No extension '${name}' is installed on this node. Install it first.`);
  if (ext.installedBy !== localAccountName(ownerGhii)) {
    throw new AiCompletionError('FORBIDDEN', 403, `The extension '${name}' is not yours: an AI provider can only be an extension you installed.`);
  }
  const decl = aiProviderDeclarationOf(ext);
  if (!decl) {
    throw new AiCompletionError('INVALID_PROVIDER', 400, `The extension '${name}' does not declare provides.ai_provider in its manifest, so it cannot serve AI calls.`);
  }
  const missing = (Object.entries(p.capabilities) as Array<[AiCapability, { enabled: boolean }]>)
    .filter(([cap, cfg]) => cfg.enabled && !decl.ops.includes(CAPABILITY_OP[cap] as never))
    .map(([cap]) => `${cap} (needs ai.${CAPABILITY_OP[cap]})`);
  if (missing.length) {
    throw new AiCompletionError('INVALID_PROVIDER', 400,
      `The extension '${name}' does not serve: ${missing.join(', ')}. It declares ${decl.ops.join(', ')}.`, { problems: missing });
  }
  const outside = config.aiProviderAllowlist.length ? decl.hosts.filter(h => !config.aiProviderAllowlist.includes(h)) : [];
  if (outside.length) {
    throw new AiCompletionError('PROVIDER_NOT_ALLOWED', 403,
      `The extension '${name}' sends calls to ${outside.join(', ')}, which this node's AI provider allowlist leaves out. Ask the operator to allow it.`);
  }
}

/** The price the manifest names for this model and this use, when the action reported none. */
function manifestCost(decl: ExtensionAiProviderDeclaration, op: AiOp, model: unknown, r: Record<string, unknown>): number | undefined {
  const price = decl.models.find(m => m.id === model)?.price;
  if (!price) return undefined;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  if (op === 'text') return (n(usage.inputTokens) * (price.inPerMtok ?? 0) + n(usage.outputTokens) * (price.outPerMtok ?? 0)) / 1e6;
  if (op === 'embed') return (n(usage.inputTokens) * (price.inPerMtok ?? 0)) / 1e6;
  if (op === 'image') return price.perImage;
  if (op === 'transcribe' || op === 'speak') return price.perSecond !== undefined ? n(r.durationSeconds) * price.perSecond : undefined;
  return undefined;
}

/** Fill the action's missing charge from the manifest's price, where the gateway reads a reported one. */
function withCost(decl: ExtensionAiProviderDeclaration, op: AiOp, model: unknown, r: Record<string, unknown>): Record<string, unknown> {
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const reported = op === 'text' || op === 'embed' ? usage.costUsd : r.costUsd;
  if (typeof reported === 'number') return r;
  const cost = manifestCost(decl, op, model, r);
  if (cost === undefined) return r;
  return op === 'text' || op === 'embed' ? { ...r, usage: { ...usage, costUsd: cost } } : { ...r, costUsd: cost };
}

/**
 * The runner for one call on this provider, bound to the owner and the key. It runs the extension's
 * `ai.<op>` action as the owner, with the key injected outside the sandbox for the manifest's hosts,
 * and stops the run when the call's signal aborts.
 */
export function extensionRunner(
  storage: Storage, config: AimeatConfig, ownerGhii: string, p: AiProvider, key: string | undefined,
): ExtensionOpRunner {
  return async (op, input, signal) => {
    const name = p.extension ?? '';
    const ext = await storage.getExtension(name);
    const decl = ext ? aiProviderDeclarationOf(ext) : null;
    if (!ext || !decl) throw Object.assign(new Error(`The extension '${name}' is gone or no longer declares provides.ai_provider.`), { status: 503 });
    // The node's own refusal (the manifest does not list the operation), never a provider status.
    if (!decl.ops.includes(op as never)) throw new AiCompletionError('INVALID_PROVIDER', 400, `The extension '${name}' does not serve ai.${op}.`);
    const inject = key ? (decl.authHeader ? { name: decl.authHeader, value: key } : { name: 'Authorization', value: `Bearer ${key}` }) : undefined;
    let result: unknown;
    try {
      const out = await runExtensionActionAsSystem({ storage, config }, {
        extensionName: name, actionId: `ai.${op}`, input,
        callerGaii: ownerGhii, ownerName: localAccountName(ownerGhii), storageOwnerGhii: ownerGhii,
        logLabel: `ai-provider:${p.id}`, producerKind: 'extension',
        providerCall: { hosts: reachableHosts(config, decl), ...(inject ? { inject } : {}) },
        ...(signal ? { signal } : {}),
      });
      result = out.result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A run that ran out of time is a timeout, which the owner's rules may move past; anything else
      // the extension threw is the provider failing.
      const timedOut = /interrupted|timed out|timeout/i.test(msg);
      throw Object.assign(new Error(`The extension '${name}' failed on ai.${op}: ${msg.slice(0, 300)}`), { status: signal?.aborted ? 499 : timedOut ? 504 : 502 });
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw Object.assign(new Error(`The extension '${name}' answered ai.${op} with no result object.`), { status: 502 });
    }
    return withCost(decl, op, input.model, result as Record<string, unknown>);
  };
}
