/**
 * @file src/services/generator-prompts/resolvers-spec.ts
 * @description Per-prompt resolvers for spec/component generation prompts (extension spec,
 *   data-api spec, component spec, app-domain spec, simple component, translation,
 *   extension code). Extracted from resolvers.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from resolvers.ts (max-file-lines)
 */

import type { PromptRuntimeData } from './types.js';
import {
  type Vars,
  warnFallback,
  formatDataSources,
  formatStructures,
  formatSpec,
  formatUseCases,
  formatCompletedContext,
  buildContextString,
} from './resolver-helpers.js';

export function resolveExtensionSpec(data: PromptRuntimeData): Vars {
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

export function resolveDataApiSpec(data: PromptRuntimeData): Vars {
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

export function resolveComponentSpec(data: PromptRuntimeData): Vars {
  return {
    data_api_spec: JSON.stringify(data.dataApiSpec || {}, null, 2),
    component_label: data.componentLabel || '',
    view_context: data.viewDefinition ? (typeof data.viewDefinition === 'string' ? data.viewDefinition : JSON.stringify(data.viewDefinition)) : '',
    translation_keys: (data.translationKeys || []).slice(0, 30).map(k => `\`${k}\``).join(', ') +
      ((data.translationKeys || []).length > 30 ? ` ... and ${(data.translationKeys || []).length - 30} more` : ''),
  };
}

export function resolveAppDomainSpec(data: PromptRuntimeData): Vars {
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

export function resolveSimpleComponent(data: PromptRuntimeData): Vars {
  return {
    label: data.componentLabel || '',
    component_context: buildContextString(data),
  };
}

export function resolveTranslation(data: PromptRuntimeData): Vars {
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

export function resolveExtensionCode(data: PromptRuntimeData): Vars {
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
