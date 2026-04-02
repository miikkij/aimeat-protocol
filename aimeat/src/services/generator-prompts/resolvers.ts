/**
 * @file resolvers.ts
 * @description Per-prompt variable resolver functions. Each resolver takes typed
 *   runtime data and produces Record<string, string> for template substitution.
 *
 *   The resolver does the heavy lifting: filtering dataModel entries, formatting
 *   JSON structures, building context from completed components, injecting specs.
 *   The DB template just has {{variable}} placeholders.
 *
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial resolvers for DB-backed generator prompts
 */

import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/** Log a loud warning when a resolver variable falls back to a default value.
 *  This means the blueprint/interview data is missing or the filter didn't match. */
function warnFallback(promptId: string, varName: string, fallbackValue: string): string {
  logger.error(`[RESOLVER FALLBACK] ⚠️⚠️⚠️ ${promptId} → {{${varName}}} used FALLBACK: "${fallbackValue.slice(0, 80)}" — DATA IS MISSING, PROMPT WILL BE DEGRADED`);
  return fallbackValue;
}
import type {
  PromptRuntimeData, Blueprint, BlueprintComponent, InterviewSpec,
  ComponentState, DataSource,
} from './types.js';
import { formatBundlesForPrompt, createBundle } from './bundle.js';
import { getFragment } from './index.js';

type Vars = Record<string, string>;

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
    'gen-app': resolveApp,
    'gen-reflection': resolveReflection,
    'gen-fresh-generation': resolveFreshGeneration,
    'gen-fix': resolveFix,
    'gen-test-extension-spec': resolveTestExtensionSpec,
    'gen-test-cortex-spec': resolveTestCortexSpec,
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

// ── Helper functions ──

function formatDataSources(dataSources: DataSource[] | undefined): string {
  if (!dataSources || dataSources.length === 0) return warnFallback('helper', 'data_sources', 'No data sources specified.');
  return dataSources.map(ds => {
    const lines: string[] = [`- **${ds.name}**: ${ds.url || 'user-input'}`];
    if (ds.responseEnvelope) {
      lines.push(`  Response envelope: \`${typeof ds.responseEnvelope === 'string' ? ds.responseEnvelope : JSON.stringify(ds.responseEnvelope)}\``);
    }
    if (ds.sampleEntry) {
      lines.push(`  Sample entry:\n\`\`\`json\n${typeof ds.sampleEntry === 'string' ? ds.sampleEntry : JSON.stringify(ds.sampleEntry, null, 2)}\n\`\`\``);
    }
    if (ds.sampleResponse) {
      const text = typeof ds.sampleResponse === 'string' ? ds.sampleResponse : JSON.stringify(ds.sampleResponse, null, 2);
      lines.push(`  Sample response:\n\`\`\`json\n${text.slice(0, 2000)}\n\`\`\``);
    }
    if (ds.notes) lines.push(`  Notes: ${ds.notes}`);
    return lines.join('\n');
  }).join('\n\n');
}

