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


// ── DaisyUI component HTML examples ──
// Used by resolvers to inject ONLY the components the spec selected.
const DAISYUI_COMPONENTS: Record<string, string> = {
  table: '<table class="table">\n  <thead><tr><th>Name</th><th>Status</th></tr></thead>\n  <tbody><tr><td>Item</td><td><span class="badge badge-success">Active</span></td></tr></tbody>\n</table>',
  card: '<div class="card bg-base-100 shadow-sm">\n  <div class="card-body">\n    <h2 class="card-title">Title</h2>\n    <p>Content</p>\n    <div class="card-actions justify-end"><button class="btn btn-primary">Action</button></div>\n  </div>\n</div>',
  tabs: '<div role="tablist" class="tabs tabs-bordered">\n  <a role="tab" class="tab tab-active">Tab 1</a>\n  <a role="tab" class="tab">Tab 2</a>\n</div>',
  badge: '<span class="badge badge-primary">Label</span>\n<span class="badge badge-success">Active</span>\n<span class="badge badge-warning">Pending</span>',
  alert: '<div role="alert" class="alert alert-info"><span>Info message</span></div>',
  modal: '<dialog class="modal"><div class="modal-box">\n  <h3 class="font-bold text-lg">Title</h3>\n  <p>Content</p>\n  <div class="modal-action"><form method="dialog"><button class="btn">Close</button></form></div>\n</div></dialog>',
  stat: '<div class="stats shadow">\n  <div class="stat"><div class="stat-title">Total</div><div class="stat-value">31K</div></div>\n</div>',
  timeline: '<ul class="timeline timeline-vertical">\n  <li><div class="timeline-start">Date</div><div class="timeline-middle">\u25cf</div><div class="timeline-end">Event</div><hr/></li>\n</ul>',
  input: '<label class="input"><span class="label">Label</span><input type="text" placeholder="Type..." /></label>',
  select: '<label class="select"><span class="label">Pick</span><select><option>Option</option></select></label>',
  toggle: '<label class="toggle"><span class="label">Setting</span><input type="checkbox" /></label>',
  checkbox: '<label class="checkbox"><input type="checkbox" /><span>Option</span></label>',
  textarea: '<label class="textarea"><span class="label">Notes</span><textarea placeholder="Write..."></textarea></label>',
  button: '<button class="btn btn-primary">Primary</button>\n<button class="btn btn-outline">Outline</button>\n<button class="btn btn-ghost">Ghost</button>',
  loading: '<span class="loading loading-spinner loading-md"></span>',
  progress: '<progress class="progress progress-primary w-56" value="70" max="100"></progress>',
  tooltip: '<div class="tooltip" data-tip="Info"><button class="btn">Hover</button></div>',
  collapse: '<div class="collapse collapse-arrow bg-base-100 border border-base-300">\n  <input type="radio" name="accordion" />\n  <div class="collapse-title font-semibold">Title</div>\n  <div class="collapse-content"><p>Content</p></div>\n</div>',
  dropdown: '<div class="dropdown"><div tabindex="0" role="button" class="btn">Menu</div>\n  <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box w-52 p-2 shadow-sm">\n    <li><a>Item 1</a></li><li><a>Item 2</a></li>\n  </ul>\n</div>',
  drawer: '<div class="drawer lg:drawer-open">\n  <input id="drawer" type="checkbox" class="drawer-toggle" />\n  <div class="drawer-content"><!-- main content --></div>\n  <div class="drawer-side"><ul class="menu bg-base-200 min-h-full w-60 p-4">\n    <li><a>Home</a></li><li><a>Settings</a></li>\n  </ul></div>\n</div>',
  navbar: '<div class="navbar bg-base-100 shadow-sm">\n  <div class="flex-1"><a class="btn btn-ghost text-xl">App</a></div>\n  <div class="flex-none"><button class="btn btn-ghost">Settings</button></div>\n</div>',
  menu: '<ul class="menu bg-base-200 rounded-box w-56">\n  <li><a>Item 1</a></li><li><a class="active">Active</a></li>\n</ul>',
  breadcrumbs: '<div class="breadcrumbs text-sm"><ul><li><a>Home</a></li><li>Current</li></ul></div>',
  steps: '<ul class="steps"><li class="step step-primary">Step 1</li><li class="step">Step 2</li></ul>',
  hero: '<div class="hero bg-base-200 min-h-96"><div class="hero-content text-center">\n  <div class="max-w-md"><h1 class="text-5xl font-bold">Title</h1><p>Description</p></div>\n</div></div>',
  carousel: '<div class="carousel w-full"><div class="carousel-item w-full"><img src="..." class="w-full" /></div></div>',
  divider: '<div class="divider">OR</div>',
  toast: '<div class="toast toast-end"><div class="alert alert-success"><span>Saved!</span></div></div>',
  pagination: '<div class="join"><button class="join-item btn">\u00ab</button><button class="join-item btn btn-active">1</button><button class="join-item btn">\u00bb</button></div>',
  avatar: '<div class="avatar placeholder"><div class="bg-neutral text-neutral-content w-12 rounded-full"><span>AB</span></div></div>',
  skeleton: '<div class="skeleton h-32 w-full"></div>',
};

