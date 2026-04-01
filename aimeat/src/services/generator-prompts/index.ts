/**
 * @file index.ts
 * @description Main API for the generator prompt system. Reads prompt templates
 *   from the database (SystemPromptRecord), resolves variables using TypeScript
 *   resolver functions, and returns the final prompt string.
 *
 *   Both the backend autopilot and the frontend API endpoint use this module.
 *   Prompts are editable from the admin dashboard.
 *
 * @structure
 *   - buildPrompt: main function — reads template from DB, resolves variables
 *   - getFragment: reads shared template fragments with caching
 * @usage
 *   import { buildPrompt } from '../services/generator-prompts/index.js';
 *   const prompt = await buildPrompt(storage, 'gen-extension-code', runtimeData);
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial DB-backed prompt builder
 */

import type { Storage } from '../../storage/interface.js';
import type { PromptRuntimeData } from './types.js';
import { substituteVariables } from '../prompt-variables.js';
import { resolvePromptVars } from './resolvers.js';
import { logger } from '../../utils/logger.js';

// ── Fragment cache (shared template pieces like AIMEAT_CONTEXT, SANDBOX_CONSTRAINTS) ──
const fragmentCache = new Map<string, { content: string; expiresAt: number }>();
const FRAGMENT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Read a shared prompt fragment from the database with caching.
 * Fragments are system prompts used as building blocks by other prompts.
 * Example: gen-context (AIMEAT_CONTEXT), gen-sandbox-constraints, gen-disclaimer.
 */
export async function getFragment(storage: Storage, fragmentId: string): Promise<string> {
  const cached = fragmentCache.get(fragmentId);
  if (cached && cached.expiresAt > Date.now()) return cached.content;

  const record = await storage.getSystemPrompt(fragmentId);
  if (!record || !record.active) {
    logger.warn(`Generator fragment "${fragmentId}" not found or inactive`);
    return '';
  }

  fragmentCache.set(fragmentId, { content: record.content, expiresAt: Date.now() + FRAGMENT_TTL });
  return record.content;
}

/** Clear the fragment cache (call after admin edits a prompt) */
export function clearFragmentCache(): void {
  fragmentCache.clear();
}

/**
 * Build a generator prompt from a database template and runtime data.
 *
 * 1. Reads the template from storage.getSystemPrompt(promptId)
 * 2. Reads shared fragments (gen-context, gen-sandbox-constraints, etc.)
 * 3. Calls the appropriate resolver to produce variable values
 * 4. Substitutes {{variables}} in the template
 * 5. Returns the final prompt string
 *
 * @param storage — Storage instance for reading prompts
 * @param promptId — The system prompt ID (e.g., 'gen-extension-code')
 * @param data — Runtime data for variable resolution
 * @returns The fully resolved prompt string
 */
export async function buildPrompt(
  storage: Storage,
  promptId: string,
  data: PromptRuntimeData,
): Promise<string> {
  // 1. Read template from database
  const record = await storage.getSystemPrompt(promptId);
  if (!record) {
    throw new Error(`Generator prompt "${promptId}" not found in database. Run server restart to seed prompts.`);
  }
  if (!record.active) {
    throw new Error(`Generator prompt "${promptId}" is inactive. Enable it from the admin dashboard.`);
  }

  // 2. Read shared fragments that the template may reference
  const fragments: Record<string, string> = {};
  const fragmentIds = ['gen-context', 'gen-disclaimer', 'gen-sandbox-constraints',
    'gen-namespace-rules', 'gen-html-entity-rules', 'gen-extension-consumption-rules'];
  for (const fid of fragmentIds) {
    fragments[fid.replace('gen-', '').replace(/-/g, '_')] = await getFragment(storage, fid);
  }

  // 3. Resolve prompt-specific variables
  const promptVars = await resolvePromptVars(storage, promptId, data, fragments);

  // 4. Merge fragment vars + prompt vars
  const allVars: Record<string, string> = {
    ...fragments,
    ...promptVars,
  };

  // 5. Substitute and return
  const result = substituteVariables(record.content, allVars);

  // Warn if unresolved variables remain (except known cortex template vars that pass through)
  const cortexPassThrough = new Set(['{{node_url}}', '{{metadata.name}}']);
  const unresolved = (result.match(/\{\{[a-z_]+\}\}/g) || []).filter(v => !cortexPassThrough.has(v));
  if (unresolved.length > 0) {
    logger.warn(`Prompt "${promptId}" has unresolved variables: ${unresolved.join(', ')}`);
  }

  return result;
}

// Re-export everything the autopilot and routes need
export { stripCodeblock } from './strip.js';
export { createBundle, formatBundlesForPrompt } from './bundle.js';
export {
  validateExtensionSpec, validateDataApiSpec, validateComponentSpec,
  validateAppDomainSpec, validateSpecAgainstProbe,
} from './spec-validate.js';
export type {
  Blueprint, InterviewSpec, ComponentState, ProbeResult,
  ComponentBundle, PromptRuntimeData,
} from './types.js';
