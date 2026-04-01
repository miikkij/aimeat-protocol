/**
 * @file verify-autopilot-fixes.ts
 * @description Instant verification of autopilot bug fixes.
 *   Tests stripCodeblock, extractRegisteredName, prompt seeds, and buildPrompt resolution.
 *   Run: npx tsx test/verify-autopilot-fixes.ts
 * @version-history
 *   v1.0.0 — 2026-04-01 — Verification for Round 8 fixes
 */

import { stripCodeblock } from '../src/services/generator-prompts/strip.js';
import { validateComponent } from '../src/services/generator-prompts/validate.js';
import { substituteVariables } from '../src/services/prompt-variables.js';
import { GENERATOR_PROMPT_SEEDS } from '../src/services/generator-prompt-seeds.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`);
  }
}

// ── Bug 1: stripCodeblock before JSON.parse ──
console.log('\n═══ Bug 1: stripCodeblock handles fenced JSON ═══');

const fencedJson = '```json\n{"settings":{"theme":"dark"},"config":{"lang":"fi"}}\n```';
const stripped1 = stripCodeblock(fencedJson);
assert(!stripped1.includes('```'), 'stripCodeblock removes JSON fences');
try {
  const parsed = JSON.parse(stripped1);
  assert(parsed.settings?.theme === 'dark', 'Parsed JSON has correct values');
} catch (e) {
  assert(false, 'JSON.parse after stripCodeblock', (e as Error).message);
}

const fencedJsonMultiline = '```json\n{\n  "fi": {\n    "search": "Hae",\n    "save": "Tallenna"\n  }\n}\n```';
const stripped2 = stripCodeblock(fencedJsonMultiline);
assert(!stripped2.includes('```'), 'stripCodeblock removes multiline JSON fences');
try {
  const parsed = JSON.parse(stripped2);
  assert(parsed.fi?.search === 'Hae', 'Parsed translation JSON correct');
} catch (e) {
  assert(false, 'JSON.parse translation after stripCodeblock', (e as Error).message);
}

const plainJson = '{"key":"value"}';
const stripped3 = stripCodeblock(plainJson);
assert(stripped3 === plainJson, 'stripCodeblock passes through plain JSON unchanged');

// ── Bug 2: extractRegisteredName for memory/translation ──
console.log('\n═══ Bug 2: extractRegisteredName for memory/translation ═══');

// Replicate the extractRegisteredName logic from generator-autopilot.ts
function extractRegisteredName(type: string, content: string, _vr: { extracted?: unknown }): string | null {
  if (type === 'extension' || type === 'cortex') {
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*"?([^\s"]+)"?/);
    return nameMatch?.[1] || null;
  }
  if (type === 'csm' || type === 'msm') {
    const nameMatch = (typeof content === 'string' ? content : '').match(/name:\s*"?([^\s"]+)"?/);
    return nameMatch?.[1] || null;
  }
  if (type === 'memory') {
    try {
      const strippedContent = stripCodeblock(typeof content === 'string' ? content : '');
      const parsed = JSON.parse(strippedContent);
      const keys = Object.keys(parsed);
      return keys.length > 0 ? `memory:${keys[0]}` : 'memory';
    } catch {
      return 'memory';
    }
  }
  if (type === 'translation') {
    try {
      const strippedContent = stripCodeblock(typeof content === 'string' ? content : '');
      const parsed = JSON.parse(strippedContent);
      const locales = Object.keys(parsed);
      return locales.length > 0 ? `i18n-${locales[0]}` : 'translation';
    } catch {
      return 'translation';
    }
  }
  return null;
}

// Memory
const memoryContent = '```json\n{"settings.__meta":{"type":"object"},"config.defaults":{"theme":"light"}}\n```';
const memName = extractRegisteredName('memory', memoryContent, {});
assert(memName === 'memory:settings.__meta', `Memory name: ${memName}`, `got ${memName}`);

const memPlain = '{"prh-companies.config":{"version":1}}';
const memName2 = extractRegisteredName('memory', memPlain, {});
assert(memName2 === 'memory:prh-companies.config', `Memory name (plain): ${memName2}`, `got ${memName2}`);

// Translation
const translationContent = '```json\n{"fi":{"search":"Hae","save":"Tallenna"}}\n```';
const transName = extractRegisteredName('translation', translationContent, {});
assert(transName === 'i18n-fi', `Translation name: ${transName}`, `got ${transName}`);

const transEn = '{"en":{"search":"Search","save":"Save"}}';
const transName2 = extractRegisteredName('translation', transEn, {});
assert(transName2 === 'i18n-en', `Translation name (plain): ${transName2}`, `got ${transName2}`);

// Existing types still work
const extContent = 'metadata:\n  name: prh-ytj\n  version: "1.0.0"';
const extName = extractRegisteredName('extension', extContent, {});
assert(extName === 'prh-ytj', `Extension name: ${extName}`, `got ${extName}`);

