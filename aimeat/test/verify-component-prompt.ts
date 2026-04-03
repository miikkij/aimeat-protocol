/**
 * Verify that the gen-cortex-component prompt has correct service_slug
 * and no SERVICE_NAME placeholder in the resolved output.
 * Run: npx tsx test/verify-component-prompt.ts
 */
import { readFileSync } from 'node:fs';
import { resolvePromptVars } from '../src/services/generator-prompts/resolvers.js';
import type { PromptRuntimeData } from '../src/services/generator-prompts/types.js';

const blueprint = JSON.parse(readFileSync('data/debug/generator/prj-mnisxg4m-todlc/blueprint.json', 'utf8'));

// Simulate completed components (extension registered, data cortex registered, translations registered)
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
  name: 'hakukentta',
  libName: 'hakukentta',
  render: { signature: 'AIMEAT.hakukentta.render(container, props)', props: { locale: 'string', onSelect: 'function' } },
};

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); }
}

console.log('\n═══ gen-cortex-component resolver ═══');

const vars = await resolvePromptVars(
  null as any,
  'gen-cortex-component',
  {
    blueprint,
    interviewSpec: { useCases: [{ title: 'Search', description: 'Search companies' }], views: [{ title: 'Search', type: 'list' }] },
    componentLabel: 'Hakukenttä',
    blueprintComponent: blueprint.components.find((c: Record<string, unknown>) => c.id === 'component-search-input'),
    selfSpec: componentSpec,
    completedComponents,
    translationKeys: ['app.search', 'app.company.name', 'app.loading'],
  } as unknown as PromptRuntimeData,
  {}
);

// Check service_slug is resolved
assert(!!vars.service_slug, 'service_slug has value', vars.service_slug);
assert(vars.service_slug === 'prh-ytj-company-registry', 'service_slug is correct extension name', vars.service_slug);
assert(!vars.service_slug?.includes('SERVICE_NAME'), 'service_slug is NOT placeholder');

// Check data_cortex_api has real content
assert((vars.data_cortex_api?.length || 0) > 100, 'data_cortex_api has content', `${vars.data_cortex_api?.length} chars`);
assert(vars.data_cortex_api?.includes('prhYtjCompanyRegistry') || false, 'data_cortex_api has lib name');
assert(vars.data_cortex_api?.includes('returnsExample') || vars.data_cortex_api?.includes('businessId') || false, 'data_cortex_api has return shapes');

// Check spec_section
assert((vars.spec_section?.length || 0) > 50, 'spec_section has content');
assert(vars.spec_section?.includes('hakukentta') || false, 'spec_section has component name');

// Check translation_section
assert((vars.translation_section?.length || 0) > 0, 'translation_section has content');
assert(vars.translation_section?.includes('app.search') || false, 'translation_section has real keys');

// Check use_case
assert(!vars.use_case?.includes('No use cases provided'), 'use_case is NOT fallback');

console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