function formatStructures(structures: Record<string, unknown> | undefined): string {
  if (!structures || Object.keys(structures).length === 0) return warnFallback('helper', 'structures', 'No structures defined.');
  return Object.entries(structures).map(([name, schema]) =>
    `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
  ).join('\n\n');
}

function formatSpec(spec: Record<string, unknown> | undefined | null, label: string): string {
  if (!spec) return '';
  return `\n## ${label} (formal contract — your code MUST match this exactly)\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n`;
}

function formatUseCases(useCases: unknown[] | undefined): string {
  if (!useCases || useCases.length === 0) return 'Not specified.';
  return useCases.map((uc, i) => {
    if (typeof uc === 'string') return `${i + 1}. ${uc}`;
    const obj = uc as Record<string, string>;
    return `${i + 1}. ${obj.description || obj.title || JSON.stringify(uc)}`;
  }).join('\n');
}

function formatCompletedContext(completedComponents: ComponentState[] | undefined): string {
  if (!completedComponents || completedComponents.length === 0) return '';
  const withSpecs = completedComponents.filter(c => c.spec);
  const withoutSpecs = completedComponents.filter(c => !c.spec);

  let context = '';
  for (const c of withSpecs) {
    const specLabel = c.type === 'extension' ? `Extension Spec: ${(c.spec as Record<string, string>)?.name || c.label}`
      : c.subtype === 'data' ? `Data API Spec: ${(c.spec as Record<string, string>)?.name || c.label}`
      : c.subtype === 'component' ? `Component Spec: ${(c.spec as Record<string, string>)?.name || c.label}`
      : `Spec: ${c.label}`;
    context += formatSpec(c.spec, specLabel);
  }

  const bundles = withoutSpecs
    .filter(c => c.contextBundle)
    .map(c => c.contextBundle!);
  if (bundles.length > 0) {
    context += formatBundlesForPrompt(bundles);
  }

  const unbundled = withoutSpecs.filter(c => !c.contextBundle);
  if (unbundled.length > 0) {
    context += '\nAlready completed:\n';
    for (const c of unbundled) {
      context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
    }
  }

  return context;
}

// ── Per-prompt resolvers ──

function resolveExtensionSpec(data: PromptRuntimeData): Vars {
  const bp = data.blueprint;
  const bpComp = data.blueprintComponent;
  const interview = data.interviewSpec;
  const actions = bp.dataModel?.actions || {};
  const memoryKeys = bp.dataModel?.memoryKeys || {};

  // Filter actions by component field OR by key prefix (ext: for extensions, cortex: for cortex)
  // Blueprint generator sometimes doesn't populate the component field, so we fall back to prefix matching
  const compPrefix = bpComp?.type === 'extension' ? 'ext:' : bpComp?.type === 'cortex' ? 'cortex:' : '';
  const compActions = Object.entries(actions)
    .filter(([key, v]) => v.component === bpComp?.id || (compPrefix && key.startsWith(compPrefix)))
    .map(([name, def]) => `- **${name.replace(/^ext:/, '').replace(/^cortex:/, '').replace(/^[^/]+\//, '')}**: ${def.description || ''}\n  Input: \`${JSON.stringify(def.input || {})}\`\n  Output: \`${JSON.stringify(def.output || {})}`)
    .join('\n');

  const compMemoryKeys = Object.entries(memoryKeys)
    .filter(([, v]) => v.producedBy === bpComp?.id || v.consumedBy?.includes(bpComp?.id || ''))
    .map(([key, def]) => `- \`${key}\` (${def.producedBy === bpComp?.id ? 'writes' : 'reads'}): ${def.description || ''}`)
    .join('\n');

  const schedules = bpComp?.schedules || [];
  const settingsArr = [
    ...(Array.isArray(bp.settings) ? bp.settings : []),
    ...(bp.settings?.service || []),
    ...(bp.settings?.user || []),
  ];

  return {
    data_sources: formatDataSources(interview?.dataSources),
    blueprint_actions: compActions || warnFallback('gen-extension-spec', 'blueprint_actions', 'Infer from data sources.'),
    structures: formatStructures(bp.dataModel?.structures),
    memory_keys: compMemoryKeys || warnFallback('gen-extension-spec', 'memory_keys', 'Infer from actions.'),
    schedules: schedules.length > 0
      ? schedules.map(s => `- ${s.action}: ${s.cron} — ${s.description || ''}`).join('\n')
      : 'None. Add @activate init if the extension needs initialization.',
    config_keys: settingsArr.length > 0
      ? settingsArr.map(s => `- ${(s as Record<string, string>).key} (${(s as Record<string, string>).type || 'string'}): ${(s as Record<string, string>).label || (s as Record<string, string>).key}`).join('\n')
      : 'None.',
  };
}

function resolveDataApiSpec(data: PromptRuntimeData): Vars {
  // Extract blueprint's produces: api:* method names for the cortex-data component
  const dataCortexComp = data.blueprint.components?.find(c => c.type === 'cortex' && c.subtype === 'data');
  const blueprintMethods = (dataCortexComp?.produces || [])
    .filter((p: string) => p.startsWith('api:'))
    .map((p: string) => p.replace('api:', ''));
  const blueprintMethodsStr = blueprintMethods.length > 0
    ? blueprintMethods.map((m: string) => `- ${m}`).join('\n')
    : warnFallback('gen-data-api-spec', 'blueprint_methods', 'No api: methods found in blueprint.');

  return {
    extension_spec: JSON.stringify(data.extensionSpec || {}, null, 2),
    structures: formatStructures(data.blueprint.dataModel?.structures),
    blueprint_methods: blueprintMethodsStr,
  };
}

function resolveComponentSpec(data: PromptRuntimeData): Vars {
  return {
    data_api_spec: JSON.stringify(data.dataApiSpec || {}, null, 2),
    component_label: data.componentLabel || '',
    view_context: data.viewDefinition ? (typeof data.viewDefinition === 'string' ? data.viewDefinition : JSON.stringify(data.viewDefinition)) : '',
    translation_keys: (data.translationKeys || []).slice(0, 30).map(k => `\`${k}\``).join(', ') +
      ((data.translationKeys || []).length > 30 ? ` ... and ${(data.translationKeys || []).length - 30} more` : ''),
  };
}

function resolveAppDomainSpec(data: PromptRuntimeData): Vars {
  return {
    component_specs: (data.componentSpecs || []).map(cs =>
      `### ${(cs as Record<string, string>).name}\n\`\`\`json\n${JSON.stringify(cs, null, 2)}\n\`\`\``
    ).join('\n\n'),
    data_api_spec: JSON.stringify(data.dataApiSpec || {}, null, 2),
    use_cases: formatUseCases(data.useCases),
    views: (data.views || []).map((v: unknown) => {
      const view = v as Record<string, unknown>;
      return `- **${view.title}** (${view.type || 'page'}): ${view.description || ''}`;
    }).join('\n'),
    translation_keys: (data.translationKeys || []).slice(0, 20).map(k => `\`${k}\``).join(', ') +
      ((data.translationKeys || []).length > 20 ? ` ... and ${(data.translationKeys || []).length - 20} more` : ''),
  };
}

function resolveSimpleComponent(data: PromptRuntimeData): Vars {
  return {
    label: data.componentLabel || '',
    component_context: buildContextString(data),
  };
}

function resolveTranslation(data: PromptRuntimeData): Vars {
  const vars = resolveSimpleComponent(data);
  // If another translation is already done, inject its keys
  const otherTranslations = (data.completedComponents || []).filter(c => c.type === 'translation' && c.contextBundle?.keys);
  if (otherTranslations.length > 0) {
    const keys = otherTranslations[0].contextBundle!.keys!;
    vars.matching_keys_section = `\n## REQUIRED: Match these EXACT keys from the other locale\nThe other locale has these ${keys.length} keys. You MUST use the SAME keys:\n\`\`\`\n${keys.join('\n')}\n\`\`\`\nDo NOT add extra keys and do NOT omit any keys.\n`;
  } else {
    vars.matching_keys_section = '';
  }
  return vars;
}

function resolveExtensionCode(data: PromptRuntimeData): Vars {
  // Build explicit required action IDs from blueprint (prevents LLM from renaming them)
  let requiredActions = '';
  if (data.blueprint.testScenarios) {
    const bpComp = data.blueprint.components?.find(c => c.type === 'extension');
    if (bpComp) {
      const actionIds = (data.blueprint.testScenarios || [])
        .filter(ts => ts.component === bpComp.id)
        .flatMap(ts => (ts.scenarios || []).map(s => s.action));
      if (actionIds.length > 0) {
        requiredActions = `\n## REQUIRED ACTION IDs (from blueprint — use these EXACT names)\n\n╔══════════════════════════════════════════════════════════════════════════╗\n║  Your actions array MUST use these EXACT id values. Do NOT rename them. ║\n╚══════════════════════════════════════════════════════════════════════════╝\n\n${actionIds.map(id => `- id: ${id}`).join('\n')}\n`;
      }
    }
  }
  return {
    label: data.componentLabel || '',
    spec_section: (data.selfSpec ? formatSpec(data.selfSpec, 'YOUR SPEC — implement this contract exactly') : '') + requiredActions,
    completed_context: formatCompletedContext(data.completedComponents),
  };
}

function resolveCortexData(data: PromptRuntimeData): Vars {
  // Match browser buildDataCortexPrompt() — produce same variable content
  const bp = data.blueprint;
  const actions = bp.dataModel?.actions || {};
  const cortexActions = Object.entries(actions)
    .filter(([key]) => key.startsWith('cortex:'))
    .map(([key, def]) => ({ method: key.replace('cortex:', ''), ...def }));

  const methodsExport = cortexActions.length > 0
    ? cortexActions.map(a => {
        const inputKeys = Object.keys((a as Record<string, unknown>).input as Record<string, unknown> || {}).join(', ');
        const outputRef = ((a as Record<string, unknown>).output as Record<string, string>)?.$ref || JSON.stringify((a as Record<string, unknown>).output || 'any');
        return `- **${a.method}**(${inputKeys}) → returns ${outputRef}`;
      }).join('\n')
    : warnFallback('gen-cortex-data', 'methods_to_export', 'Infer from extension actions and data model.');

  // Build extension section matching browser: name, actions, probe results, callExt hint
  const extComp = (data.completedComponents || []).find(c => c.type === 'extension');
  const extBundle = extComp?.contextBundle;
  let extensionSection: string;
  if (extBundle) {
    const probes = (extBundle.probeResults || extComp?.probeResults || []) as Array<Record<string, unknown>>;
    extensionSection = `\n## Extension (this cortex wraps it)\n\nExtension name: ${extBundle.registeredAs || ''}\nActions: ${(extBundle.actions || []).join(', ') || 'none'}\n`;
    if (probes.length > 0) {
      extensionSection += '\n### Actual responses from live probes:\n';
      for (const p of probes) extensionSection += `${p.action}(${JSON.stringify(p.input)}) → ${JSON.stringify(p.response).substring(0, 500)}\n`;
    }
    extensionSection += `\nUse callExt('${extBundle.registeredAs || ''}', actionId, body) for extension calls.\nsession.fetch returns ALREADY-PARSED JSON — use resp.data, never resp.json().\n`;
  } else {
    extensionSection = '\n## No Extension\n\nThis data cortex uses AIMEAT platform libraries directly (no extension needed).\n';
  }

  // Inject spec name and libName so the code uses the EXACT names from the spec
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  const specName = (spec?.name as string) || '';
  const specLibName = (spec?.libName as string) || '';
  let specSection = '';
  if (spec) {
    specSection = `\n## YOUR SPEC — use these EXACT names\n\n╔══════════════════════════════════════════════════════════════════════════╗\n║  metadata.name MUST be: ${specName}                                     \n║  LIB_NAME MUST be: ${specLibName}                                       \n║  These come from the spec. Do NOT use the component label as the name. ║\n╚══════════════════════════════════════════════════════════════════════════╝\n\nFull spec:\n\`\`\`json\n${JSON.stringify(spec, null, 2).slice(0, 3000)}\n\`\`\`\n`;
  }

  return {
    label: data.componentLabel || warnFallback('gen-cortex-data', 'label', ''),
    project_description: data.projectDescription || warnFallback('gen-cortex-data', 'project_description', ''),
    structures: formatStructures(bp.dataModel?.structures),
    methods_to_export: methodsExport,
    extension_section: extensionSection,
    spec_section: specSection,
  };
}

function resolveCortexComponent(data: PromptRuntimeData): Vars {
  // Match browser buildFeatureCortexPrompt() — use case, view, structures, data cortex API
  const interview = data.interviewSpec;
  const bpComp = data.blueprintComponent;
  const labelLower = (data.componentLabel || '').toLowerCase();

  // Use case
  let useCase = 'No specific use case provided';
  if (interview?.useCases) {
    const match = (interview.useCases as Array<Record<string, string>>).find(u =>
      labelLower.includes((u.title || '').toLowerCase().split(' ')[0]));
    if (match) useCase = `**${match.title}** [${match.priority || 'medium'}]: ${match.description || ''}`;
  }

  // View
  let viewSection = 'No specific view provided';
  if (interview?.views) {
    const match = (interview.views as Array<Record<string, unknown>>).find(v =>
      labelLower.includes(((v.title as string) || '').toLowerCase().split(' ')[0]));
    if (match) {
      viewSection = `**${match.title}** (${match.type || 'page'}): ${match.description || ''}`;
      if (Array.isArray(match.interactions)) viewSection += `\nInteractions: ${(match.interactions as string[]).join(', ')}`;
    }
  }

  // Structures
  const structures = data.blueprint.dataModel?.structures || {};
  const structuresText = Object.entries(structures).map(([name, schema]) =>
    `**${name}**: ${JSON.stringify(schema, null, 2)}`).join('\n\n') || 'See data cortex API for available data.';

  // Data cortex API with probe results
  const dataCortex = (data.completedComponents || []).find(c => c.type === 'cortex' && c.subtype === 'data');
  const dcBundle = dataCortex?.contextBundle;
  let dataCortexApi = '';
  if (dcBundle) {
    dataCortexApi = `\n## Data Cortex API (use this for all data access)\n\nAccess via: AIMEAT.${dcBundle.libName || dcBundle.registeredAs || ''}\nMethods: ${(dcBundle.exports || []).join(', ')}\n`;
    const probes = (dcBundle.probeResults || dataCortex?.probeResults || []) as Array<Record<string, unknown>>;
    for (const p of probes) dataCortexApi += `${p.method || p.action}(${JSON.stringify(p.input || {})}) → ${JSON.stringify(p.response).substring(0, 400)}\n`;
  }

  // Translation
  const tk = data.translationKeys || [];
  const translationSection = tk.length > 0
    ? `\n## Translation Keys (use these exact keys)\n\n${tk.map(k => '- `' + k + '`').join('\n')}\n`
    : '';

  return {
    label: data.componentLabel || '',
    use_case: useCase,
    view_section: viewSection,
    structures: structuresText,
    data_cortex_api: dataCortexApi,
    translation_section: translationSection,
  };
}

function resolveCortexAppDomain(data: PromptRuntimeData): Vars {
  // Match browser buildAppDomainCortexPrompt() — feature APIs, data cortex, translation keys
  const featureComps = (data.completedComponents || []).filter(c =>
    c.type === 'cortex' && (c.subtype === 'component' || c.subtype === 'feature'));
  const featureApis = featureComps.map(c => {
    const b = c.contextBundle;
    return `\n### ${b?.name || c.label}\nRegistered as: ${b?.registeredAs || c.registeredAs || ''}\nAccess via: AIMEAT.${b?.libName || c.registeredAs || ''}\nExports: ${(b?.exports || []).join(', ')}\n`;
  }).join('\n');

  const dataCortex = (data.completedComponents || []).find(c => c.type === 'cortex' && c.subtype === 'data');
  const dcBundle = dataCortex?.contextBundle;
  const dataCortexSection = dcBundle
    ? `\nAccess via: AIMEAT.${dcBundle.libName || dcBundle.registeredAs || ''}\nMethods: ${(dcBundle.exports || []).join(', ')}\n`
    : 'No data cortex available';

  const translationComp = (data.completedComponents || []).find(c => c.type === 'translation' && c.contextBundle?.keys);
  const translationKeys = translationComp?.contextBundle?.keys?.slice(0, 30).join(', ') || 'none available';

  return {
    label: data.componentLabel || '',
    project_description: data.projectDescription || '',
    feature_apis: featureApis,
    data_cortex_section: dataCortexSection,
    translation_keys: translationKeys,
  };
}

function resolveApp(data: PromptRuntimeData): Vars {
  const appDomainSpec = (data.completedComponents || [])
    .find(c => c.subtype === 'app-domain' && c.spec)?.spec;

  // Build cortex script loads and instructions (matches browser buildComponentPrompt logic)
  const cortexComponents = (data.completedComponents || []).filter(c => c.type === 'cortex');
  let cortexScriptLoads = '';
  let cortexInstructions = '';

  if (cortexComponents.length > 0) {
    const cortexLibs = cortexComponents.map(c => {
      const libName = c.registeredAs || c.label;
      return { name: libName, label: c.label, result: c.result };
    });

    cortexScriptLoads = cortexLibs.map(lib =>
      `    await loadScript('/v1/cortex/${lib.name}/libs/${lib.name}.js');`
    ).join('\n');

    // Extract method names from cortex code
    const extractedMethods: string[] = [];
    for (const lib of cortexLibs) {
      const libNameMatch = (lib.result as string)?.match?.(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
      const camelName = libNameMatch ? libNameMatch[1] : lib.name.replace(/-([a-z0-9])/g, (_: string, ch: string) => ch.toUpperCase());
      const exportsMatch = (lib.result as string)?.match?.(/(?:const|let|var)\s+\w*[Ee]xport\w*\s*=\s*\{([\s\S]*?)\}/);
      if (exportsMatch) {
        const methods = exportsMatch[1].split(',').map((m: string) => m.trim().split(':')[0].trim()).filter(Boolean);
        for (const m of methods) {
          extractedMethods.push(`- \`AIMEAT.${camelName}.${m}()\``);
        }
      }
    }

    cortexInstructions = `
## CORTEX LIBRARIES (use these — do NOT call extensions or memory directly)

This project has Cortex libraries that wrap all extension APIs into clean domain methods.
Load them via <script> tags and use their API.

${cortexLibs.map(lib => `### ${lib.label}
Load: \`<script src="/v1/cortex/${lib.name}/libs/${lib.name}.js"></script>\`
`).join('\n')}

${extractedMethods.length > 0 ? `### AVAILABLE CORTEX METHODS (extracted from actual code — use ONLY these):
${extractedMethods.join('\n')}

Do NOT call any method not in this list. Do NOT rename these methods.` : ''}

RULES:
- Call \`AIMEAT.{libName}.init()\` on app start (libName is camelCase of cortex name)
- Use cortex methods for ALL data access — never call extensions or memory directly
- NEVER call internal functions like callExt(), readExtMemory() — these are PRIVATE
- NEVER build retry loops — show an error message on failure, do NOT auto-retry
- Use EXACTLY the method names and return value shapes shown above

### AIMEAT Platform UI Libraries (load BEFORE your domain cortex)

\`\`\`html
<script src="/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js"></script>
<script src="/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js"></script>
<script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
<script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
<script src="/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js"></script>
\`\`\`

Use these instead of raw HTML: \`Tabs\` for navigation, \`DataTable\` for tables, \`Input/Select/Toggle\` for forms, \`toast/Modal/Confirm\` for dialogs (never use native alert/confirm/prompt).
`;
  }

  // Build translation keys section
  const translationKeys = data.translationKeys || [];
  let translationKeysSection = '';
  if (translationKeys.length > 0) {
    const sorted = [...translationKeys].sort();
    translationKeysSection = `
## AVAILABLE TRANSLATION KEYS (from registered translation components — use EXACTLY these)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your app MUST use these EXACT keys when calling t(key, translations). ║
║  Do NOT invent your own keys like "field.name" or "detail.addresses".  ║
║  The translation components have ALREADY defined these keys.           ║
╚══════════════════════════════════════════════════════════════════════════╝

${sorted.map(k => '- \`' + k + '\`').join('\n')}

Total: ${sorted.length} keys available. If you need a label, find the closest matching key from this list.
`;
  }

  // Build the conditional cortex-or-api section (browser has hasCortex conditional)
  const hasCortex = cortexComponents.length > 0;
  let cortexOrApiSection: string;
  if (hasCortex) {
    cortexOrApiSection = cortexInstructions;
  } else {
    // Non-cortex path — verbatim from browser base.js lines 642-703
    cortexOrApiSection = `### AIMEAT.data API (memory read/write — handles auth and envelope automatically):
\`\`\`javascript
// Read YOUR OWN memory key — returns the stored value directly, or null
const myData = await AIMEAT.data.get('my.settings');

// Write a memory key (your own namespace)
await AIMEAT.data.set('my.key', { count: 42 });

// Delete your own memory key
await AIMEAT.data.delete('my.key');
\`\`\`

### Reading EXTENSION-produced data (CRITICAL — most apps need this):
Extensions store data in their OWN namespace (\`ext:{extension-name}\`).
To read data that an extension wrote, use \`getPublic()\`:
\`\`\`javascript
// WRONG — this reads YOUR memory, not the extension's:
const data = await AIMEAT.data.get('items.by-date.__index');  // returns null!

// CORRECT — read from the extension's namespace:
const data = await AIMEAT.data.getPublic('ext:my-collector-extension', 'items.by-date.__index');
\`\`\`
The first argument is the extension's memory owner: \`"ext:" + extensionName\` (the \`name\` field from the extension manifest metadata).
Use this for ALL data produced by extensions (collected data, computed stats, caches, etc.).
\`getPublic()\` returns the value directly (auto-unwraps), or null if not found.

### Reading TRANSLATIONS (stored in owner namespace by translation components):
Translations are stored in the OWNER's namespace by the translation component during registration.
The key format is: \`{service-name}.i18n.{locale}\` (e.g. \`my-service.i18n.fi\`).
\`\`\`javascript
// Read translations from OWNER namespace (the translation component stored them here):
const fiStrings = await AIMEAT.data.get('my-service.i18n.fi') || await AIMEAT.data.get('i18n.fi') || {};
const enStrings = await AIMEAT.data.get('my-service.i18n.en') || await AIMEAT.data.get('i18n.en') || {};
\`\`\`
Use AIMEAT.data.get() — this reads from the current user's namespace where translations live.
If a cortex library has a getI18n(locale) method, use that instead (recommended).

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):

╔══════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: session.fetch() returns ALREADY-PARSED JSON, not Response.  ║
║  Do NOT call resp.json() — it will crash with "not a function".        ║
║  Access resp.ok, resp.data, resp.error directly.                       ║
╚══════════════════════════════════════════════════════════════════════════╝

\`\`\`javascript
// Helper for extension calls (copy this EXACTLY):
// ALL extension actions are POST — the backend only has router.post() routes
async function extCall(extName, actionId, body = {}) {
  const session = await AIMEAT.auth.login();
  if (!session) throw new Error('Not logged in');
  const url = '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(url, { method: 'POST', body: JSON.stringify(body) });
  // resp is ALREADY parsed JSON — never call resp.json()
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;  // unwrapped payload
}

// Usage:
const results = await extCall('my-extension', 'search', { query: 'test' });
const detail = await extCall('my-extension', 'getDetail', { id: 'abc-123' });
\`\`\``;
  }

  // Build project context (description + completed component info)
  let projectContext = data.projectDescription || '';
  if (appDomainSpec) projectContext += formatSpec(appDomainSpec, 'App-Domain Cortex Spec');

  return {
    label: data.componentLabel || '',
    project_context: projectContext,
    cortex_script_loads: cortexScriptLoads,
    cortex_or_api_section: cortexOrApiSection,
    cortex_rules: hasCortex ? '- Call cortex init() on app start — it handles everything automatically\n- Focus on UX/UI — the cortex handles data access and initialization' : '',
    translation_keys_section: translationKeysSection,
  };
}

