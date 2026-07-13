/**
 * @file resolvers.ts
 * @description Per-prompt variable resolver functions. Each resolver takes typed
 *   runtime data and produces Record<string, string> for template substitution.
 *
 *   The resolver does the heavy lifting: filtering dataModel entries, formatting
 *   JSON structures, building context from completed components, injecting specs.
 *   The DB template just has {{variable}} placeholders.
 *
 *   The individual resolvers live in sibling modules (resolvers-spec, resolvers-cortex,
 *   resolvers-fix, resolvers-test, resolvers-blueprint) with shared helpers in
 *   resolver-helpers; this file keeps the master dispatcher.
 *
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial resolvers for DB-backed generator prompts
 *   v1.1.0 — 2026-06-20 — App build: prepend H-2 app-origin isolation guidance to the
 *     cortex_or_api_section (no ambient session; private data via the app-grant PKCE flow).
 *   v1.2.0 — 2026-07-13 — Split per-prompt resolvers into sibling modules (max-file-lines)
 */

import type { Storage } from '../../storage/interface.js';
import type { PromptRuntimeData } from './types.js';
import type { Vars } from './resolver-helpers.js';
import {
  resolveExtensionSpec,
  resolveDataApiSpec,
  resolveComponentSpec,
  resolveAppDomainSpec,
  resolveSimpleComponent,
  resolveTranslation,
  resolveExtensionCode,
} from './resolvers-spec.js';
import {
  resolveCortexData,
  resolveCortexComponent,
  resolveCortexAppDomain,
  resolveAppSpec,
  resolveApp,
} from './resolvers-cortex.js';
import {
  resolveReflection,
  resolveFreshGeneration,
  resolveFix,
} from './resolvers-fix.js';
import {
  resolveTestExtensionSpec,
  resolveTestCortexSpec,
  resolveTestCortexComponent,
  resolveTestCortexAppDomain,
  resolveTestApp,
} from './resolvers-test.js';
import {
  resolveBlueprint,
  resolveInterview,
} from './resolvers-blueprint.js';

/**
 * Master resolver — dispatches to the appropriate per-prompt resolver.
 */
export async function resolvePromptVars(
  storage: Storage,
  promptId: string,
  data: PromptRuntimeData,
  fragments: Record<string, string>,
): Promise<Vars> {
  const resolverMap: Record<string, (d: PromptRuntimeData, f: Record<string, string>) => Vars | Promise<Vars>> = {
    'gen-extension-spec': resolveExtensionSpec,
    'gen-data-api-spec': resolveDataApiSpec,
    'gen-component-spec': resolveComponentSpec,
    'gen-app-domain-spec': resolveAppDomainSpec,
    'gen-csm': resolveSimpleComponent,
    'gen-memory': resolveSimpleComponent,
    'gen-translation': resolveTranslation,
    'gen-extension-code': resolveExtensionCode,
    'gen-cortex-data': resolveCortexData,
    'gen-cortex-component': resolveCortexComponent,
    'gen-cortex-app-domain': resolveCortexAppDomain,
    'gen-app-spec': resolveAppSpec,
    'gen-app': resolveApp,
    'gen-reflection': resolveReflection,
    'gen-fresh-generation': resolveFreshGeneration,
    'gen-fix': resolveFix,
    'gen-test-extension-spec': resolveTestExtensionSpec,
    'gen-test-cortex-spec': resolveTestCortexSpec,
    'gen-test-cortex-component': resolveTestCortexComponent,
    'gen-test-cortex-app-domain': resolveTestCortexAppDomain,
    'gen-test-app': resolveTestApp,
    'gen-blueprint': resolveBlueprint,
    'gen-interview': resolveInterview,
  };

  const resolver = resolverMap[promptId];
  if (!resolver) {
    // No resolver = no dynamic variables (static prompt)
    return {};
  }
  return resolver(data, fragments);
}
