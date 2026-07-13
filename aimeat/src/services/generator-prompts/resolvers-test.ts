/**
 * @file src/services/generator-prompts/resolvers-test.ts
 * @description Per-prompt resolvers for the generated-code test prompts (test extension
 *   spec, test cortex spec, test cortex component, test cortex app-domain, test app),
 *   each building golden samples, scenarios, and a pre-filled test template. Extracted
 *   from resolvers.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from resolvers.ts (max-file-lines)
 */

import { logger } from '../../utils/logger.js';
import type { PromptRuntimeData } from './types.js';
import { type Vars, warnFallback } from './resolver-helpers.js';

export function resolveTestExtensionSpec(data: PromptRuntimeData): Vars {
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

export function resolveTestCortexSpec(data: PromptRuntimeData): Vars {
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

// ── Component cortex test resolver ──

export function resolveTestCortexComponent(data: PromptRuntimeData): Vars {
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
  let dataCortexInfo: string;
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

  // Service slug from blueprint — the single source of truth for namespacing
  const serviceSlug2 = data.blueprint.service_slug;
  if (!serviceSlug2) throw new Error('Blueprint missing "service_slug" — cannot build app prompt. Regenerate blueprint.');

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

export function resolveTestCortexAppDomain(data: PromptRuntimeData): Vars {
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
  let dataCortexInfo: string;
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

export function resolveTestApp(data: PromptRuntimeData): Vars {
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