/** Build daisyUI section from spec's ui.components list */
function buildDaisyUiSection(components: string[]): string {
  if (components.length === 0) return '';
  let section = '## UI Component Reference (daisyUI) \u2014 MANDATORY\n\n';
  section += 'Use these daisyUI CSS classes for all UI. Do NOT build raw unstyled HTML.\n';
  section += 'DaisyUI + Tailwind CSS is loaded on the page. Just use the class names.\n\n';
  for (const comp of components) {
    const html = DAISYUI_COMPONENTS[comp];
    if (html) {
      section += `### ${comp}\n\`\`\`html\n${html}\n\`\`\`\n\n`;
    }
  }
  section += 'Combine with Tailwind utilities for spacing/layout: `p-4`, `mb-2`, `flex`, `grid`, `gap-4`, `w-full`, `max-w-lg`, `rounded-lg`, `text-sm`, `font-bold`, etc.\n';
  return section;
}

/** Full daisyUI section fallback (for specs without ui.components) */
function buildFullDaisyUiSection(): string {
  return buildDaisyUiSection(['card', 'table', 'badge', 'button', 'input', 'select', 'alert', 'tabs', 'loading', 'modal', 'toast']);
}

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

  // Use cases — pass ALL use cases so the LLM can pick the relevant one
  // (Label matching doesn't work when labels are in a different language than use case titles)
  let useCase = '';
  if (interview?.useCases && (interview.useCases as unknown[]).length > 0) {
    useCase = (interview.useCases as Array<Record<string, string>>)
      .map(u => `- **${u.title}** [${u.priority || 'medium'}]: ${u.description || ''}`)
      .join('\n');
  }
  if (!useCase) useCase = warnFallback('gen-cortex-component', 'use_case', 'No use cases provided');

  // Views — pass ALL views
  let viewSection = '';
  if (interview?.views && (interview.views as unknown[]).length > 0) {
    viewSection = (interview.views as Array<Record<string, unknown>>)
      .map(v => {
        let line = `- **${v.title}** (${v.type || 'page'}): ${v.description || ''}`;
        if (Array.isArray(v.interactions)) line += ` [${(v.interactions as string[]).join(', ')}]`;
        return line;
      }).join('\n');
  }
  if (!viewSection) viewSection = warnFallback('gen-cortex-component', 'view_section', 'No views provided');

  // Structures
  const structures = data.blueprint.dataModel?.structures || {};
  const structuresText = Object.entries(structures).map(([name, schema]) =>
    `**${name}**: ${JSON.stringify(schema, null, 2)}`).join('\n\n') || 'See data cortex API for available data.';

  // Data cortex API — inject the SPEC with returnsExamples showing exact data shapes
  const dataCortex = (data.completedComponents || []).find(c => c.type === 'cortex' && c.subtype === 'data');
  const dcBundle = dataCortex?.contextBundle;
  const dcSpec = dataCortex?.spec as Record<string, unknown> | undefined;
  let dataCortexApi = '';
  if (dcBundle || dcSpec) {
    const libName = (dcSpec?.libName as string) || dcBundle?.libName || dcBundle?.registeredAs || '';
    dataCortexApi = `\n## Data Cortex API (use this for ALL data access)\n\nAccess via: AIMEAT.${libName}\n`;

    // Inject method signatures WITH returnsExamples from the data cortex spec
    const methods = (dcSpec?.methods as Array<Record<string, unknown>>) || [];
    if (methods.length > 0) {
      dataCortexApi += '\n### Methods and Return Values\n\n';
      for (const m of methods) {
        dataCortexApi += `**AIMEAT.${libName}.${m.name}(${m.params || ''})** → ${m.returns || 'unknown'}\n`;
        if (m.returnsExample) {
          const example = typeof m.returnsExample === 'string' ? m.returnsExample : JSON.stringify(m.returnsExample, null, 2);
          dataCortexApi += `\`\`\`json\n${example.substring(0, 600)}\n\`\`\`\n`;
        }
        dataCortexApi += '\n';
      }
    } else {
      dataCortexApi += `Methods: ${(dcBundle?.exports || []).join(', ')}\n`;
    }
  } else {
    dataCortexApi = warnFallback('gen-cortex-component', 'data_cortex_api', 'No data cortex API available — data cortex may not be registered yet.');
  }

  // Translation — deduplicate keys (fi + en have identical keys)
  const tk = [...new Set(data.translationKeys || [])];
  const translationSection = tk.length > 0
    ? `\n## Translation Keys (use these exact keys)\n\n${tk.map(k => '- `' + k + '`').join('\n')}\n`
    : '';

  // Inject spec name/libName (same pattern as data cortex)
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  let specSection = '';
  if (spec) {
    const specName = (spec.name as string) || '';
    const specLibName = (spec.libName as string) || '';
    specSection = `\n## YOUR SPEC — use these EXACT names\n\n╔══════════════════════════════════════════════════════════════════════════╗\n║  metadata.name MUST be: ${specName}                                     \n║  LIB_NAME MUST be: ${specLibName}                                       \n║  These come from the spec. Do NOT use placeholder names like featureLib.║\n╚══════════════════════════════════════════════════════════════════════════╝\n\nFull spec:\n\`\`\`json\n${JSON.stringify(spec, null, 2).slice(0, 3000)}\n\`\`\`\n`;
  }

  // Service slug for translation loading — from extension or CSM
  const extComp = (data.completedComponents || []).find(c => c.type === 'extension' && c.registeredAs);
  const csmComp = (data.completedComponents || []).find(c => c.type === 'csm' && c.registeredAs);
  const serviceSlug = (extComp?.registeredAs as string) || ((csmComp?.registeredAs as string) || '').split('/').pop() || 'service';

  // DaisyUI section — from spec's ui.components or full fallback
  const uiSpec = spec?.ui as Record<string, unknown> | undefined;
  const uiComponents = (uiSpec?.components as string[]) || [];
  const platformUiSection = uiComponents.length > 0
    ? buildDaisyUiSection(uiComponents)
    : buildFullDaisyUiSection();

  return {
    label: data.componentLabel || '',
    use_case: useCase,
    view_section: viewSection,
    structures: structuresText,
    data_cortex_api: dataCortexApi,
    translation_section: translationSection,
    spec_section: specSection,
    service_slug: serviceSlug,
    platform_ui_section: platformUiSection,
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
    : warnFallback('gen-cortex-app-domain', 'data_cortex_section', 'No data cortex available');

  const translationComp = (data.completedComponents || []).find(c => c.type === 'translation' && c.contextBundle?.keys);
  const translationKeys = translationComp?.contextBundle?.keys?.slice(0, 30).join(', ') || 'none available';

  // Inject spec name/libName (same pattern as data cortex and component cortex)
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  let specSection = '';
  if (spec) {
    const specName = (spec.name as string) || '';
    const specLibName = (spec.libName as string) || '';
    specSection = `\n## YOUR SPEC — use these EXACT names\n\n╔══════════════════════════════════════════════════════════════════════════╗\n║  metadata.name MUST be: ${specName}                                     \n║  LIB_NAME MUST be: ${specLibName}                                       \n║  These come from the spec. Do NOT use placeholder names like appLib.    ║\n╚══════════════════════════════════════════════════════════════════════════╝\n\nFull spec:\n\`\`\`json\n${JSON.stringify(spec, null, 2).slice(0, 3000)}\n\`\`\`\n`;
  }

  // Service slug for translation loading
  const extComp = (data.completedComponents || []).find(c => c.type === 'extension' && c.registeredAs);
  const csmComp = (data.completedComponents || []).find(c => c.type === 'csm' && c.registeredAs);
  const serviceSlug = (extComp?.registeredAs as string) || ((csmComp?.registeredAs as string) || '').split('/').pop() || 'service';

  // DaisyUI layout section from spec's appShell/navStyle
  const appShell = (spec?.appShell as string) || '';
  const navStyle = (spec?.navStyle as string) || '';
  let platformLayoutSection = '';
  if (appShell || navStyle) {
    platformLayoutSection = '## App Shell (daisyUI) \u2014 MANDATORY\n\n';
    platformLayoutSection += 'Use these daisyUI patterns for the app shell. Do NOT build raw layout HTML.\n\n';
    if (appShell) {
      const html = DAISYUI_COMPONENTS[appShell];
      if (html) platformLayoutSection += `### Layout: ${appShell}\n\`\`\`html\n${html}\n\`\`\`\n\n`;
    }
    if (navStyle) {
      const html = DAISYUI_COMPONENTS[navStyle];
      if (html) platformLayoutSection += `### Navigation: ${navStyle}\n\`\`\`html\n${html}\n\`\`\`\n\n`;
    }
    platformLayoutSection += 'Combine with Tailwind utilities: `p-4`, `flex`, `grid`, `gap-4`, `w-full`, etc.\n';
  }

  // Build app-domain code template from spec
  const specName = (spec?.name as string) || 'app';
  const specLibName = (spec?.libName as string) || 'app';
  const views = (spec?.views as string[]) || [];
  const viewComp = (spec?.viewComposition as Record<string, string[]>) || {};
  // Build nav items — use view ID as placeholder label.
  // LLM MUST replace these with the correct app.nav.* translation keys from the Translation Keys section.
  const navItems = views.map(v => {
    return `    { id: '${v}', label: t('app.nav.TODO_REPLACE_WITH_CORRECT_KEY'), icon: '' } // ADAPT: use correct app.nav.* key for "${v}"`;
  }).join(',\n');
  const viewCases = views.map(v => {
    const comps = viewComp[v] || [];
    const renderCalls = comps.map(c =>
      `      var c_${c.replace(/-/g, '_')} = document.createElement('div');\n      c_${c.replace(/-/g, '_')}.className = 'mb-4';\n      viewEl.appendChild(c_${c.replace(/-/g, '_')});\n      if (AIMEAT.${c} && AIMEAT.${c}.render) AIMEAT.${c}.render(c_${c.replace(/-/g, '_')}, { locale: currentLocale, translations: translations });`
    ).join('\n');
    return `    case '${v}':\n${renderCalls}\n      break;`;
  }).join('\n');

  const appDomainTemplate = `(function (AIMEAT) {
  'use strict';
  var LIB_NAME = '${specLibName}';
  var currentLocale = 'fi';
  var translations = {};
  var currentView = '${views[0] || 'home'}';
  var appContainer = null;

  // ── Init: auth + translations + settings ──
  async function init() {
    var session = await AIMEAT.auth.login();
    translations = await getTranslations(currentLocale);
    var settings = {};
    try { settings = await AIMEAT.data.get('${serviceSlug}.settings') || {}; } catch(e) {}
    return { session: session, translations: translations, settings: settings };
  }

  // ── Render: navigation + view area ──
  function render(container) {
    appContainer = container;
    container.innerHTML = '';
    container.className = 'flex flex-col h-full';

    // Navigation — ADAPT: change tabs/menu/sidebar per spec navStyle
    var navEl = document.createElement('div');
    navEl.innerHTML = buildNavigation();
    container.appendChild(navEl);

    // View container
    var viewEl = document.createElement('div');
    viewEl.id = 'view-content';
    viewEl.className = 'flex-1 p-4';
    container.appendChild(viewEl);

    // Setup nav click handlers
    navEl.querySelectorAll('[data-view]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.preventDefault();
        navigateTo(el.getAttribute('data-view'));
      });
    });

    renderView(currentView);
  }

  // ── Navigation builder ──
  function buildNavigation() {
    var items = [
${navItems}
    ];
    // ADAPT: change navigation style (tabs/menu/sidebar) to match spec
    return '<div role="tablist" class="tabs tabs-bordered mb-4">' +
      items.map(function(item) {
        var active = item.id === currentView ? ' tab-active' : '';
        return '<a role="tab" class="tab' + active + '" data-view="' + item.id + '">' +
          (item.icon ? item.icon + ' ' : '') + item.label + '</a>';
      }).join('') + '</div>';
  }

  // ── View rendering — ADAPT: add component-specific props ──
  function renderView(viewId) {
    currentView = viewId;
    var viewEl = document.getElementById('view-content');
    if (!viewEl) return;
    viewEl.innerHTML = '';

    switch (viewId) {
${viewCases}
    default:
      viewEl.innerHTML = '<div class="alert alert-info"><span>' + t('app.empty') + '</span></div>';
    }

    // Update nav active state
    if (appContainer) {
      appContainer.querySelectorAll('[data-view]').forEach(function(el) {
        if (el.getAttribute('data-view') === viewId) el.classList.add('tab-active');
        else el.classList.remove('tab-active');
      });
    }
  }

  function navigateTo(viewId) { renderView(viewId); }

  // ── Translation ──
  async function getTranslations(locale) {
    try {
      return await AIMEAT.data.get('${serviceSlug}.i18n.' + locale)
          || await AIMEAT.data.get('i18n.' + locale)
          || {};
    } catch (e) { return {}; }
  }

  function t(key, vars) {
    var str = translations[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function(k) {
        str = str.replace('$' + '{' + k + '}', vars[k]);
      });
    }
    return str;
  }

  async function switchLocale(locale) {
    currentLocale = locale;
    translations = await getTranslations(locale);
    if (appContainer) render(appContainer);
  }

  var exports = { init: init, render: render, t: t, switchLocale: switchLocale, getTranslations: getTranslations };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));`;

  return {
    label: data.componentLabel || '',
    project_description: data.projectDescription || '',
    feature_apis: featureApis,
    data_cortex_section: dataCortexSection,
    translation_keys: translationKeys,
    spec_section: specSection,
    service_slug: serviceSlug,
    platform_layout_section: platformLayoutSection,
    app_domain_template: appDomainTemplate,
  };
}