function resolveReflection(data: PromptRuntimeData): Vars {
  // Match browser buildReflectionPrompt() from fix.js lines 59-78
  const errors = (data.errors || []).map((e, i) => `${i + 1}. ${e}`).join('\n');
  const testCtx = data.testContext ? buildTestContextSection(data.testContext) : '';
  const specContract = data.selfSpec
    ? `\`\`\`json\n${JSON.stringify(data.selfSpec, null, 2).slice(0, 3000)}\n\`\`\``
    : 'No spec available';
  return {
    failed_code: data.code || '',
    spec_contract: specContract,
    errors,
    test_context: testCtx,
  };
}

function resolveFreshGeneration(data: PromptRuntimeData): Vars {
  // Match browser buildFreshGenerationPrompt() from fix.js lines 139-170
  let pitfalls = '';
  if (data.previousAttempts && data.previousAttempts.length > 0) {
    pitfalls = '\n\n## KNOWN PITFALLS (from previous failed attempts — AVOID ALL of these)\n\n';
    const seen = new Set<string>();
    for (const attempt of data.previousAttempts) {
      const diag = attempt.diagnosis as string | undefined;
      if (diag && !seen.has(diag)) { pitfalls += `- ${diag}\n`; seen.add(diag); }
      for (const err of (attempt.errors as string[]) || []) {
        if (!seen.has(err)) { pitfalls += `- Error to avoid: ${err}\n`; seen.add(err); }
      }
    }
  }
  let testTrace = '';
  const trace = (data.testContext?.trace as Array<Record<string, string>>) || [];
  if (trace.length > 0) {
    testTrace = '\n\n## ACTUAL API RESPONSES (use these exact data shapes)\n\n';
    for (const t of trace) testTrace += `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}\n\n`;
  }
  return {
    original_prompt: data.originalPrompt || '',
    pitfalls,
    test_trace: testTrace,
  };
}