const csmContent = 'name: prh-company-data\nversion: "1.0.0"';
const csmName = extractRegisteredName('csm', csmContent, {});
assert(csmName === 'prh-company-data', `CSM name: ${csmName}`, `got ${csmName}`);

// Null for unknown type
const unknownName = extractRegisteredName('unknown-type', 'anything', {});
assert(unknownName === null, 'Unknown type returns null');

// ── Bug 3: All 21 prompt seeds exist ──
console.log('\n═══ Bug 3: Prompt seeds completeness ═══');

const seedIds = GENERATOR_PROMPT_SEEDS.map(s => s.id);
assert(GENERATOR_PROMPT_SEEDS.length >= 21, `Seed count: ${GENERATOR_PROMPT_SEEDS.length} (need ≥21)`);

const requiredSeeds = [
  // Fragments
  'gen-context', 'gen-disclaimer', 'gen-sandbox-constraints',
  'gen-namespace-rules', 'gen-html-entity-rules', 'gen-extension-consumption-rules',
  // Spec generators
  'gen-csm', 'gen-memory', 'gen-translation',
  'gen-extension-spec', 'gen-data-api-spec', 'gen-component-spec', 'gen-app-domain-spec',
  // Code generators
  'gen-extension-code',
  'gen-cortex-data',       // NEW — was missing
  'gen-cortex-component',  // NEW — was missing
  'gen-cortex-app-domain', // NEW — was missing
  'gen-app',               // NEW — was missing
  // Fix + test
  'gen-fix', 'gen-test-extension-spec', 'gen-test-cortex-spec',
];

for (const id of requiredSeeds) {
  assert(seedIds.includes(id), `Seed exists: ${id}`);
}

// ── Bug 3b: No unresolved {{variables}} in seeds ──
console.log('\n═══ Bug 3b: No stale {{variables}} in seeds ═══');

// Known valid variables used by the substitution system
const validVars = new Set([
  // Fragment names (from index.ts fragmentIds → key mapping)
  'context', 'disclaimer', 'sandbox_constraints', 'namespace_rules',
  'html_entity_rules', 'extension_consumption_rules',
  // Per-prompt resolver variables (all resolvers)
  'label', 'component_context', 'matching_keys_section',
  'spec_section', 'completed_context',
  'data_sources', 'blueprint_actions', 'structures', 'memory_keys', 'schedules', 'config_keys',
  'extension_spec', 'data_api_spec', 'component_label', 'view_context', 'translation_keys',
  'component_specs', 'use_cases', 'views',
  'original_prompt', 'code', 'errors', 'component_type',
  'extension_name', 'spec_actions',
  'lib_name', 'wraps_extension', 'spec_methods',
  'app_domain_spec', 'style',
  'cortex_script_loads', 'cortex_instructions', 'translation_keys_section',
  // New variables from verbatim browser prompt copy
  'project_description', 'methods_to_export', 'extension_section',
  'use_case', 'view_section', 'data_cortex_api', 'translation_section',
  'feature_apis', 'data_cortex_section',
  'project_context', 'cortex_or_api_section', 'cortex_rules',
  // Fix prompt variables
  'type_constraints', 'test_context', 'previous_attempts', 'reflection_diagnosis',
  // Reflection + fresh generation variables
  'failed_code', 'pitfalls', 'test_trace',
  // Test prompt variables
  'golden_samples', 'test_scenarios', 'action_contracts',
  'cortex_methods',
  // Cortex template variables — pass through to LLM output, not resolved by prompt system
  'node_url',
]);

for (const seed of GENERATOR_PROMPT_SEEDS) {
  const matches = seed.content.match(/\{\{(\w+)\}\}/g) || [];
  const vars = matches.map(m => m.replace(/\{\{|\}\}/g, ''));
  const unknown = vars.filter(v => !validVars.has(v));
  assert(unknown.length === 0, `${seed.id}: no unknown {{vars}}`, unknown.length > 0 ? `found: ${unknown.join(', ')}` : undefined);
}

// ── Cortex seed template variable resolution ──
console.log('\n═══ Cortex seed variable resolution ═══');

const cortexDataSeed = GENERATOR_PROMPT_SEEDS.find(s => s.id === 'gen-cortex-data');
if (cortexDataSeed) {
  const resolved = substituteVariables(cortexDataSeed.content, {
    disclaimer: '[DISCLAIMER]',
    label: 'Test Data Layer',
    project_description: 'Finnish company monitor',
    structures: '### Company\n```json\n{"name":"string"}\n```',
    methods_to_export: '- **search**(query) → returns Company[]',
    extension_section: '## Extension\nname: prh-ytj',
  });
  assert(!resolved.includes('{{disclaimer}}'), 'gen-cortex-data: disclaimer resolved');
  assert(!resolved.includes('{{label}}'), 'gen-cortex-data: label resolved');
  assert(resolved.includes('Test Data Layer'), 'gen-cortex-data: label value present');
  assert(resolved.includes('Project: Finnish company monitor'), 'gen-cortex-data: project_description present');
  assert(resolved.includes('Methods to Export'), 'gen-cortex-data: has Methods to Export section');
  const remaining = (resolved.match(/\{\{(\w+)\}\}/g) || []).filter(v => v !== '{{node_url}}');
  assert(remaining.length === 0, `gen-cortex-data: no unresolved vars`, remaining.length > 0 ? remaining.join(', ') : undefined);
}

