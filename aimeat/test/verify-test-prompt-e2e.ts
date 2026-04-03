/**
 * End-to-end verification of the gen-test-cortex-component prompt.
 * Builds the FULL prompt and checks that:
 * 1. await is in the render() call
 * 2. Translation loading uses real service slug
 * 3. No {{placeholders}} remain unresolved
 * Run: npx tsx test/verify-test-prompt-e2e.ts
 */
import { readFileSync } from 'node:fs';
import { resolvePromptVars } from '../src/services/generator-prompts/resolvers.js';
import { GENERATOR_PROMPT_SEEDS } from '../src/services/generator-prompt-seeds.js';
import type { PromptRuntimeData } from '../src/services/generator-prompts/types.js';

const blueprint = JSON.parse(readFileSync('data/debug/generator/prj-mnisxg4m-todlc/blueprint.json', 'utf8'));

const completedComponents = [
  { type: 'extension', registeredAs: 'prh-ytj-company-registry', subtype: null, spec: null },
  { type: 'csm', registeredAs: 'yritystietopalvelu', subtype: null },
  { type: 'cortex', subtype: 'data', registeredAs: 'prh-ytj-company-registry',
    spec: { name: 'prh-ytj-company-registry', libName: 'prhYtjCompanyRegistry', methods: [
      { name: 'searchCompanies', params: '{ query: string }', returns: 'Promise<CompanySearchResult>', returnsExample: '{ totalResults: 1, companies: [...] }' },
      { name: 'getCompany', params: '{ businessId: string }', returns: 'Promise<Company>', returnsExample: '{ businessId: { value: "3323553-5" }, names: [{ name: "Overscale Solutions Oy" }] }' },
    ]},
    contextBundle: { libName: 'prhYtjCompanyRegistry', registeredAs: 'prh-ytj-company-registry', exports: ['searchCompanies', 'getCompany'] }
  },
  { type: 'translation', registeredAs: 'i18n-fi', subtype: null, contextBundle: { keys: ['app.search', 'app.company.name', 'app.loading'] } },
];

const componentSpec = {
  name: 'yrityskortti',
  libName: 'yrityskortti',
  render: { signature: 'AIMEAT.yrityskortti.render(container, props)', props: { locale: 'string', onSelect: 'function' } },
};

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); }
}

console.log('\n═══ gen-test-cortex-component FULL PROMPT ═══');

// Get template from seeds
const seed = GENERATOR_PROMPT_SEEDS.find(s => s.id === 'gen-test-cortex-component');
if (!seed) { console.error('Seed not found!'); process.exit(1); }

// Resolve variables
const vars = await resolvePromptVars(
  null as any,
  'gen-test-cortex-component',
  {
    blueprint,
    interviewSpec: { useCases: [{ title: 'Search', description: 'Search companies' }], views: [{ title: 'Search', type: 'list' }] },
    componentLabel: 'Yrityskortti',
    blueprintComponent: blueprint.components.find((c: Record<string, unknown>) => c.id === 'component-company-card'),
    selfSpec: componentSpec,
    completedComponents,
    translationKeys: ['app.search', 'app.company.name', 'app.loading'],
  } as unknown as PromptRuntimeData,
  {}
);

// Stitch template with variables (same as buildPrompt does)
let prompt = seed.content;
for (const [key, val] of Object.entries(vars)) {
  prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || '');
}
// Resolve disclaimer (shared fragment)
const disclaimerSeed = GENERATOR_PROMPT_SEEDS.find(s => s.id === 'gen-disclaimer');
if (disclaimerSeed) {
  prompt = prompt.replace(/\{\{disclaimer\}\}/g, disclaimerSeed.content);
}

// Check no unresolved placeholders
const unresolvedMatches = prompt.match(/\{\{[a-z_]+\}\}/g) || [];
assert(unresolvedMatches.length === 0, 'No unresolved {{placeholders}}', unresolvedMatches.join(', '));

// Check await in render example
assert(prompt.includes('await lib.render('), 'Example has "await lib.render()"');

// Check translation loading with real slug
assert(prompt.includes("AIMEAT.data.get('prh-ytj-company-registry.i18n.fi')"), 'Translation loading uses real service slug');
assert(!prompt.includes("AIMEAT.data.get('my-service"), 'No placeholder "my-service" in translation loading');

// Check data cortex info
assert(prompt.includes('prhYtjCompanyRegistry'), 'Prompt has data cortex lib name');
assert(prompt.includes('OBJECT parameter'), 'Prompt has object params warning');

// Check render is explicitly called async
assert(prompt.includes('render() is ASYNC') || prompt.includes('ALWAYS await'), 'Prompt warns about async render');

// Check translation verification step
assert(prompt.includes('raw translation keys'), 'Prompt checks for raw translation keys in DOM');

// Check registered_as is the component, not data cortex
assert(prompt.includes('Registered as: yrityskortti'), 'registered_as is component name');

// Check lib_name
assert(prompt.includes('window.AIMEAT.yrityskortti'), 'lib reference is correct');

console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);

// Print a snippet of the prompt around translation loading for visual verification
const translationIdx = prompt.indexOf('LOAD TRANSLATIONS');
if (translationIdx >= 0) {
  console.log('--- Translation loading section (snippet) ---');
  console.log(prompt.substring(translationIdx, translationIdx + 400));
  console.log('---');
}

process.exit(failed > 0 ? 1 : 0);