function resolveFix(data: PromptRuntimeData, fragments: Record<string, string>): Vars {
  // Match browser buildFixPrompt() — inject ACTUAL fragment content, not references
  const ct = data.componentType || '';
  const sc = fragments.sandbox_constraints || '';
  const nr = fragments.namespace_rules || '';
  const ecr = fragments.extension_consumption_rules || '';
  let typeConstraints = '';
  if (ct === 'extension') {
    typeConstraints = `\n${sc}\n\n${nr}\n`;
  } else if (ct === 'cortex') {
    typeConstraints = `\n${nr}\n\n${ecr}\n\nCORTEX CONSTRAINTS (browser IIFE):\n- Must be a single IIFE registering on window.AIMEAT\n- YAML metadata.name (kebab-case) and JS LIB_NAME (camelCase) must match\n- Every readExtMemory/getPublic call must be null-checked\n`;
  } else if (ct === 'app') {
    typeConstraints = `\n${nr}\n\nAPP CONSTRAINTS (browser HTML):\n- Include CSP meta tag if using CDN scripts\n- Use AIMEAT.auth for login, AIMEAT.data for memory access\n- Call cortex init() before accessing data\n- Handle empty state gracefully (no data on first run)\n`;
  }
  return {
    original_prompt: data.originalPrompt || '',
    code: data.code || '',
    errors: (data.errors || []).map((e, i) => `${i + 1}. ${e}`).join('\n'),
    component_type: ct,
    type_constraints: typeConstraints,
    // These are populated when the autopilot passes them in PromptRuntimeData.
    // The browser buildFixPrompt() builds these from testContext, previousAttempts, reflectionDiagnosis params.
    // The autopilot currently passes errors but not test traces — these enable it when it does.
    test_context: data.testContext ? buildTestContextSection(data.testContext) : '',
    previous_attempts: data.previousAttempts ? buildPreviousAttemptsSection(data.previousAttempts) : '',
    reflection_diagnosis: data.reflectionDiagnosis ? `\n\n## ROOT CAUSE ANALYSIS (from diagnostic step)\n\n${data.reflectionDiagnosis}\n\nApply this analysis precisely when fixing the code.\n` : '',
  };
}