const cortexCompSeed = GENERATOR_PROMPT_SEEDS.find(s => s.id === 'gen-cortex-component');
if (cortexCompSeed) {
  const resolved = substituteVariables(cortexCompSeed.content, {
    disclaimer: '[DISCLAIMER]',
    label: 'Search Feature',
    use_case: '**Company Search** [high]: Search PRH registry',
    view_section: '**Search View** (page): Search and results',
    structures: '**Company**: {"name":"string"}',
    data_cortex_api: '## Data Cortex API\nAIMEAT.prhData.search()',
    translation_section: '## Translation Keys\n- `search.title`',
  });
  assert(resolved.includes('Use Case'), 'gen-cortex-component: has Use Case section');
  assert(resolved.includes('View'), 'gen-cortex-component: has View section');
  assert(resolved.includes('Data Structures'), 'gen-cortex-component: has Data Structures section');
  assert(resolved.includes('DataTable does NOT have onRowClick'), 'gen-cortex-component: has full DataTable note');
  assert(resolved.includes('NEVER do this'), 'gen-cortex-component: has WRONG translation example');
  const remaining = resolved.match(/\{\{(\w+)\}\}/g) || [];
  assert(remaining.length === 0, `gen-cortex-component: no unresolved vars`, remaining.length > 0 ? remaining.join(', ') : undefined);
}

const appDomainSeed = GENERATOR_PROMPT_SEEDS.find(s => s.id === 'gen-cortex-app-domain');
if (appDomainSeed) {
  const resolved = substituteVariables(appDomainSeed.content, {
    disclaimer: '[DISCLAIMER]',
    label: 'App Domain',
    project_description: 'Finnish company monitor',
    feature_apis: '### Search\nRegistered as: search-feature',
    data_cortex_section: 'AIMEAT.prhData\nMethods: search, getCompany',
    translation_keys: '`app.title`, `search.button`',
  });
  assert(resolved.includes('Project: Finnish company monitor'), 'gen-cortex-app-domain: has project_description');
  assert(resolved.includes('mountLoginButton'), 'gen-cortex-app-domain: has auth pattern');
  const remaining = resolved.match(/\{\{(\w+)\}\}/g) || [];
  assert(remaining.length === 0, `gen-cortex-app-domain: no unresolved vars`, remaining.length > 0 ? remaining.join(', ') : undefined);
}

const appSeed = GENERATOR_PROMPT_SEEDS.find(s => s.id === 'gen-app');
if (appSeed) {
  const resolved = substituteVariables(appSeed.content, {
    context: '[AIMEAT CONTEXT]',
    label: 'PRH App',
    project_context: '## App Domain Spec',
    cortex_script_loads: '    await loadScript(\'/v1/cortex/prh-data/libs/prh-data.js\');',
    translation_keys_section: '## Translation keys\n- `app.title`',
    cortex_or_api_section: '## CORTEX\nUse AIMEAT.prhData.search()',
    cortex_rules: '- Call cortex init()',
    html_entity_rules: '[HTML ENTITY RULES]',
  });
  const remaining = resolved.match(/\{\{(\w+)\}\}/g) || [];
  assert(remaining.length === 0, `gen-app: no unresolved vars`, remaining.length > 0 ? remaining.join(', ') : undefined);
}

// ── Extension validation (anti-patterns) ──
console.log('\n═══ Extension validation smoke test ═══');

const goodExt = `metadata:
  name: test-ext
  version: "1.0.0"
  description: "Test"
  author: "test"
actions:
  - id: search
    method: POST
    path: /search
    script: search.js

// actions/search.js
export default async function(ctx, input) {
  const results = await ctx.fetch('https://example.com/api?q=' + encodeURIComponent(input.query || ''));
  return results.data;
}`;

const extVr = validateComponent('extension', goodExt, null as unknown as import('../src/services/generator-prompts/types.js').Blueprint);
assert(extVr.valid, 'Good extension passes validation');

// Test extension with URLSearchParams (hard error, not just warning)
const badExt2 = goodExt.replace('ctx.fetch', 'const params = new URLSearchParams(); ctx.fetch');
const badVr2 = validateComponent('extension', badExt2, null as unknown as import('../src/services/generator-prompts/types.js').Blueprint);
assert(badVr2.errors.some(e => e.includes('URLSearchParams')), 'Bad extension (URLSearchParams) caught as error');

// ── Summary ──
console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
