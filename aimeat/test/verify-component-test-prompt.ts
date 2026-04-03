/**
 * Verify that the gen-test-cortex-component prompt resolves correctly:
 * - service_slug is resolved (not empty)
 * - Translation loading code has real service slug, not placeholder
 * - await is present in render() example
 * - data_cortex_info has method return shapes
 * Run: npx tsx test/verify-component-test-prompt.ts
 */
import { readFileSync } from 'node:fs';
import { resolvePromptVars } from '../src/services/generator-prompts/resolvers.js';
import type { PromptRuntimeData } from '../src/services/generator-prompts/types.js';

const blueprint = JSON.parse(readFileSync('data/debug/generator/prj-mnisxg4m-todlc/blueprint.json', 'utf8'));

// Simulate completed components
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

console.log('\n═══ gen-test-cortex-component resolver ═══');

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

// Check service_slug
assert(!!vars.service_slug, 'service_slug has value', vars.service_slug);
assert(vars.service_slug === 'prh-ytj-company-registry', 'service_slug is correct', vars.service_slug);
assert(!vars.service_slug?.includes('SERVICE'), 'service_slug is NOT placeholder');

// Check component_label
assert(!!vars.component_label, 'component_label has value', vars.component_label);

// Check registered_as comes from spec (not data cortex)
assert(vars.registered_as === 'yrityskortti', 'registered_as is component name (not data cortex)', vars.registered_as);

// Check lib_name
assert(vars.lib_name === 'yrityskortti', 'lib_name is correct', vars.lib_name);

// Check data_cortex_info
assert((vars.data_cortex_info?.length || 0) > 100, 'data_cortex_info has content', `${vars.data_cortex_info?.length} chars`);
assert(vars.data_cortex_info?.includes('prhYtjCompanyRegistry') || false, 'data_cortex_info has data cortex lib name');
assert(vars.data_cortex_info?.includes('returnsExample') || vars.data_cortex_info?.includes('businessId') || false, 'data_cortex_info has return shapes');
assert(vars.data_cortex_info?.includes('OBJECT parameter') || false, 'data_cortex_info has object params warning');

// Check spec_section
assert((vars.spec_section?.length || 0) > 50, 'spec_section has content');

// Check project_context
assert(!!vars.project_context, 'project_context has value');

console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