// Match browser buildTestContextSection() from fix.js lines 173-199
function buildTestContextSection(testContext: Record<string, unknown>): string {
  let section = '\n\n## Test Failure Context\n';
  const errors = testContext.errors as string[] | undefined;
  if (errors) section += 'Test errors:\n' + errors.join('\n') + '\n';
  const trace = testContext.trace as Array<Record<string, string>> | undefined;
  if (trace && trace.length > 0) {
    section += '\n## ACTUAL API RESPONSES (diagnostic trace)\n';
    section += 'These are the real responses from every API call during the test.\n';
    section += 'Study these carefully to understand the actual data shapes before fixing.\n\n';
    for (const t of trace) {
      section += `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}\n\n`;
    }
  }
  const depResults = testContext.dependencyResults as Array<Record<string, string>> | undefined;
  if (depResults) {
    section += '\nDependency test results (these passed):\n';
    for (const dep of depResults) section += `- ${dep.componentId}: ${dep.status}\n`;
  }
  const bpComp = testContext.blueprintComponent as Record<string, unknown> | undefined;
  if (bpComp) {
    section += `\nBlueprint component spec:\n- type: ${bpComp.type}, produces: ${((bpComp.produces as string[]) || []).join(', ')}, consumes: ${((bpComp.consumes as string[]) || []).join(', ')}\n`;
  }
  return section;
}

