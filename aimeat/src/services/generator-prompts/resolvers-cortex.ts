/**
 * @file src/services/generator-prompts/resolvers-cortex.ts
 * @description Per-prompt resolvers for cortex + app generation prompts (cortex data,
 *   cortex component, cortex app-domain, app spec, app). Extracted from resolvers.ts
 *   to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from resolvers.ts (max-file-lines)
 */

import { logger } from '../../utils/logger.js';
import type { PromptRuntimeData } from './types.js';
import {
  type Vars,
  warnFallback,
  formatStructures,
  formatSpec,
  buildDaisyUiSection,
  buildFullDaisyUiSection,
  DAISYUI_COMPONENTS,
} from './resolver-helpers.js';

export function resolveCortexData(data: PromptRuntimeData): Vars {
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

export function resolveCortexComponent(data: PromptRuntimeData): Vars {
  // Match browser buildFeatureCortexPrompt() — use case, view, structures, data cortex API
  const interview = data.interviewSpec;

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
  let dataCortexApi: string;
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

  // Service slug from blueprint — the single source of truth for namespacing
  const serviceSlug = data.blueprint.service_slug;
  if (!serviceSlug) throw new Error('Blueprint missing "service_slug" — cannot build cortex-component prompt. Regenerate blueprint.');

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

export function resolveCortexAppDomain(data: PromptRuntimeData): Vars {
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

  // Service slug from blueprint — the single source of truth for namespacing
  const serviceSlug = data.blueprint.service_slug;
  if (!serviceSlug) throw new Error('Blueprint missing "service_slug" — cannot build cortex-app-domain prompt. Regenerate blueprint.');

  // DaisyUI layout section from spec's appShell/navStyle
  const appShell = (spec?.appShell as string) || '';
  const navStyle = (spec?.navStyle as string) || '';
  let platformLayoutSection = '';
  if (appShell || navStyle) {
    platformLayoutSection = '## App Shell (daisyUI) — MANDATORY\n\n';
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

export function resolveAppSpec(data: PromptRuntimeData): Vars {
  // App spec is simple — name, theme, locale. All cortex info comes from blueprint.
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

export function resolveApp(data: PromptRuntimeData): Vars {
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

  // Build the conditional cortex-or-api section (browser has hasCortex conditional)
  const hasCortex = cortexComponents.length > 0;

  // H-2 app-origin isolation — applies to EVERY generated app (cortex or not). The app runs on the
  // isolated app origin (`*.apps.<domain>`), a different browser origin from the AIMEAT node, so it
  // has NO ambient login session. Public data is fine same-origin; private data needs an app-grant.
  const appOriginIsolationSection = `## CRITICAL: App origin isolation & data access (read this first)

Your published app runs on an ISOLATED app origin (\`*.apps.<domain>\`, e.g. \`apps.aimeat.io\`) — a DIFFERENT browser origin from the AIMEAT node (\`aimeat.io\`). Consequences you MUST respect:
- The app has NO access to the user's AIMEAT login session, cookie, or localStorage. There is no ambient/owner session.
- NEVER call \`/v1/auth/refresh\` and NEVER fetch with \`credentials:'include'\` expecting the user's session — that was removed for security (H-2) and now returns 401/403.
- PUBLIC data needs no auth: a same-origin \`fetch('/v1/...')\` (CORS \`*\`) works for public memory (\`getPublic\`), the catalogue, and public boards.
- For the user's OWN/PRIVATE data, use the explicit, revocable **app-grant** flow (OAuth-style, PKCE):
  1. Send the user to \`GET https://aimeat.io/v1/app-grants/authorize?app=<owner>/<file>&response_type=code&scope=<space-separated agent scopes>&redirect_uri=<your URL on the app origin>&state=<rnd>&code_challenge=<S256>&code_challenge_method=S256\`. Grantable scopes: memory:read, memory:write, memory:delete, catalogue:read, social:read, social:write, wallet:read, knowledge:read. The user approves on the trusted apex.
  2. Exchange the returned \`code\` (with the PKCE \`code_verifier\`) at \`POST https://aimeat.io/v1/app-grants/token\` (\`{ grant_type:'authorization_code', code, code_verifier, redirect_uri }\`) for \`access_token\` + \`refresh_token\`. Store BOTH in YOUR OWN origin's localStorage.
  3. Call APIs with \`Authorization: Bearer <access_token>\` — never the user's session. Refresh via \`{ grant_type:'refresh_token', refresh_token }\`.
- Apps that use the user's OpenRouter key via cortex (\`AIMEAT.ai.complete()\`) are UNAFFECTED — that path is separate.
The user manages/revokes app tokens in Profile → Access → "Connected Apps". Request the FEWEST scopes you need.

`;

  let cortexOrApiSection: string = appOriginIsolationSection;
  if (hasCortex) {
    cortexOrApiSection += cortexInstructions;
  } else {
    // Non-cortex path — verbatim from browser base.js lines 642-703
    cortexOrApiSection += `### AIMEAT.data API (memory read/write — handles auth and envelope automatically):
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