function resolveAppSpec(data: PromptRuntimeData): Vars {
  // App spec is simple — name, theme, locale. All cortex info comes from blueprint.
  const bp = data.blueprint;
  const comps = data.completedComponents || [];

  // List all registered cortexes with their specs
  const cortexes = comps.filter(c => c.type === 'cortex' && c.registeredAs);
  const cortexList = cortexes.map(c => {
    const sp = c.spec as Record<string, unknown> | undefined;
    return `- ${c.registeredAs} (${c.subtype || c.type})${sp?.libName ? ` — libName: ${sp.libName}` : ''}`;
  }).join('\n') || 'No cortex dependencies';

  return {
    component_label: data.componentLabel || '',
    project_description: data.projectDescription || '',
    cortex_dependencies: cortexList,
  };
}

function resolveApp(data: PromptRuntimeData): Vars {
  // Find app-domain cortex — try subtype first, then fall back to spec.methods check
  const appDomainComp2 = (data.completedComponents || [])
    .find(c => c.type === 'cortex' && (c.subtype === 'app-domain' || (c.spec as Record<string, unknown>)?.methods) && c.registeredAs);
  const appDomainSpec = appDomainComp2?.spec as Record<string, unknown> | undefined;

  // Build cortex script loads — prefer app spec's cortexDependencies if available
  const appSpec = data.selfSpec as Record<string, unknown> | undefined;
  const specDeps = appSpec?.cortexDependencies as string[] | undefined;
  const cortexComponents = (data.completedComponents || []).filter(c => c.type === 'cortex');
  let cortexScriptLoads = '';
  let cortexInstructions = '';

  const cortexLibs = cortexComponents.map(c => {
    const libName = c.registeredAs || c.label;
    return { name: libName, label: c.label, result: c.result };
  });

  if (specDeps && specDeps.length > 0) {
    cortexScriptLoads = specDeps.map(name =>
      `    await loadScript('/v1/cortex/${name}/libs/${name}.js');`
    ).join('\n');
  } else if (cortexLibs.length > 0) {
    cortexScriptLoads = cortexLibs.map(lib =>
      `    await loadScript('/v1/cortex/${lib.name}/libs/${lib.name}.js');`
    ).join('\n');
  }

  if (cortexLibs.length > 0) {
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

### UI Styling

DaisyUI + Tailwind CSS are loaded via CDN in the HTML head.
Use daisyUI CSS classes for all UI components: \`class="card"\`, \`class="table"\`, \`class="btn"\`, \`class="tabs"\`, etc.
Do NOT load aimeat-ui-* libraries — use daisyUI instead.
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

  // App-domain cortex lib name — from app's OWN spec, then fallback
  // appSpec already declared at top of resolveApp
  const appDomainLib = (appSpec?.appDomainLib as string)
    || ((appDomainSpec as Record<string, unknown>)?.libName as string)
    || (appDomainComp2?.contextBundle?.libName as string)
    || ((appDomainComp2?.registeredAs as string) || 'app').replace(/-([a-z0-9])/g, (_: string, ch: string) => ch.toUpperCase());
  if (!appSpec?.appDomainLib) logger.error(`[resolveApp] ⚠️ App spec missing appDomainLib — using fallback: ${appDomainLib}`);

  // App metadata — from spec or blueprint
  const bp = data.blueprint;
  const appComp = bp.components?.find(c => c.type === 'app');
  const appName = (appSpec?.name as string) || ((appComp?.label as string) || data.componentLabel || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const appTitle = (appSpec?.title as string) || (appComp?.label as string) || data.componentLabel || 'AIMEAT App';
  const appDescription = (appSpec?.description as string) || data.projectDescription || '';
  const appLocale = (appSpec?.locale as string) || 'fi';
  const appTheme = (appSpec?.daisyTheme as string) || 'light';

  return {
    label: data.componentLabel || '',
    project_context: projectContext,
    cortex_script_loads: cortexScriptLoads,
    cortex_or_api_section: cortexOrApiSection,
    cortex_rules: hasCortex ? '- Call cortex init() on app start — it handles everything automatically\n- Focus on UX/UI — the cortex handles data access and initialization' : '',
    app_name: appName,
    app_title: appTitle,
    app_description: appDescription,
    app_domain_lib: appDomainLib,
    app_locale: appLocale,
    app_theme: appTheme,
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

// ── Component cortex test resolver ──

function resolveTestCortexComponent(data: PromptRuntimeData): Vars {
  const bp = data.blueprint;
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  const libName = (spec?.libName as string) || (spec?.name as string) || '';

  // Spec section
  let specSection = '';
  if (spec) {
    specSection = `\n## Component Spec\n\`\`\`json\n${JSON.stringify(spec, null, 2).slice(0, 3000)}\n\`\`\`\n`;
  }

  // Data cortex info — inject SPEC with returnsExamples so the test knows the exact data shapes
  const dataCortex = (data.completedComponents || []).find(c => c.type === 'cortex' && c.subtype === 'data');
  const dcBundle = dataCortex?.contextBundle;
  const dcSpec = dataCortex?.spec as Record<string, unknown> | undefined;
  let dataCortexInfo = '';
  if (dcBundle || dcSpec) {
    const libName2 = (dcSpec?.libName as string) || dcBundle?.libName || dcBundle?.registeredAs || '';
    dataCortexInfo = `\nThe data cortex is loaded at: window.AIMEAT.${libName2}\n`;
    dataCortexInfo += `\nIMPORTANT: All data cortex methods take a SINGLE OBJECT parameter: dataCortex.getCompany({businessId: '3323553-5'})\nNEVER pass plain strings: dataCortex.getCompany('3323553-5') is WRONG.\n`;

    // Inject method return shapes from spec
    const methods = (dcSpec?.methods as Array<Record<string, unknown>>) || [];
    if (methods.length > 0) {
      dataCortexInfo += '\n### Data Cortex Methods and Return Shapes\n\n';
      for (const m of methods) {
        dataCortexInfo += `**${m.name}(${m.params || ''})** → ${m.returns || 'unknown'}\n`;
        if (m.returnsExample) {
          const example = typeof m.returnsExample === 'string' ? m.returnsExample : JSON.stringify(m.returnsExample, null, 2);
          dataCortexInfo += `\`\`\`json\n${example.substring(0, 400)}\n\`\`\`\n`;
        }
        dataCortexInfo += '\n';
      }
      dataCortexInfo += 'CRITICAL: Data has NESTED OBJECTS. businessId is {value: "..."} NOT a plain string. names is [{name: "..."}] NOT a string array.\nUse: company.businessId.value, company.names[0].name\n';
    }
  } else {
    dataCortexInfo = warnFallback('gen-test-cortex-component', 'data_cortex_info', 'No data cortex available on test page.');
  }

  // Project context
  const bpComponents = bp.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';
  const useCases = data.interviewSpec?.useCases
    ? (data.interviewSpec.useCases as Array<Record<string, string>>).map((uc, i) => {
        if (typeof uc === 'string') return `${i + 1}. ${uc}`;
        return `${i + 1}. ${uc.description || uc.title || JSON.stringify(uc)}`;
      }).join('\n')
    : 'No use cases specified';

  // Service slug for translation loading
  const extComp2 = (data.completedComponents || []).find(c => c.type === 'extension' && c.registeredAs);
  const serviceSlug2 = (extComp2?.registeredAs as string) || 'service';

  // Data cortex lib name and first method for template
  const dcLibName = (dcSpec?.libName as string) || dcBundle?.libName || dcBundle?.registeredAs || 'dataCortex';
  const dcMethods = (dcSpec?.methods as Array<Record<string, unknown>>) || [];
  const firstMethod = dcMethods[0];
  const firstMethodName = (firstMethod?.name as string) || 'getData';
  const firstMethodParams = (firstMethod?.params as string) || '{}';

  // Build method list for ADAPT comment
  const methodList = dcMethods.map(m => `${m.name}(${m.params || ''})`).join(', ') || 'no methods available';

  // Build pre-filled test template
  const testTemplate = `// ── Test scaffolding (do not remove) ──
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

// ── Library checks ──
const lib = window.AIMEAT.${libName};
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }
if (typeof lib.render !== 'function') { fail('render not a function'); window.__testResults = results; return; }
pass('Component library loaded');

const dataCortex = window.AIMEAT.${dcLibName};
if (!dataCortex) { fail('Data cortex not loaded'); window.__testResults = results; return; }
pass('Data cortex loaded');

// ── Load translations ──
const translations = await AIMEAT.data.get('${serviceSlug2}.i18n.fi') || {};
log('Loaded ' + Object.keys(translations).length + ' translation keys');

// ── ADAPT: Fetch test data ──
// Available methods: ${methodList}
// All methods take OBJECT params: dataCortex.method({key: 'value'})
let testData;
try {
  testData = await dataCortex.${firstMethodName}(${firstMethodParams});
  log('Data: ' + JSON.stringify(testData).substring(0, 200));
} catch (e) {
  log('Data fetch error: ' + e.message + ' — testing with empty data');
}

// ── Render ──
const container = document.createElement('div');
container.id = 'test-container';
document.body.appendChild(container);

// ADAPT: adjust render props for this component
const result = await lib.render(container, {
  locale: 'fi',
  translations: translations,
  // TODO: add component-specific props from testData
});

// ── Wait for async DOM (do not remove) ──
await new Promise(r => setTimeout(r, 3000));

// ── Check DOM output ──
log('Container HTML length: ' + container.innerHTML.length);
if (container.innerHTML.length < 50) fail('render: container nearly empty');
else pass('render: produced HTML content');

const text = container.textContent || '';
log('Container text (first 300): ' + text.substring(0, 300));

// ── ADAPT: Check component-specific content ──
if (text.length > 20) pass('render: has text content');
else fail('render: no text content');

// ── Check daisyUI usage ──
const hasDaisyUI = container.querySelector('[class*="card"], [class*="table"], [class*="badge"], [class*="btn"], [class*="alert"], [class*="tabs"], [class*="stat"], [class*="timeline"]');
if (hasDaisyUI) pass('render: uses daisyUI components');
else log('Note: no daisyUI classes detected');

// ── Check translations ──
const rawKeys = (text.match(/app\\.[a-z]+\\.[a-z]+/g) || []);
if (Object.keys(translations).length > 0 && rawKeys.length > 3) {
  fail('render: ' + rawKeys.length + ' raw translation keys: ' + rawKeys.slice(0,5).join(', '));
} else {
  pass('render: translations applied');
}

// ── Snapshot (do not remove) ──
window.__renderSnapshot = container.innerHTML;

// ── Check return object ──
if (result && result.el instanceof HTMLElement) pass('render: returned {el}');
else log('Note: no el returned (component may use container directly)');

if (result && typeof result.destroy === 'function') {
  try { result.destroy(); pass('destroy: OK'); }
  catch (e) { fail('destroy threw: ' + e.message); }
}

// ── Cleanup (do not remove) ──
if (container.parentNode) container.parentNode.removeChild(container);
if (results.errors.length === 0) results.passed = true;
window.__testResults = results;`;

  return {
    component_label: data.componentLabel || '',
    registered_as: (spec?.name as string) || '',
    lib_name: libName,
    spec_section: specSection,
    data_cortex_info: dataCortexInfo,
    project_context: `## Project Context\nBlueprint components:\n${bpComponents}\n\nUse cases:\n${useCases}`,
    test_template: testTemplate,
  };
}

