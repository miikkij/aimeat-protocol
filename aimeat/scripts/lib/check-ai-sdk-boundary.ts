/**
 * @file scripts/lib/check-ai-sdk-boundary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI SDK half of the gate's one-transport rule (check:ai-disclosure, assertion 1),
 *   in its own module so the gate stays below its file-size ceiling, the way the connector checks do.
 *
 *   - `ai` is imported at run time by the gateway alone: a second caller of generateText is a second
 *     place that can skip prepareAiCall and settleAiCall.
 *   - A provider package (`@ai-sdk/*`, `@openrouter/ai-sdk-provider`) is imported at run time by the
 *     adapters alone, so every provider instance is built with `fetch: aiFetch()`.
 *   - `@ai-sdk/gateway` is imported nowhere, adapters included: it is Vercel's hosted gateway.
 *   - The adapters are imported at run time by the gateway (and each other) alone: a model instance
 *     in any other hands can be called directly, with nothing metering it.
 *   - No AI SDK call is handed a string model id: the AI SDK resolves a string through its default
 *     provider, which is Vercel's hosted gateway.
 * @structure
 *   - AI_GATEWAY / AI_ADAPTERS_DIR — the two places the rule names
 *   - runtimeImports() — the modules a source imports at run time
 *   - createAiSdkBoundaryCheck() — the check, over the gate's own walk, strip and fail
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the System 2 gateway (V1 of the plan in
 *     docs/internal/llmproviderintegrations/).
 */
import { join, posix } from 'node:path';

/** The System 2 gateway: the one module that calls the AI SDK's generation functions. */
export const AI_GATEWAY = 'src/services/ai/gateway.ts';
/** The gateway's adapters: the only modules that build provider instances, and the only importers of
 *  the raw transport besides the chokepoint, because only the gateway builds and calls them. */
export const AI_ADAPTERS_DIR = 'src/services/ai/adapters/';
/** The AI SDK functions that send a model call. */
const AI_SDK_CALLS = ['generateText', 'streamText', 'generateImage', 'generateSpeech', 'transcribe', 'embed', 'embedMany', 'generateObject', 'streamObject'];

/** Every module a file imports at run time (`import type` binds nothing and is left out). */
export function runtimeImports(src: string): string[] {
  const out: string[] = [];
  const staticImport = /(?:^|[;\s])(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(staticImport)) if (!m[1]) out.push(m[2]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/**
 * The object literal passed to each AI SDK call in this source, so a check can read the call's own
 * fields. Balanced braces over comment-stripped source; strings were kept by stripComments, and a
 * brace inside one would only make the block longer, never hide a field.
 */
function aiSdkCallArguments(src: string): string[] {
  const blocks: string[] = [];
  const call = new RegExp(`\\b(?:${AI_SDK_CALLS.join('|')})\\s*\\(\\s*\\{`, 'g');
  for (const m of src.matchAll(call)) {
    let depth = 0;
    const start = (m.index ?? 0) + m[0].length - 1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { blocks.push(src.slice(start, i + 1)); break; }
    }
  }
  return blocks;
}

/** The repo-relative path a relative import names, or null for a package import. */
function resolvedImport(fromFile: string, mod: string): string | null {
  if (!mod.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(fromFile), mod));
}

interface CheckContext {
  root: string;
  walk(dir: string): string[];
  stripped(file: string): string;
  rel(file: string): string;
  fail(assertion: string, what: string, fix: string): void;
}

export function createAiSdkBoundaryCheck(context: CheckContext): { check(): void } {
  const { root, walk, stripped, rel, fail } = context;
  return {
    check(): void {
      for (const file of walk(join(root, 'src'))) {
        const r = rel(file);
        const src = stripped(file);
        const inAdapters = r.startsWith(AI_ADAPTERS_DIR);
        for (const mod of runtimeImports(src)) {
          const target = resolvedImport(r, mod);
          if (mod === '@ai-sdk/gateway') {
            fail('llm-transport', `${r} imports @ai-sdk/gateway, Vercel's hosted gateway`,
              'build a model instance through src/services/ai/adapters/ instead; no call from this node goes to a gateway it did not choose.');
          } else if (mod === 'ai' && r !== AI_GATEWAY) {
            fail('llm-transport', `${r} imports the AI SDK outside the gateway`,
              `call ${AI_GATEWAY} (text, image, transcribeAudio) after prepareAiCall, so the call is metered and stamped.`);
          } else if ((mod.startsWith('@ai-sdk/') || mod === '@openrouter/ai-sdk-provider') && !inAdapters) {
            fail('llm-transport', `${r} imports a provider package outside ${AI_ADAPTERS_DIR}`,
              `build provider instances in ${AI_ADAPTERS_DIR}, where every one gets fetch: aiFetch(). A type-only import is fine anywhere.`);
          } else if (target?.startsWith(AI_ADAPTERS_DIR) && r !== AI_GATEWAY && !inAdapters) {
            fail('llm-transport', `${r} imports a model adapter outside the gateway`,
              `ask ${AI_GATEWAY} for the operation instead; a model instance anywhere else can be called with nothing metering it.`);
          }
        }
        for (const args of aiSdkCallArguments(src)) {
          if (/\bmodel\s*:\s*['"`]/.test(args)) {
            fail('llm-transport', `${r} passes a string model id to an AI SDK call`,
              'pass a model INSTANCE from the adapter registry (services/ai/adapters/); a string is resolved by Vercel\'s hosted gateway.');
          }
        }
      }
    },
  };
}