// Match browser buildFixPrompt() previousAttempts section from fix.js lines 101-110
function buildPreviousAttemptsSection(attempts: Array<Record<string, unknown>>): string {
  if (!attempts || attempts.length === 0) return '';
  let section = '\n\n## PREVIOUS FIX ATTEMPTS (DO NOT repeat these approaches)\n\n';
  for (const attempt of attempts) {
    section += `### Round ${attempt.round}\n`;
    if (attempt.diagnosis) section += `Diagnosis: ${attempt.diagnosis}\n`;
    section += `Errors after this round: ${((attempt.errors as string[]) || []).join('; ')}\n\n`;
  }
  section += `You are now on round ${attempts.length + 1}. You MUST try a FUNDAMENTALLY different approach than the previous rounds.\n`;
  return section;
}

function resolveTestExtensionSpec(data: PromptRuntimeData): Vars {
  // Match browser buildTestPrompt() — golden samples, scenarios, structures, contracts
  const bp = data.blueprint;
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  const extName = data.extensionName || (spec?.name as string) || '';

  // Golden samples from probe results
  const probes = (data.completedComponents || [])
    .find(c => c.type === 'extension')?.probeResults as Array<Record<string, unknown>> | undefined;
  let goldenSamples = '';
  if (probes && probes.length > 0) {
    const successful = probes.filter(p => (p.status as number) === 200 && p.response);
    if (successful.length > 0) {
      goldenSamples = '\n## GOLDEN SAMPLES — Real API responses (use these as test reference)\n\nThese are ACTUAL responses captured from the live extension. Your test assertions\nMUST match these data shapes. Do NOT invent field names — use exactly what you see here.\n\n';
      for (const p of successful) {
        // Truncate large responses to 2KB — show structure, not full data
        let responseStr = JSON.stringify(p.response, null, 2);
        if (responseStr.length > 2000) {
          responseStr = responseStr.slice(0, 2000) + '\n... [truncated, ' + responseStr.length + ' chars total]';
        }
        goldenSamples += `### ${p.action}(${JSON.stringify(p.input)})\n\`\`\`json\n${responseStr}\n\`\`\`\n\n`;
      }
      goldenSamples += 'When writing assertions, reference the EXACT field names from the golden samples above.\n';
    }
  }

  // Test scenarios — prefer SPEC actions over blueprint scenarios.
  // Blueprint scenarios have abstract input shapes (e.g. {query, type}) that don't match
  // the actual extension input schema (e.g. {name, businessId}). The spec is authoritative.
  const bpComp = bp.components?.find(c => c.type === 'extension');
  let testScenarios = '';

  // Memory keys for cleanup instructions
  const memoryProduces = (bpComp?.produces || [])
    .filter((p: string) => p.startsWith('memory:'))
    .map((p: string) => p.replace('memory:', ''));

  if (memoryProduces.length > 0) {
    testScenarios += `\n## State to Clean Up at Start\nThe extension writes to: ${memoryProduces.map(k => '`' + k + '`').join(', ')}\nBefore the first test scenario, clean stale data using the extension's OWN remove/delete actions via callExt.\nRead lists with readExtMemory, call remove for each item, then call init.\n`;
  }

  // Build scenarios from the SPEC (has correct action IDs and input schemas)
  const specObj = data.selfSpec as Record<string, unknown> | undefined;
  const specActions = (specObj?.actions || []) as Array<Record<string, unknown>>;

  if (specActions.length > 0) {
    testScenarios += '\n## Test Scenarios (from extension spec — use THESE exact action IDs and input shapes)\n\n';
    testScenarios += specActions.map((a, i) => {
      const example = a.example as Record<string, unknown> | undefined;
      const inputStr = example?.input ? JSON.stringify(example.input) : JSON.stringify(a.input || {});
      return `${i + 1}. **${a.id}** — ${a.description || ''}\n   Input: ${inputStr}\n   Expected output fields: ${JSON.stringify(a.output || {})}`;
    }).join('\n\n');
    testScenarios += '\n\nTest EVERY action above using the EXACT input from the spec examples.\nFor actions that call external APIs: check response shape (has the right fields). A single graceful error is OK, but if ALL external API actions return errors, FAIL the test.\nFor memory-only actions: assert return values match the spec output shape.\n';
  } else if (bp.testScenarios && bpComp) {
    // Fallback: use blueprint scenarios if no spec available
    const scenarios = (bp.testScenarios || []).filter(ts => ts.component === bpComp.id).flatMap(ts => ts.scenarios || []);
    if (scenarios.length > 0) {
      testScenarios += '\n## Test Scenarios (from blueprint)\n\n' +
        scenarios.map((s, i) => `${i + 1}. ${s.action}${s.type === 'external-api' ? ' [EXTERNAL API]' : ' [MEMORY]'}\n   Input: ${JSON.stringify(s.input)}\n   Expected: ${s.expect}`).join('\n\n') +
        '\n\nTest EVERY scenario above.\nFor [EXTERNAL API]: check response shape. A single graceful error is OK, but if ALL fail, FAIL the test.\nFor [MEMORY]: assert return values match what the action code returns on success.\n';
    }
  }

  // Golden samples extra guidance — browser lines 121-123
  if (goldenSamples) {
    goldenSamples += 'For example, if the response has `item: { id: "abc", name: "Test" }`, assert `result.item.id`, NOT `result.item === "abc"`.\n';
  }

  // Structures and action contracts from blueprint
  const structures = bp.dataModel?.structures
    ? Object.entries(bp.dataModel.structures).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``).join('\n\n')
    : 'No structures defined';
  const actionContracts = bp.dataModel?.actions
    ? Object.entries(bp.dataModel.actions).map(([name, def]) => `- **${name}**: input=${JSON.stringify(def.input || {})}, output=${(def.output as Record<string, unknown>)?.$ref ? '$ref:' + (def.output as Record<string, unknown>).$ref : JSON.stringify((def as Record<string, unknown>).output || 'any')}`).join('\n')
    : 'No actions defined';

  // Project context — browser lines 48-55: blueprint components + use cases from interview
  const bpComponents = bp.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';
  const useCases = data.interviewSpec?.useCases
    ? (data.interviewSpec.useCases as Array<Record<string, string>>).map((uc, i) => {
        if (typeof uc === 'string') return `${i + 1}. ${uc}`;
        return `${i + 1}. ${uc.description || uc.title || JSON.stringify(uc)}`;
      }).join('\n')
    : 'No use cases specified';

  // Extension spec — gives the test the ACTUAL contracted action IDs (not just blueprint guesses)
  const extensionSpec = data.selfSpec
    ? `\n## Extension Spec (actual contract — use THESE action IDs)\n\n\`\`\`json\n${JSON.stringify(data.selfSpec, null, 2).slice(0, 3000)}\n\`\`\`\n`
    : '';

  return {
    extension_name: extName,
    golden_samples: goldenSamples,
    extension_spec: extensionSpec,
    test_scenarios: testScenarios,
    structures,
    action_contracts: actionContracts,
    project_context: `## Project Context\nBlueprint components:\n${bpComponents}\n\nUse cases from interview:\n${useCases}`,
  };
}

