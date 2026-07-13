/**
 * @file generator-prompts-build.js
 * @description DEPRECATED — kept as backup/reference only.
 *   Prompts are now served from the database via GET /v1/generator/:projectId/prompts/:componentId.
 *   The database seeds (generator-prompt-seeds.ts) are the single source of truth.
 *   This file is no longer called by the generator UI for code/spec prompts.
 *   Blueprint and interview prompts may still use this file until they are migrated.
 *
 * @structure
 *   - buildBlueprintPrompt: produces blueprint generation prompt
 *   - buildInterviewPrompt: produces requirements interview conductor prompt
 *   - buildComponentPrompt: per-type component generation prompt dispatcher (DEPRECATED — use API)
 * @usage
 *   // OLD (deprecated): import { buildComponentPrompt } from '/js/services/generator-prompts-build.js';
 *   // NEW: session.fetch('/v1/generator/${projectId}/prompts/${componentId}')
 * @version-history
 *   v2.1.0 — 2026-06-24 — Secretary P5 (S-C): emit `type: secret` (not coerced to string) for secret
 *     settings so the install pipeline encrypts them at rest. See services/extension-secrets.ts.
 *   v1.0.0 — 2026-03-22 — Extracted from generator-prompts.js
 *   v1.1.0 — 2026-03-24 — Add API URL usage rules + notes to extension data source details
 *   v2.0.0 — 2026-04-02 — DEPRECATED: prompts now served from database. File kept as backup.
 */

import { INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES, EXTENSION_CONSUMPTION_RULES, summarizeExtensionApi, summarizeCortexApi } from './generator-prompts-base.js';
import { formatSpecForPrompt } from './generator-specs.js';

// Re-exported from sibling modules (split out to satisfy max-file-lines).
export { buildBlueprintPrompt } from './generator-prompts-build-blueprint.js';
export { buildInterviewPrompt } from './generator-prompts-build-interview.js';

// Cortex prompt modules — eagerly loaded in browser, injected by server.
// The modules are cached after first dynamic import.
let _cortexModules = null;
let _cortexModulesPromise = null;

/** Server-side injection point for cortex modules (called by generator-autopilot.ts) */
export function _setCortexModules(modules) {
  _cortexModules = modules;
}

// Pre-load cortex modules in background — awaited in buildComponentPrompt if needed
if (typeof window !== 'undefined') {
  _cortexModulesPromise = Promise.all([
    import('./generator-prompts-cortex-data.js'),
    import('./generator-prompts-cortex-feature.js'),
    import('./generator-prompts-cortex-app.js'),
    import('./generator-context-bundle.js'),
  ]).then(([data, feature, app, bundle]) => {
    _cortexModules = {
      buildDataCortexPrompt: data.buildDataCortexPrompt,
      buildFeatureCortexPrompt: feature.buildFeatureCortexPrompt,
      buildAppDomainCortexPrompt: app.buildAppDomainCortexPrompt,
      createBundle: bundle.createBundle,
      formatBundlesForPrompt: bundle.formatBundlesForPrompt,
    };
    return _cortexModules;
  }).catch(() => { /* server-side or import failure — cortex prompts unavailable */ });
}

