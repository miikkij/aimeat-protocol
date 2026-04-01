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
    'gen-fix': resolveFix,
    'gen-test-extension-spec': resolveTestExtensionSpec,
    'gen-test-cortex-spec': resolveTestCortexSpec,
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
  if (!dataSources || dataSources.length === 0) return 'No data sources specified.';
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
  if (!structures || Object.keys(structures).length === 0) return 'No structures defined.';
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

  const compActions = Object.entries(actions)
    .filter(([, v]) => v.component === bpComp?.id)
    .map(([name, def]) => `- **${name.replace(/^ext:/, '').replace(/^[^/]+\//, '')}**: ${def.description || ''}\n  Input: \`${JSON.stringify(def.input || {})}\`\n  Output: \`${JSON.stringify(def.output || {})}`)
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
    blueprint_actions: compActions || 'Infer from data sources.',
    structures: formatStructures(bp.dataModel?.structures),
    memory_keys: compMemoryKeys || 'Infer from actions.',
    schedules: schedules.length > 0
      ? schedules.map(s => `- ${s.action}: ${s.cron} — ${s.description || ''}`).join('\n')
      : 'None. Add @activate init if the extension needs initialization.',
    config_keys: settingsArr.length > 0
      ? settingsArr.map(s => `- ${(s as Record<string, string>).key} (${(s as Record<string, string>).type || 'string'}): ${(s as Record<string, string>).label || (s as Record<string, string>).key}`).join('\n')
      : 'None.',
  };
}

function resolveDataApiSpec(data: PromptRuntimeData): Vars {
  return {
    extension_spec: JSON.stringify(data.extensionSpec || {}, null, 2),
    structures: formatStructures(data.blueprint.dataModel?.structures),
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
    context: buildContextString(data),
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
  return {
    label: data.componentLabel || '',
    context: buildContextString(data),
    spec_section: data.selfSpec ? formatSpec(data.selfSpec, 'YOUR SPEC — implement this contract exactly') : '',
    completed_context: formatCompletedContext(data.completedComponents),
  };
}

function resolveCortexData(data: PromptRuntimeData): Vars {
  return {
    label: data.componentLabel || '',
    extension_spec: data.extensionSpec ? formatSpec(data.extensionSpec, 'Extension Spec') : '',
    structures: formatStructures(data.blueprint.dataModel?.structures),
    completed_context: formatCompletedContext(data.completedComponents),
  };
}

function resolveCortexComponent(data: PromptRuntimeData): Vars {
  return {
    label: data.componentLabel || '',
    data_api_spec: data.dataApiSpec ? formatSpec(data.dataApiSpec, 'Data API Spec') : '',
    translation_keys: (data.translationKeys || []).slice(0, 30).map(k => `\`${k}\``).join(', '),
    view_context: data.viewDefinition ? JSON.stringify(data.viewDefinition) : '',
    completed_context: formatCompletedContext(data.completedComponents),
  };
}

function resolveCortexAppDomain(data: PromptRuntimeData): Vars {
  return {
    label: data.componentLabel || '',
    component_specs: (data.componentSpecs || []).map(cs => formatSpec(cs, `Component: ${(cs as Record<string, string>).name}`)).join('\n'),
    data_api_spec: data.dataApiSpec ? formatSpec(data.dataApiSpec, 'Data API Spec') : '',
    use_cases: formatUseCases(data.useCases),
    translation_keys: (data.translationKeys || []).join(', '),
    completed_context: formatCompletedContext(data.completedComponents),
  };
}

function resolveApp(data: PromptRuntimeData): Vars {
  // App gets ONLY the app-domain spec — nothing else
  const appDomainSpec = (data.completedComponents || [])
    .find(c => c.subtype === 'app-domain' && c.spec)?.spec;

  return {
    label: data.componentLabel || '',
    app_domain_spec: appDomainSpec ? formatSpec(appDomainSpec, 'App-Domain Cortex Spec') : '',
    style: data.interviewSpec?.style ? `mood=${data.interviewSpec.style.mood || 'professional'}, layout=${data.interviewSpec.style.layout || 'tabbed'}` : 'professional',
    translation_keys: (data.translationKeys || []).slice(0, 30).map(k => `\`${k}\``).join(', '),
  };
}

function resolveFix(data: PromptRuntimeData): Vars {
  return {
    original_prompt: data.originalPrompt || '',
    code: data.code || '',
    errors: (data.errors || []).join('\n'),
    component_type: data.componentType || '',
  };
}

function resolveTestExtensionSpec(data: PromptRuntimeData): Vars {
  if (!data.selfSpec) return { spec_actions: '', extension_name: '' };
  const spec = data.selfSpec as Record<string, unknown>;
  const actions = (spec.actions || []) as Array<Record<string, unknown>>;
  return {
    extension_name: data.extensionName || (spec.name as string) || '',
    spec_actions: actions.map(a => {
      const example = a.example as Record<string, unknown> | undefined;
      return `### Action: \`${a.id}\`\n- Call: \`callExt('${data.extensionName}', '${a.id}', ${JSON.stringify(example?.input || {})})\`\n- Expected output: ${JSON.stringify(Object.keys((example?.output || {}) as Record<string, unknown>))}\n\`\`\`json\n${JSON.stringify(example?.output || {}, null, 2)}\n\`\`\``;
    }).join('\n\n'),
    memory_keys: ((spec.memoryKeys || []) as Array<Record<string, string>>)
      .map(mk => `- \`${mk.key}\` (${mk.type}): ${mk.description}`)
      .join('\n') || 'None.',
  };
}

function resolveTestCortexSpec(data: PromptRuntimeData): Vars {
  if (!data.selfSpec) return { spec_methods: '', lib_name: '' };
  const spec = data.selfSpec as Record<string, unknown>;
  const methods = (spec.methods || []) as Array<Record<string, unknown>>;
  return {
    lib_name: (spec.libName as string) || '',
    wraps_extension: (spec.wrapsExtension as string) || '',
    spec_methods: methods.map(m => {
      return `### Method: \`${m.name}\`\n- Returns: ${m.returns}\n- Example: ${m.example}\n\`\`\`json\n${JSON.stringify(m.returnsExample ?? 'see spec', null, 2)}\n\`\`\``;
    }).join('\n\n'),
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