function resolveTestCortexSpec(data: PromptRuntimeData): Vars {
  const bp = data.blueprint;
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  const libName = (spec?.libName as string) || '';
  const wrapsExt = (spec?.wrapsExtension as string) || '';

  // Cortex methods from blueprint — this is the DEFINITIVE list of what to test
  const bpComp = bp.components?.find(c => c.label === data.componentLabel);
  let cortexMethods = '';
  if (bpComp) {
    const methods = (bpComp.produces || []).filter((p: string) => p.startsWith('api:')).map((p: string) => p.replace('api:', ''));
    if (methods.length > 0) cortexMethods = `\n## Cortex Methods to Test (from blueprint — test ALL of these and NOTHING ELSE)\n${methods.map((m: string) => `- ${m}(params)`).join('\n')}\n\nTest ONLY these methods via window.AIMEAT.${libName}. Do NOT call init(), checkChanges(), or any scheduled/bootstrap actions — those are server-only extension jobs, not cortex library methods.\n`;
  }

  // Golden samples from probes — labeled as EXTENSION responses for context
  const probes = (data.completedComponents || [])
    .find(c => c.type === 'extension')?.probeResults as Array<Record<string, unknown>> | undefined;
  let goldenSamples = '';
  if (probes && probes.length > 0) {
    const successful = probes.filter(p => (p.status as number) === 200 && p.response);
    if (successful.length > 0) {
      goldenSamples = '\n## GOLDEN SAMPLES — Real responses from the EXTENSION that the cortex wraps\n\nThese show what the extension returns. The cortex methods call these internally.\nUse these to understand the data shapes, but test the CORTEX methods listed above, not the extension actions.\n\n';
      for (const p of successful) goldenSamples += `### ${p.action}(${JSON.stringify(p.input)})\n\`\`\`json\n${JSON.stringify(p.response, null, 2)}\n\`\`\`\n\n`;
    }
  }

  // Test scenarios from blueprint (if any exist for this cortex component)
  let testScenarios = '';
  if (bp.testScenarios && bpComp) {
    const scenarios = (bp.testScenarios || []).filter(ts => ts.component === bpComp.id).flatMap(ts => ts.scenarios || []);
    if (scenarios.length > 0) {
      testScenarios = '\n## Test Scenarios (from blueprint)\n\n' +
        scenarios.map((s, i) => `${i + 1}. Call ${s.action}(${JSON.stringify(s.input)})\n   Expected: ${s.expect}`).join('\n\n') +
        '\n\nTest EVERY scenario above.\n';
    }
  }

  const structures = bp.dataModel?.structures
    ? Object.entries(bp.dataModel.structures).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``).join('\n\n')
    : 'No structures defined';

  // FIX #2: Filter action contracts to cortex: only — extension actions confuse the LLM into testing them directly
  const actionContracts = bp.dataModel?.actions
    ? Object.entries(bp.dataModel.actions)
        .filter(([name]) => name.startsWith('cortex:'))
        .map(([name, def]) => `- **${name}**: input=${JSON.stringify(def.input || {})}, output=${(def.output as Record<string, unknown>)?.$ref ? '$ref:' + (def.output as Record<string, unknown>).$ref : JSON.stringify((def as Record<string, unknown>).output || 'any')}`)
        .join('\n')
    : 'No actions defined';

  // FIX #6: Only include APP test block for app-domain cortex, not data cortex
  const subtype = bpComp?.subtype as string || '';
  let appTestBlock = '';
  if (subtype === 'app-domain') {
    const appApis = bpComp ? (bpComp.consumes || []).filter((p: string) => p.startsWith('api:')).map((p: string) => p.replace('api:', '')) : [];
    appTestBlock = `\nFor APP tests:
- The app is already loaded on the test page
- Authentication IS available
- Wait for data to render: await new Promise(r => setTimeout(r, 3000));
- Check DOM elements, click buttons, verify results
- Verify actual content renders (not translation keys like "search.title")
- Verify API calls return real data visible in the UI\n`;
    if (appApis.length > 0) {
      appTestBlock += `\n## App APIs (verify they work in the UI)\n${appApis.map((a: string) => `- ${a}`).join('\n')}\n`;
    }
  }

  // Project context
  const bpComponents = bp.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';
  const useCases = data.interviewSpec?.useCases
    ? (data.interviewSpec.useCases as Array<Record<string, string>>).map((uc, i) => {
        if (typeof uc === 'string') return `${i + 1}. ${uc}`;
        return `${i + 1}. ${uc.description || uc.title || JSON.stringify(uc)}`;
      }).join('\n')
    : 'No use cases specified';

  return {
    lib_name: libName,
    wraps_extension: wrapsExt,
    golden_samples: goldenSamples,
    test_scenarios: testScenarios,
    structures,
    action_contracts: actionContracts,
    project_context: `## Project Context\nBlueprint components:\n${bpComponents}\n\nUse cases from interview:\n${useCases}`,
    cortex_methods: cortexMethods + appTestBlock,
  };
}