// ── App-domain cortex test resolver ──

function resolveTestCortexAppDomain(data: PromptRuntimeData): Vars {
  const bp = data.blueprint;
  const spec = data.selfSpec as Record<string, unknown> | undefined;
  const libName = (spec?.libName as string) || (spec?.name as string) || '';

  // Spec section
  let specSection = '';
  if (spec) {
    specSection = `\n## App-Domain Spec\n\`\`\`json\n${JSON.stringify(spec, null, 2).slice(0, 3000)}\n\`\`\`\n`;
  }

  // Feature components
  const featureComps = (data.completedComponents || []).filter(c =>
    c.type === 'cortex' && (c.subtype === 'component' || c.subtype === 'feature'));
  const featureComponents = featureComps.length > 0
    ? featureComps.map(c => {
        const b = c.contextBundle;
        return `- ${b?.name || c.label}: AIMEAT.${b?.libName || c.registeredAs || ''} (exports: ${(b?.exports || []).join(', ')})`;
      }).join('\n')
    : 'No feature components registered yet.';

  // Data cortex info
  const dataCortex = (data.completedComponents || []).find(c => c.type === 'cortex' && c.subtype === 'data');
  const dcBundle = dataCortex?.contextBundle;
  let dataCortexInfo = '';
  if (dcBundle) {
    dataCortexInfo = `window.AIMEAT.${dcBundle.libName || dcBundle.registeredAs || ''} — methods: ${(dcBundle.exports || []).join(', ')}`;
  } else {
    dataCortexInfo = warnFallback('gen-test-cortex-app-domain', 'data_cortex_info', 'No data cortex available.');
  }

  // Project context
  const bpComponents = bp.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';

  // Build pre-filled app-domain test template
  const testTemplate = `// ── Test scaffolding (do not remove) ──
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

// ── Library check ──
const lib = window.AIMEAT.${libName};
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }
pass('App-domain library loaded');

// 1. TEST INIT
log('Testing init...');
try {
  const initResult = await lib.init();
  log('init returned: ' + JSON.stringify(initResult));
  pass('init: completed successfully');
} catch (e) {
  fail('init: threw error: ' + e.message);
}

// 2. TEST RENDER
log('Testing render...');
const container = document.createElement('div');
container.id = 'test-app-container';
container.style.width = '1024px';
container.style.height = '768px';
document.body.appendChild(container);

try {
  await lib.render(container);
} catch (e) {
  fail('render: threw error: ' + e.message);
}

// ── Wait for async DOM (do not remove) ──
await new Promise(r => setTimeout(r, 3000));

// ── Check DOM output ──
log('Container HTML length: ' + container.innerHTML.length);
if (container.innerHTML.length < 100) fail('render: container nearly empty');
else pass('render: produced HTML content (' + container.innerHTML.length + ' chars)');

// ── Check navigation (daisyUI) ──
const hasNav = container.querySelector('[class*="tabs"], [class*="menu"], [class*="navbar"], [class*="drawer"], nav');
if (hasNav) pass('render: navigation elements found');
else log('Note: no navigation elements detected');

// ── Check daisyUI usage ──
const hasDaisyUI = container.querySelector('[class*="card"], [class*="table"], [class*="btn"], [class*="tabs"], [class*="drawer"]');
if (hasDaisyUI) pass('render: uses daisyUI components');
else log('Note: no daisyUI classes detected');

// ── ADAPT: Check component-specific content ──
const text = container.textContent || '';
log('Container text (first 300): ' + text.substring(0, 300));
if (text.length > 50) pass('render: has text content');
else fail('render: no text content');

// 3. TEST t() FUNCTION
if (typeof lib.t === 'function') {
  const translated = lib.t('app.title');
  log('t("app.title") = ' + translated);
  if (translated && translated !== 'app.title') pass('t: translates keys');
  else log('Note: t() returned raw key (translations may not be loaded)');
}

// 4. TEST switchLocale
if (typeof lib.switchLocale === 'function') {
  try {
    await lib.switchLocale('en');
    pass('switchLocale: executed without error');
  } catch (e) {
    log('Note: switchLocale threw: ' + e.message);
  }
}

// ── Snapshot (do not remove) ──
window.__renderSnapshot = container.innerHTML;

// ── Cleanup (do not remove) ──
if (container.parentNode) container.parentNode.removeChild(container);
if (results.errors.length === 0) results.passed = true;
window.__testResults = results;`;

  return {
    component_label: data.componentLabel || '',
    registered_as: (spec?.name as string) || '',
    lib_name: libName,
    spec_section: specSection,
    feature_components: featureComponents,
    data_cortex_info: dataCortexInfo,
    project_context: `## Project Context\nBlueprint components:\n${bpComponents}`,
    test_template: testTemplate,
  };
}