export async function buildComponentPrompt(type, label, projectDescription, blueprint, completedComponents, interviewSpec) {
  const template = COMPONENT_TEMPLATES[type];
  if (!template) throw new Error(`No template for type: ${type}`);

  // Extensions are PROJECT-AGNOSTIC when they have a spec — they describe a platform capability,
  // not a component of a specific project. Other component types still get the project context.
  let context = '';
  if (type === 'extension') {
    // Extension context is minimal — spec provides the contract, data sources provide the details
    context += `Generate an AIMEAT platform extension.\n`;
  } else {
    context += `Project: ${projectDescription}\n`;
  }
  if (blueprint && type !== 'extension') {
    context += `\nBlueprint components: ${blueprint.components.map(c => `${c.id} (${c.type}: ${c.label})`).join(', ')}\n`;
  }

  // Inject interview spec context for app and cortex — use cases, views, style
  if (interviewSpec && (type === 'app' || type === 'cortex')) {
    if (interviewSpec.useCases && interviewSpec.useCases.length > 0) {
      context += '\n## USE CASES (from user interview — the app MUST support ALL of these)\n';
      for (const uc of interviewSpec.useCases) {
        context += `- **${uc.title || uc.id}** [${uc.priority || 'must-have'}]: ${uc.description}\n`;
      }
      context += '\n';
    }
    if (interviewSpec.views && interviewSpec.views.length > 0) {
      context += '## VIEWS (from user interview — implement these as tabs/pages)\n';
      for (const v of interviewSpec.views) {
        context += `- **${v.title}** (${v.type}): ${v.description}`;
        if (v.interactions?.length) context += ` — interactions: ${v.interactions.join(', ')}`;
        context += '\n';
      }
      context += '\n';
    }
    if (interviewSpec.style) {
      const s = interviewSpec.style;
      context += `## STYLE: mood=${s.mood || 'professional'}, layout=${s.layout || 'tabbed'}, typography=${s.typography || 'standard'}\n\n`;
    }
  }

  // Inject relevant dataModel entries — the centralized data contract
  if (blueprint?.dataModel) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const relevant = {};
    for (const [key, schema] of Object.entries(blueprint.dataModel)) {
      // CSM: show all data model keys (CSM defines the service schema)
      if (type === 'csm') {
        relevant[key] = schema;
      }
      // Memory component: show keys it produces
      if (type === 'memory' && schema.producedBy === componentId) {
        relevant[key] = schema;
      }
      // Extension: show keys it produces AND consumes
      if (type === 'extension' && (schema.producedBy === componentId || schema.consumedBy?.includes(componentId))) {
        relevant[key] = schema;
      }
      // Cortex: show all keys it consumes
      if (type === 'cortex' && schema.consumedBy?.includes(componentId)) {
        relevant[key] = schema;
      }
      // App: show all keys it consumes (via cortex)
      if (type === 'app' && schema.consumedBy?.includes(componentId)) {
        relevant[key] = schema;
      }
      // Translation: show i18n keys it produces
      if (type === 'translation' && schema.producedBy === componentId) {
        relevant[key] = schema;
      }
    }
    if (Object.keys(relevant).length > 0) {
      // Strip pipeline metadata (source, producedBy, consumedBy) — these are NOT part of the data shape
      // and AI copies them into the actual values if they're present
      const cleaned = {};
      for (const [key, schema] of Object.entries(relevant)) {
        cleaned[key] = Object.fromEntries(
          Object.entries(schema).filter(([k]) => k !== 'source' && k !== 'producedBy' && k !== 'consumedBy'),
        );
      }
      context += '\n## Domain Data Model (EXACT schemas — follow these precisely)\n';
      context += 'These are the memory key schemas for this component. Use these exact key names and data shapes.\n\n';
      context += '```json\n' + JSON.stringify(cleaned, null, 2) + '\n```\n\n';
    }
  }

  if (completedComponents && completedComponents.length > 0) {
    // ── SPEC-DRIVEN: prefer specs over regex-extracted summaries ──
    // Specs are formal JSON contracts with exact types and examples.
    // They replace summarizeExtensionApi() / summarizeCortexApi() which use lossy regex extraction.
    const withSpecs = completedComponents.filter(c => c.spec);
    const withoutSpecs = completedComponents.filter(c => !c.spec);

    // Inject specs from upstream completed components
    for (const c of withSpecs) {
      if (c.type === 'extension') {
        context += formatSpecForPrompt(c.spec, `Extension Spec: ${c.spec.name}`);
      } else if (c.type === 'cortex' && (c.subtype === 'data' || c.spec?.wrapsExtension)) {
        context += formatSpecForPrompt(c.spec, `Data API Spec: ${c.spec.name}`);
      } else if (c.type === 'cortex' && (c.subtype === 'component' || c.spec?.render)) {
        context += formatSpecForPrompt(c.spec, `Component Spec: ${c.spec.name}`);
      } else if (c.type === 'cortex' && (c.subtype === 'app-domain' || c.spec?.viewComposition)) {
        context += formatSpecForPrompt(c.spec, `App-Domain Spec: ${c.spec.name}`);
      }
    }

    // Fallback: for components without specs, use existing bundle/summary approach
    // This covers CSM, memory, translation, and any legacy components
    if (withoutSpecs.length > 0) {
      const bundled = withoutSpecs.filter(c => c.contextBundle);
      const unbundled = withoutSpecs.filter(c => !c.contextBundle);

      if (bundled.length > 0) {
        const { formatBundlesForPrompt } = _cortexModules || {};
        if (formatBundlesForPrompt) {
          context += formatBundlesForPrompt(bundled.map(c => c.contextBundle));
        } else {
          context += '\nAlready completed:\n';
          for (const c of bundled) {
            const b = c.contextBundle;
            context += `- ${c.id} (${c.type}: ${c.label}): registered as "${b.registeredAs}"`;
            if (b.actions) context += ` — actions: ${b.actions.join(', ')}`;
            if (b.exports) context += ` — exports: ${b.exports.join(', ')}`;
            context += '\n';
          }
        }
      }

      if (unbundled.length > 0) {
        context += '\nAlready completed:\n';
        for (const c of unbundled) {
          context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
          // Fallback to regex summaries for components without specs (legacy path)
          if (c.result && c.type === 'extension') {
            context += `  API summary:\n${summarizeExtensionApi(c.result)}\n`;
            if (c.probeResults && Array.isArray(c.probeResults) && c.probeResults.length > 0 && (type === 'cortex' || type === 'app' || type === 'extension')) {
              context += `\n  ## ACTUAL API RESPONSES (captured from live execution of ${c.registeredAs})\n`;
              context += `  Study these carefully — your code MUST handle these exact data shapes.\n\n`;
              for (const probe of c.probeResults) {
                if (probe.status === 200 && probe.response) {
                  context += `  POST /v1/ext/${c.registeredAs}/${probe.action} ${JSON.stringify(probe.input)}\n`;
                  context += `  → ${JSON.stringify(probe.response)}\n\n`;
                }
              }
            }
          } else if (c.result && c.type === 'cortex') {
            context += `  API summary:\n${summarizeCortexApi(c.result)}\n`;
          }
        }
      }
    }
  }

  // For memory components with static data: only include if this component's dataModel has source:"static"
  if (type === 'memory' && interviewSpec?.dataSources && blueprint?.dataModel) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const hasStaticKey = componentId && Object.values(blueprint.dataModel).some(
      schema => schema.source === 'static' && schema.producedBy === componentId
    );
    if (hasStaticKey) {
      const staticSources = interviewSpec.dataSources.filter(ds => ds.staticData && Array.isArray(ds.staticData));
      if (staticSources.length > 0) {
        context += '\n## Static Data from Interview\n';
        context += 'The user provided complete datasets. Store each as a SINGLE memory key (one array value, not one key per entry).\n';
        context += 'The dataModel above shows the exact schema. Include ALL entries in the value.\n\n';
        for (const ds of staticSources) {
          context += `### ${ds.name} (${ds.staticData.length} entries)\n`;
          context += '```json\n' + JSON.stringify(ds.staticData, null, 2) + '\n```\n\n';
        }
      }
    }
  }

  // Inject scheduled jobs from blueprint to extension prompts
  if (type === 'extension' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.schedules && comp.schedules.length > 0) {
      context += '\n## Scheduled Jobs (from blueprint — MUST include in manifest)\n';
      context += 'This extension has recurring background jobs. Add a `schedules` section to the YAML manifest:\n\n';
      context += '```yaml\nschedules:\n';
      for (const s of comp.schedules) {
        context += `  - id: ${s.action}-scheduled\n    action: ${s.action}\n    cron: "${s.cron}"\n    description: "Scheduled: ${s.action}"\n    instance_scope: false\n    input: {}\n`;
      }
      context += '```\n\n';
      context += 'The scheduler runs these automatically in the background — no browser needed.\n';
    }
  }

  // Inject blueprint settings as extension config keys
  // The user enters settings values BEFORE generation. These values are injected into ctx.config
  // at runtime. The extension MUST use these EXACT key names in ctx.config.
  if (type === 'extension' && blueprint?.settings) {
    const allSettings = [...(blueprint.settings.service || []), ...(blueprint.settings.user || [])];
    if (allSettings.length > 0) {
      context += '\n## Extension Config Keys (from blueprint settings — use EXACTLY these)\n';
      context += 'These settings are injected into `ctx.config` at runtime. Use these EXACT key names:\n\n';
      context += '```yaml\nconfig:\n';
      for (const s of allSettings) {
        // `secret` is preserved as a first-class config type so the install pipeline encrypts the
        // value at rest (AES-256-GCM, node key) and decrypts only just before the sandbox VM.
        const yamlType = s.type === 'secret' ? 'secret' : s.type === 'boolean' ? 'boolean' : s.type === 'number' ? 'number' : 'string';
        context += `  ${s.key}:\n    type: ${yamlType}\n    description: "${s.label}"\n`;
        if (s.required) context += `    required: true\n`;
      }
      context += '```\n\n';
      context += 'In your action code, read these as: `ctx.config?.${allSettings[0].key}`\n';
      context += 'Do NOT rename these keys. Do NOT use different key names like "apiKey" when the blueprint says "' + allSettings[0].key + '".\n\n';
    }
  }

  // Inject required action/method names from blueprint testScenarios
  // These are the EXACT names the component MUST implement — tests will call them by name
  if ((type === 'extension' || type === 'cortex' || type === 'app') && blueprint?.testScenarios) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const scenarios = (blueprint.testScenarios || [])
      .filter(ts => ts.component === componentId)
      .flatMap(ts => ts.scenarios || []);
    if (scenarios.length > 0) {
      const names = [...new Set(scenarios.map(s => s.action))];
      if (type === 'extension') {
        context += '\n## Required Action IDs (from blueprint — use EXACTLY these names)\n';
        context += 'The blueprint specifies these EXACT action IDs. Your extension MUST use these names:\n\n';
        for (const s of scenarios) {
          context += `- **${s.action}** — ${s.expect.split('.')[0]}.\n`;
          if (Object.keys(s.input).length > 0) context += `  Input: ${JSON.stringify(s.input)}\n`;
        }
        context += `\nDo NOT rename these actions. Use "${names.join('", "')}" as the action id values in your YAML manifest.\n`;
        context += 'If you use different names (e.g., "getCandles" instead of "fetchCandles"), validation WILL fail.\n\n';
      } else if (type === 'cortex') {
        context += '\n## Required Method Names (from blueprint — use EXACTLY these)\n';
        context += 'Tests will call these methods by name. Your cortex MUST export them:\n\n';
        for (const s of scenarios) {
          context += `- **${s.action}()** — ${s.expect.split('.')[0]}.\n`;
          if (Object.keys(s.input).length > 0) context += `  Args: ${JSON.stringify(s.input)}\n`;
        }
        context += '\nDo NOT rename these methods. Validation WILL fail if names don\'t match.\n\n';
      } else if (type === 'app') {
        context += '\n## Required User Flows (from blueprint — the app MUST support these)\n';
        context += 'Tests will verify these workflows exist and function in the UI:\n\n';
        for (const s of scenarios) {
          context += `- **${s.action}** — ${s.expect}\n`;
        }
        context += '\n';
      }
    }
  }

  // Cortex: inject EXTENSION_CONSUMPTION_RULES so cortex knows ALL actions are POST
  if (type === 'cortex') {
    context += '\n' + EXTENSION_CONSUMPTION_RULES + '\n';
  }

  // Cortex: if blueprint produces api:t, cortex MUST include translation helper methods
  if (type === 'cortex' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.produces && comp.produces.some(p => p === 'api:t')) {
      context += `\n## REQUIRED: Translation Helper Methods

Your cortex MUST include these translation methods (blueprint produces "api:t"):

\`\`\`javascript
// Translation helper — MUST be included
async function getTranslations(locale) {
  const strings = await readExtMemory(EXT.name, 'i18n.' + (locale || 'fi'));
  return strings || {};
}

function t(key, translations) {
  if (!translations) return key;
  const parts = key.split('.');
  let val = translations;
  for (const p of parts) {
    val = val?.[p];
    if (val === undefined) return key;
  }
  return val;
}
\`\`\`

Export both as public methods: getTranslations(locale) and t(key, translations).
The app calls getTranslations() during startup and t() for every UI string.
If these are missing, the app WILL crash with "getTranslations is not a function".\n`;
    }
  }

  // Thread interview data source details to extension prompts
  if (type === 'extension' && interviewSpec?.dataSources) {
    context += '\n## Data Source Details (from interview — use these to write correct parsers)\n';
    for (const ds of interviewSpec.dataSources) {
      context += `- **${ds.name}** (${ds.type}): ${ds.url || 'user-input'}\n`;
      if (ds.url) {
        context += `  ⚠️ Use this EXACT URL as the base. Do NOT guess or modify the URL structure — read the notes below for how to construct requests.\n`;
      }
      if (ds.encoding) context += `  Encoding: ${ds.encoding}\n`;
      if (ds.notes) context += `  Notes: ${ds.notes}\n`;
      if (ds.responseEnvelope) {
        context += `  Response envelope (top-level JSON structure): \`${typeof ds.responseEnvelope === 'string' ? ds.responseEnvelope : JSON.stringify(ds.responseEnvelope)}\`\n`;
        context += `  ⚠️ Use the EXACT field names from this envelope to access the results array. Do NOT guess field names like "results" or "data" — use what the API actually returns.\n`;
      }
      if (ds.sampleEntry) context += `  Sample entry (ONE item from the results array — write your parser against this):\n  \`\`\`\n  ${typeof ds.sampleEntry === 'string' ? ds.sampleEntry : JSON.stringify(ds.sampleEntry, null, 2)}\n  \`\`\`\n`;
      if (ds.staticData && Array.isArray(ds.staticData)) {
        context += `  **STATIC DATA (${ds.staticData.length} entries) — pre-loaded in OWNER memory. Read with ctx.memory.getPublic(ctx.caller.owner, key), do NOT re-create it.**\n`;
      }
    }
  }

  // Inject use cases from interview spec to app prompts — drives UI design
  if (type === 'app' && interviewSpec?.useCases) {
    const cases = interviewSpec.useCases.map(uc => {
      if (typeof uc === 'string') return uc;
      if (uc?.description) return uc.description;
      if (uc?.title) return uc.title;
      return JSON.stringify(uc);
    }).filter(Boolean);
    if (cases.length > 0) {
      context += '\n## Use Cases (from interview — the app MUST support ALL of these)\n';
      cases.forEach((c, i) => { context += `${i + 1}. ${c}\n`; });
      context += '\nDesign the UI around these workflows. Every use case must be reachable.\n\n';
    }
  }

  // Thread language preference from interview spec to all component prompts
  const specLocale = interviewSpec?.locale;
  if (specLocale && specLocale !== 'en') {
    context += `\n## LANGUAGE\n\nThe user works in "${specLocale}". Write all human-readable text (labels, descriptions, comments, UI strings, variable names for display) in that language.\nCode identifiers, JSON keys, YAML keys, and API names stay in English.\n`;
  }

  // For translation components: if another locale is already done, inject its keys
  // so AI generates matching keys for this locale
  if (type === 'translation' && completedComponents?.length > 0) {
    const otherTranslations = completedComponents.filter(c => c.type === 'translation' && c.result);
    for (const t of otherTranslations) {
      try {
        const parsed = JSON.parse(typeof t.result === 'string' ? t.result : JSON.stringify(t.result));
        const locale = Object.keys(parsed).find(k => typeof parsed[k] === 'object');
        if (locale && parsed[locale]) {
          const keys = Object.keys(parsed[locale]);
          context += `\n## REQUIRED: Match these EXACT keys from the "${locale}" translation\n`;
          context += `The other locale has these ${keys.length} keys. You MUST use the SAME keys:\n`;
          context += `\`\`\`\n${keys.join('\n')}\n\`\`\`\n`;
          context += `Do NOT add extra keys and do NOT omit any keys — the sets must be identical.\n`;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Inject MANDATORY API methods from blueprint produces list into cortex prompt
  // This is THE critical contract: cortex MUST implement exactly these methods
  if (type === 'cortex' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.produces && comp.produces.length > 0) {
      const apiMethods = comp.produces
        .filter(p => p.startsWith('api:'))
        .map(p => p.replace('api:', ''));
      if (apiMethods.length > 0) {
        context += '\n## MANDATORY API METHODS (from blueprint — you MUST implement ALL of these)\n\n';
        context += '╔══════════════════════════════════════════════════════════════════════════╗\n';
        context += '║  Your cortex MUST export EXACTLY these methods. Do NOT rename them.     ║\n';
        context += '║  Do NOT add extra public methods. Do NOT omit any method.               ║\n';
        context += '║  The app component depends on these EXACT names.                        ║\n';
        context += '╚══════════════════════════════════════════════════════════════════════════╝\n\n';
        context += 'Required exports:\n';
        for (const m of apiMethods) {
          context += `- \`${m}()\` — MUST be in the exports object\n`;
        }
        context += '\nThe `exports` object at the bottom of your IIFE must include ALL of these:\n';
        context += '```javascript\nconst exports = { ' + apiMethods.join(', ') + ' };\n```\n\n';
      }
    }

    // Also inject consumes so cortex knows which memory keys to read
    if (comp?.consumes && comp.consumes.length > 0) {
      const memoryKeys = comp.consumes
        .filter(c => c.startsWith('memory:'))
        .map(c => c.replace('memory:', ''));
      if (memoryKeys.length > 0) {
        context += '\n## CONSUMED DATA (memory keys this cortex reads)\n';
        for (const k of memoryKeys) {
          context += `- \`${k}\`\n`;
        }
        context += '\n';
      }
    }
  }

  // Inject "uses" cortex dependencies from blueprint
  if (type === 'cortex' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.uses && comp.uses.length > 0) {
      context += '\n## Reusable Cortex Libraries (from blueprint — load and use these)\n';
      context += 'This cortex component should use the following existing cortex libraries.\n';
      context += 'Load them via `<script>` tags in the prompt component and call their API.\n';
      context += 'Do NOT reimplement their functionality.\n\n';
      // Platform cortex library API reference
      const platformApis = {
        'aimeat-ui-nav': 'Tabs(container, tabs, onSelect), Breadcrumbs(container, items), Sidebar(container, items, onSelect), BottomNav(container, items, onSelect), BurgerMenu(container, items, onSelect)',
        'aimeat-ui-layout': 'MainDetail(container, {main, detail}), DashboardGrid(container, cards), Split(container, {left, right}), Stacked(container, sections), Header(container, {title, actions}), Footer(container, content)',
        'aimeat-ui-viewers': 'DataTable(container, {columns, rows, onRowClick}), Timeline(container, events), Grid(container, items, renderItem), List(container, items, renderItem), Gallery(container, images), Carousel(container, slides)',
        'aimeat-ui-forms': 'Input(container, {label, value, onChange}), Select(container, {label, options, value, onChange}), Toggle(container, {label, checked, onChange}), Checkbox(container, {label, checked, onChange}), FormGroup(container, fields)',
        'aimeat-ui-dialogs': 'toast(message, type), Modal(container, {title, content, onClose}), Confirm({title, message, onConfirm}), Alert({title, message}), ContextMenu(container, items), Dropdown(container, items)',
        'aimeat-charts': 'ChartPanel(container, {type, data, options}), ChartBuilder(container, config), TYPES (bar, line, pie, doughnut, radar, scatter, bubble)',
        'aimeat-canvas': 'DrawingCanvas(container, {width, height, tools, onSave})',
      };
      for (const libName of comp.uses) {
        context += `- **${libName}**: Load via \`<script src="/v1/cortex/${libName}/libs/${libName}.js"></script>\`\n`;
        context += `  Access via \`AIMEAT['${libName}'].*\`\n`;
        if (platformApis[libName]) {
          context += `  API: ${platformApis[libName]}\n`;
        }
      }
      context += '\n';
    }
  }

  // Cortex subtype dispatch — use specialized templates for new multi-cortex architecture
  if (type === 'cortex' && blueprint) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    const subtype = comp?.subtype;

    // Ensure cortex modules are loaded before dispatching
    if (subtype && !_cortexModules && _cortexModulesPromise) {
      await _cortexModulesPromise;
    }
    if (subtype && _cortexModules) {
      const { buildDataCortexPrompt, buildFeatureCortexPrompt, buildAppDomainCortexPrompt, createBundle } = _cortexModules;
      const bundles = (completedComponents || []).map(c => createBundle(c, c.probeResults));

    if (subtype === 'data') {
      return buildDataCortexPrompt(label, projectDescription, blueprint, bundles);
    }
    if (subtype === 'feature' || subtype === 'component') {
      const useCase = interviewSpec?.useCases?.find(uc =>
        label.toLowerCase().includes(uc.title?.toLowerCase().split(' ')[0] || '___')
      ) || interviewSpec?.useCases?.[0];
      const view = interviewSpec?.views?.find(v =>
        label.toLowerCase().includes(v.title?.toLowerCase().split(' ')[0] || '___')
      ) || interviewSpec?.views?.[0];
      const dataCortexBundle = bundles.find(b => b.subtype === 'data');
      const structures = blueprint?.dataModel?.structures || {};
      const translationBundle = bundles.find(b => b.type === 'translation');
      const translationKeys = translationBundle?.keys || [];
      const usesLibs = comp?.uses || [];
      return buildFeatureCortexPrompt(label, useCase, view, dataCortexBundle, structures, translationKeys, usesLibs);
    }
    if (subtype === 'app-domain') {
      const featureBundles = bundles.filter(b => b.subtype === 'feature' || b.subtype === 'component');
      const dataCortexBundle = bundles.find(b => b.subtype === 'data');
      const translationBundle = bundles.find(b => b.type === 'translation');
      return buildAppDomainCortexPrompt(label, projectDescription, featureBundles, dataCortexBundle, translationBundle);
    }
    // Fallback for unknown subtype — use generic cortex template
    return INSTRUCTION_DISCLAIMER + template(label, context, completedComponents);
    } // end if (subtype && _cortexModules)
  }

  // App and cortex templates receive completedComponents for cross-referencing
  if (type === 'app' || type === 'cortex') {
    return INSTRUCTION_DISCLAIMER + template(label, context, completedComponents);
  }

  return INSTRUCTION_DISCLAIMER + template(label, context);
}