// ── Shared context builder ──

function buildContextString(data: PromptRuntimeData): string {
  let context = '';

  // Project description (not for extensions — they're project-agnostic)
  if (data.componentType !== 'extension') {
    context += `Project: ${data.projectDescription || ''}\n`;
  }

  // DataModel entries relevant to this component
  if (data.blueprint.dataModel && data.blueprintComponent) {
    const dm = data.blueprint.dataModel;
    const compId = data.blueprintComponent.id;
    const relevant: Record<string, unknown> = {};

    for (const [key, schema] of Object.entries(dm.memoryKeys || {})) {
      if (schema.producedBy === compId || schema.consumedBy?.includes(compId)) {
        const { source, producedBy, consumedBy, ...rest } = schema;
        relevant[key] = rest;
      }
    }

    if (Object.keys(relevant).length > 0) {
      context += '\n## Domain Data Model (EXACT schemas)\n```json\n' + JSON.stringify(relevant, null, 2) + '\n```\n\n';
    }
  }

  // Data sources for extensions
  if (data.componentType === 'extension' && data.interviewSpec?.dataSources) {
    context += '\n## Data Source Details\n' + formatDataSources(data.interviewSpec.dataSources) + '\n';
  }

  // Completed components context
  context += formatCompletedContext(data.completedComponents);

  // Interview use cases (for app/cortex)
  if ((data.componentType === 'app' || data.componentType === 'cortex') && data.interviewSpec?.useCases) {
    context += '\n## Use Cases\n' + formatUseCases(data.interviewSpec.useCases) + '\n';
  }

  return context;
}

// ── Blueprint & Interview resolvers ──

function resolveBlueprint(data: PromptRuntimeData): Vars {
  const interviewSpec = data.interviewSpec;
  const interviewSpecSection = interviewSpec
    ? `\n## Refined Specification (from requirements interview)\n\`\`\`json\n${JSON.stringify(interviewSpec, null, 2)}\n\`\`\`\n\nUse the specification above to determine the exact components needed. The data sources, entities, views, and constraints have been validated with the user.\n`
    : '';

  const specLocale = (interviewSpec as Record<string, unknown>)?.locale as string | undefined;
  const languageNote = specLocale && specLocale !== 'en'
    ? `\n## LANGUAGE\n\nThe user's language is "${specLocale}". Write all human-readable labels and descriptions in that language.\nJSON keys and technical identifiers stay in English.\n`
    : '';

  // Cortex catalog built from data.cortexCatalog if available
  let cortexCatalog = '';
  const libs = (data as unknown as Record<string, unknown>).cortexCatalog as Array<Record<string, unknown>> | undefined;
  if (libs && libs.length > 0) {
    cortexCatalog = '\n## Available Cortex Libraries (reuse these — do NOT recreate)\n\n' +
      libs.map(lib => {
        const libComps = ((lib.components as Array<Record<string, unknown>>) || []).filter(c => c.type === 'lib');
        const exports = libComps.map(c => (c.exports as string[]) || []).flat();
        const apiSurface = libComps.map(c => (c.api_surface as string) || '').filter(Boolean).join('\n');
        return `### ${lib.name as string} — ${(lib.description as string) || 'no description'}\n- **Exports:** ${exports.join(', ') || 'none'}\n${apiSurface ? `- **API:**\n\`\`\`\n${apiSurface.trim()}\n\`\`\`` : ''}\n- **Load:** \`<script src="/v1/cortex/${lib.name as string}/libs/${(libComps[0]?.filename as string) || (lib.name as string) + '.js'}"></script>\``;
      }).join('\n\n') +
      '\n\nWhen the blueprint\'s cortex component needs an existing library, add a "uses" field listing the library names.\n';
  }

  return {
    description: data.projectDescription || '',
    interview_spec_section: interviewSpecSection,
    language_note: languageNote,
    cortex_catalog: cortexCatalog,
  };
}

function resolveInterview(data: PromptRuntimeData): Vars {
  const locale = ((data as unknown as Record<string, unknown>).locale as string) || 'en';
  const langMap: Record<string, string> = { fi: 'Finnish (suomi)', en: 'English', sv: 'Swedish (svenska)', de: 'German (Deutsch)', fr: 'French (français)', es: 'Spanish (español)', ja: 'Japanese (日本語)', zh: 'Chinese (中文)' };
  const langName = langMap[locale] || locale;
  const languageInstruction = locale !== 'en'
    ? `\n## LANGUAGE\n\nCONDUCT THIS ENTIRE INTERVIEW IN ${langName.toUpperCase()}.\nAll your questions, summaries, options, and explanations must be in ${langName}.\nThe final JSON specification field values (descriptions, titles, notes) should also be in ${langName}.\nJSON keys and technical identifiers (field names, type values) stay in English.\nInclude "locale": "${locale}" in the output JSON root so downstream prompts continue in the same language.\n`
    : '';

  return {
    description: data.projectDescription || '',
    language_instruction: languageInstruction,
    locale,
  };
}