// ── App test resolver ──

function resolveTestApp(data: PromptRuntimeData): Vars {
  const bp = data.blueprint;
  const bpComponents = bp.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';

  // App-domain lib name — from app's OWN spec first, then fallback
  const appSpec = data.selfSpec as Record<string, unknown> | undefined;
  const appDomain = (data.completedComponents || []).find(c => c.type === 'cortex' && (c.subtype === 'app-domain' || (c.spec as Record<string, unknown>)?.methods) && c.registeredAs);
  const appDomainSpec2 = appDomain?.spec as Record<string, unknown> | undefined;
  const appLibName = (appSpec?.appDomainLib as string)
    || (appDomainSpec2?.libName as string)
    || (appDomain?.contextBundle?.libName as string)
    || ((appDomain?.registeredAs as string) || 'app').replace(/-([a-z0-9])/g, (_: string, ch: string) => ch.toUpperCase());
  if (!appSpec?.appDomainLib) logger.error(`[resolveTestApp] ⚠️ App spec missing appDomainLib — using fallback: ${appLibName}`);

  const testTemplate = `// ── Test scaffolding (do not remove) ──
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

// ── Check app-domain cortex ──
const appLib = window.AIMEAT.${appLibName};
if (!appLib) { fail('App-domain library ${appLibName} not loaded'); window.__testResults = results; return; }
pass('App-domain library loaded');

// ── Init ──
try {
  const initResult = await appLib.init();
  log('init returned: ' + JSON.stringify(initResult).substring(0, 200));
  pass('init: completed');
} catch (e) {
  fail('init threw: ' + e.message);
}

// ── Render into #app ──
const appEl = document.getElementById('app') || document.createElement('div');
if (!appEl.id) { appEl.id = 'app'; document.body.appendChild(appEl); }

try {
  await appLib.render(appEl);
} catch (e) {
  fail('render threw: ' + e.message);
}

// ── Wait for async DOM (do not remove) ──
await new Promise(r => setTimeout(r, 3000));

// ── Check content ──
log('App HTML length: ' + appEl.innerHTML.length);
if (appEl.innerHTML.length < 100) fail('render: app container nearly empty');
else pass('render: produced HTML content');

const text = appEl.textContent || '';
log('App text (first 300): ' + text.substring(0, 300));
if (text.length > 50) pass('render: has text content');
else fail('render: no text content');

// ── Check daisyUI ──
const hasDaisyUI = appEl.querySelector('[class*="card"], [class*="table"], [class*="btn"], [class*="tabs"], [class*="menu"], [class*="drawer"]');
if (hasDaisyUI) pass('render: uses daisyUI components');
else log('Note: no daisyUI classes detected');

// ── Check navigation ──
const hasNav = appEl.querySelector('[class*="tabs"], [class*="menu"], [class*="drawer"], [data-view], nav');
if (hasNav) pass('render: navigation present');
else log('Note: no navigation found');

// ── Check text content (do NOT test individual components — they have their own tests) ──

// ── Snapshot (do not remove) ──
window.__renderSnapshot = appEl.innerHTML;

// ── Cleanup (do not remove) ──
if (results.errors.length === 0) results.passed = true;
window.__testResults = results;`;

  return {
    component_label: data.componentLabel || '',
    project_context: `## Project Context\nBlueprint components:\n${bpComponents}`,
    test_template: testTemplate,
  };
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
