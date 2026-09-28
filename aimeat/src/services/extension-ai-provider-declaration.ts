/**
 * @file src/services/extension-ai-provider-declaration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The manifest's `provides.ai_provider` declaration as it is stored on an extension
 *   record, and the one reader of it. An extension that declares it can serve as an AI provider of
 *   type `extension`: the AI gateway calls its `ai.<op>` actions through
 *   services/extension-system-run.ts, with ctx.fetch limited to the declared hosts and the owner's
 *   provider key added to the request outside the sandbox (services/extension-ctx.ts).
 *
 *   A LEAF module on purpose, like services/extension-workspace-declaration.ts: the manifest builder
 *   (services/extension-manifest.ts) and the AI provider code both need only this, and an import of
 *   either from the other closes an import cycle through the manifest module that dependency-cruiser
 *   refuses.
 * @structure ExtensionAiOp · EXTENSION_AI_OPS · ExtensionAiProviderDeclaration ·
 *   AI_PROVIDER_DECLARATION_KEY · AI_OP_ACTION_PREFIX · aiProviderDeclarationOf()
 * @usage
 *   const decl = aiProviderDeclarationOf(ext);          // ExtensionAiProviderDeclaration | null
 *   const actionId = `${AI_OP_ACTION_PREFIX}${op}`;      // 'ai.text'
 * @version-history
 *   v1.0.0 — 2026-09-28 — System 2 plan, V6: initial.
 */
import type { ExtensionRecord } from '../storage/interface.js';

/** The operations an extension can serve as an AI provider. */
export type ExtensionAiOp = 'text' | 'image' | 'speak' | 'transcribe' | 'embed';

/** Every ExtensionAiOp, in one list the manifest validation reads. */
export const EXTENSION_AI_OPS: readonly ExtensionAiOp[] = ['text', 'image', 'speak', 'transcribe', 'embed'];

/** The normalized declaration (camelCase), as the manifest builder stores it. */
export interface ExtensionAiProviderDeclaration {
  ops: ExtensionAiOp[];
  models: Array<{
    id: string;
    name: string;
    caps?: Record<string, boolean>;
    price?: { inPerMtok?: number; outPerMtok?: number; perImage?: number; perSecond?: number };
  }>;
  /** One sentence on where the data goes, shown to the owner before the provider is added. */
  dataStatement: string;
  /** Bare lowercase hostnames, e.g. api.example-ai.com. ctx.fetch reaches only these in a provider run. */
  hosts: string[];
  /** Header name for the key; absent = `Authorization: Bearer <key>`. */
  authHeader?: string;
}

/** The config key the manifest builder writes the declaration to. `__`-prefixed, so a manifest's own
 *  `config:` block cannot set it (stripNodeOwnedConfig in services/extension-manifest.ts removes
 *  every `__` key before the record is built). */
export const AI_PROVIDER_DECLARATION_KEY = '__aiProvider';

/** Op `text` is served by the action with id `ai.text`, and so on for each op. */
export const AI_OP_ACTION_PREFIX = 'ai.';

/**
 * The declaration on an installed extension, or null when the manifest declared none. The stored
 * value was validated at install; this reader checks only the shape it hands on, so a record edited
 * by hand in the database cannot give the caller a non-list where it expects a list.
 */
export function aiProviderDeclarationOf(ext: Pick<ExtensionRecord, 'config'>): ExtensionAiProviderDeclaration | null {
  const raw = ext.config?.[AI_PROVIDER_DECLARATION_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.ops) || !Array.isArray(d.models) || !Array.isArray(d.hosts)) return null;
  if (typeof d.dataStatement !== 'string') return null;
  const ops = d.ops.filter((o): o is ExtensionAiOp => (EXTENSION_AI_OPS as readonly unknown[]).includes(o));
  const hosts = d.hosts.filter((h): h is string => typeof h === 'string').map(h => h.toLowerCase());
  if (!ops.length || !hosts.length) return null;
  return {
    ops,
    models: d.models as ExtensionAiProviderDeclaration['models'],
    dataStatement: d.dataStatement,
    hosts,
    ...(typeof d.authHeader === 'string' ? { authHeader: d.authHeader } : {}),
  };
}
