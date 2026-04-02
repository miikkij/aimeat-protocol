/**
 * Verify that cortex_methods resolves correctly when componentLabel is passed.
 * Run: npx tsx test/verify-cortex-methods.ts
 */
import { readFileSync } from 'node:fs';
import { resolvePromptVars } from '../src/services/generator-prompts/resolvers.js';
import type { PromptRuntimeData } from '../src/services/generator-prompts/types.js';

const blueprint = JSON.parse(readFileSync('data/debug/generator/prj-mnhzlw4a-2k21l/blueprint.json', 'utf8'));

const fakeCortexSpec = {
  name: 'finnish-company-watchlist',
  libName: 'finnishCompanyWatchlist',
  wrapsExtension: 'finnish-company-watchlist',
};

const fakeCompletedComps = [{
  type: 'extension',
  registeredAs: 'finnish-company-watchlist',
  probeResults: [
    { action: 'searchCompanies', input: { query: 'test' }, status: 200, response: { totalResults: 1 } },
  ],
}];

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); }
}

// Test 1: WITH componentLabel
console.log('\n═══ cortex_methods WITH componentLabel ═══');
const vars = await resolvePromptVars(
  null as any,
  'gen-test-cortex-spec',
  {
    blueprint,
    interviewSpec: null,
    componentLabel: 'Tietokerros',
    selfSpec: fakeCortexSpec,
    completedComponents: fakeCompletedComps,
  } as unknown as PromptRuntimeData,
  {}
);

assert((vars.cortex_methods?.length || 0) > 50, 'cortex_methods has content', `${vars.cortex_methods?.length || 0} chars`);
assert(vars.cortex_methods?.includes('searchCompanies') || false, 'contains searchCompanies');
assert(vars.cortex_methods?.includes('getCompany') || false, 'contains getCompany');
assert(vars.cortex_methods?.includes('addToWatchlist') || false, 'contains addToWatchlist');
assert(vars.cortex_methods?.includes('removeFromWatchlist') || false, 'contains removeFromWatchlist');
assert(vars.cortex_methods?.includes('getWatchlist') || false, 'contains getWatchlist');
assert(vars.cortex_methods?.includes('getChangeHistory') || false, 'contains getChangeHistory');
assert(vars.cortex_methods?.includes('markChangesRead') || false, 'contains markChangesRead');
assert(vars.cortex_methods?.includes('getComparisonData') || false, 'contains getComparisonData');
// init() and checkChanges() appear in the "Do NOT call" warning text, but must NOT appear in the method list
assert(vars.cortex_methods?.includes('Do NOT call init()') || false, 'warns against calling init()');
assert(vars.cortex_methods?.includes('Do NOT call') || false, 'has Do NOT call warning');
assert(!vars.cortex_methods?.includes('- init(') , 'init is NOT in the methods list (only in warning)');
assert(vars.cortex_methods?.includes('NOTHING ELSE') || false, 'contains "NOTHING ELSE" enforcement');

// Test 2: action_contracts filtered to cortex: only
console.log('\n═══ action_contracts filtered ═══');
assert(!vars.action_contracts?.includes('ext:'), 'action_contracts does NOT contain ext: actions');
assert(vars.action_contracts?.includes('cortex:') || false, 'action_contracts contains cortex: actions');
assert(vars.action_contracts?.includes('cortex:searchCompanies') || false, 'contains cortex:searchCompanies');
assert(!vars.action_contracts?.includes('ext:init'), 'does NOT contain ext:init');
assert(!vars.action_contracts?.includes('ext:checkChanges'), 'does NOT contain ext:checkChanges');

// Test 3: golden_samples has extension label header
console.log('\n═══ golden_samples labeled correctly ═══');
assert(vars.golden_samples?.includes('EXTENSION that the cortex wraps') || false, 'golden samples labeled as extension responses');
assert(vars.golden_samples?.includes('test the CORTEX methods listed above') || false, 'golden samples point to cortex methods');

// Test 4: WITHOUT componentLabel (old bug simulation)
console.log('\n═══ cortex_methods WITHOUT componentLabel (old bug) ═══');
const vars2 = await resolvePromptVars(
  null as any,
  'gen-test-cortex-spec',
  {
    blueprint,
    interviewSpec: null,
    selfSpec: fakeCortexSpec,
    completedComponents: fakeCompletedComps,
  } as unknown as PromptRuntimeData,
  {}
);

assert(!vars2.cortex_methods || vars2.cortex_methods.trim() === '', 'cortex_methods is EMPTY without componentLabel (confirms the bug existed)');

// Test 5: spec_section in cortex-data code prompt
console.log('\n═══ spec_section in gen-cortex-data ═══');
const codeVars = await resolvePromptVars(
  null as any,
  'gen-cortex-data',
  {
    blueprint,
    interviewSpec: null,
    componentLabel: 'Tietokerros',
    projectDescription: 'Test',
    selfSpec: fakeCortexSpec,
    completedComponents: fakeCompletedComps,
  } as unknown as PromptRuntimeData,
  {}
);

assert((codeVars.spec_section?.length || 0) > 100, 'spec_section has content', `${codeVars.spec_section?.length || 0} chars`);
assert(codeVars.spec_section?.includes('finnish-company-watchlist') || false, 'spec_section contains name: finnish-company-watchlist');
assert(codeVars.spec_section?.includes('finnishCompanyWatchlist') || false, 'spec_section contains libName: finnishCompanyWatchlist');
assert(codeVars.spec_section?.includes('MUST be') || false, 'spec_section has enforcement text');

console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
