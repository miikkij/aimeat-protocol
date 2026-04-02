/**
 * @file verify-spec-prompt.ts
 * @description Verifies that the spec prompt resolver produces ALL expected variables
 *   with real content — no fallback "Infer from data sources" bullshit.
 *   Uses REAL blueprint data from prj-mnghbw4x-2anlt.
 *   Run: npx tsx test/verify-spec-prompt.ts
 */

import { readFileSync } from 'node:fs';
import { resolvePromptVars } from '../src/services/generator-prompts/resolvers.js';
import type { PromptRuntimeData } from '../src/services/generator-prompts/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); }
}

// Load real project data
const blueprint = JSON.parse(readFileSync('data/debug/generator/prj-mnghbw4x-2anlt/blueprint.json', 'utf8'));
const interviewSpec = JSON.parse(readFileSync('data/debug/generator/prj-mnghbw4x-2anlt/interview-spec.json', 'utf8'));

const extComponent = blueprint.components.find((c: Record<string, unknown>) => c.type === 'extension');

// ═══ gen-extension-spec resolver ═══
console.log('\n═══ gen-extension-spec resolver ═══');

const specVars = await resolvePromptVars(
  null as any, // storage not needed for this resolver
  'gen-extension-spec',
  {
    blueprint,
    interviewSpec,
    blueprintComponent: extComponent,
  } as unknown as PromptRuntimeData,
  {} // fragments
);

// blueprint_actions must NOT be fallback
assert(
  specVars.blueprint_actions !== 'Infer from data sources.',
  'blueprint_actions is NOT fallback',
  specVars.blueprint_actions?.slice(0, 100)
);

// Must contain all 6 ext: actions from blueprint
const expectedActions = ['searchCompanies', 'getCompanyDetails', 'addToWatchlist', 'removeFromWatchlist', 'checkWatchlist', 'saveComparison'];
for (const action of expectedActions) {
  assert(
    specVars.blueprint_actions?.includes(action) || false,
    `blueprint_actions contains "${action}"`,
    specVars.blueprint_actions?.includes(action) ? undefined : 'MISSING from prompt'
  );
}

// data_sources must have real content
assert(
  specVars.data_sources !== 'No data sources specified.' && (specVars.data_sources?.length || 0) > 100,
  'data_sources has real content',
  `${specVars.data_sources?.length || 0} chars`
);

// data_sources must contain PRH URL
assert(
  specVars.data_sources?.includes('avoindata.prh.fi') || false,
  'data_sources contains PRH API URL'
);

// structures must have real content
assert(
  specVars.structures !== 'No structures defined.' && (specVars.structures?.length || 0) > 50,
  'structures has real content',
  `${specVars.structures?.length || 0} chars`
);

// memory_keys must NOT be fallback
assert(
  specVars.memory_keys !== 'Infer from actions.' && (specVars.memory_keys?.length || 0) > 10,
  'memory_keys has real content',
  specVars.memory_keys?.slice(0, 100) || 'EMPTY'
);

// ═══ gen-extension-code resolver ═══
console.log('\n═══ gen-extension-code resolver ═══');

// Create a fake spec with actions
const fakeSpec = {
  name: 'prh-ytj',
  actions: expectedActions.map(id => ({ id, description: 'test', method: 'POST', path: `/v1/ext/prh-ytj/${id}`, input: {}, output: {} })),
};

const codeVars = await resolvePromptVars(
  null as any,
  'gen-extension-code',
  {
    blueprint,
    interviewSpec,
    blueprintComponent: extComponent,
    componentLabel: 'PRH Extension',
    componentType: 'extension',
    selfSpec: fakeSpec,
    completedComponents: [],
  } as unknown as PromptRuntimeData,
  {}
);

// spec_section must have real content (the spec JSON)
assert(
  (codeVars.spec_section?.length || 0) > 100,
  'spec_section has real content',
  `${codeVars.spec_section?.length || 0} chars`
);

// spec_section must contain REQUIRED ACTION IDs
assert(
  codeVars.spec_section?.includes('REQUIRED ACTION IDs') || false,
  'spec_section contains REQUIRED ACTION IDs section'
);

// spec_section must list all blueprint actions
for (const action of expectedActions) {
  assert(
    codeVars.spec_section?.includes(action) || false,
    `spec_section contains "${action}"`,
  );
}

// ═══ gen-test-extension-spec resolver ═══
console.log('\n═══ gen-test-extension-spec resolver ═══');

const testVars = await resolvePromptVars(
  null as any,
  'gen-test-extension-spec',
  {
    blueprint,
    interviewSpec,
    componentLabel: 'PRH Extension',
    extensionName: 'prh-ytj',
    selfSpec: fakeSpec,
    completedComponents: [{
      type: 'extension',
      registeredAs: 'prh-ytj',
      probeResults: [
        { action: 'searchCompanies', input: { name: 'test' }, status: 200, response: { totalResults: 1, companies: [] } },
      ],
    }],
  } as unknown as PromptRuntimeData,
  {}
);

// golden_samples must have real content (not empty)
assert(
  (testVars.golden_samples?.length || 0) > 50,
  'golden_samples has real content (from probeResults)',
  `${testVars.golden_samples?.length || 0} chars`
);

// extension_spec must have content
assert(
  (testVars.extension_spec?.length || 0) > 50,
  'extension_spec has content',
  `${testVars.extension_spec?.length || 0} chars`
);

// test_scenarios must be from spec (not empty)
assert(
  (testVars.test_scenarios?.length || 0) > 50,
  'test_scenarios has content from spec',
  `${testVars.test_scenarios?.length || 0} chars`
);

// test_scenarios must contain spec action IDs
for (const action of expectedActions) {
  assert(
    testVars.test_scenarios?.includes(action) || false,
    `test_scenarios contains "${action}"`,
  );
}

// project_context must have content
assert(
  testVars.project_context?.includes('Blueprint components') || false,
  'project_context has blueprint components'
);

assert(
  testVars.project_context?.includes('Use cases') || false,
  'project_context has use cases'
);

// ═══ gen-reflection resolver ═══
console.log('\n═══ gen-reflection resolver ═══');

const reflVars = await resolvePromptVars(
  null as any,
  'gen-reflection',
  {
    blueprint,
    interviewSpec,
    code: 'export default async function(ctx, input) { return {}; }',
    selfSpec: fakeSpec,
    errors: ['test error 1', 'test error 2'],
    testContext: { errors: ['test failed'], trace: [{ fn: 'callExt', args: 'prh-ytj/search({})', result: '{"ok":true}', status: '200' }] },
  } as unknown as PromptRuntimeData,
  {}
);

assert((reflVars.failed_code?.length || 0) > 10, 'reflection: failed_code has content');
assert(reflVars.errors?.includes('1. test error 1'), 'reflection: errors formatted with numbers');
assert((reflVars.spec_contract?.length || 0) > 50, 'reflection: spec_contract has content');
assert(reflVars.test_context?.includes('ACTUAL API RESPONSES'), 'reflection: test_context has trace');

// ═══ gen-fix resolver ═══
console.log('\n═══ gen-fix resolver ═══');

const fixVars = await resolvePromptVars(
  null as any,
  'gen-fix',
  {
    blueprint,
    interviewSpec,
    originalPrompt: 'Create an extension...',
    code: 'export default async function(ctx, input) { return {}; }',
    errors: ['missing action getCompanyDetails'],
    componentType: 'extension',
    testContext: { errors: ['test failed'], trace: [] },
    previousAttempts: [{ round: 1, diagnosis: 'wrong API URL', errors: ['400 from API'] }],
    reflectionDiagnosis: 'The code uses path params but API needs query params',
  } as unknown as PromptRuntimeData,
  { sandbox_constraints: 'SANDBOX RULES HERE', namespace_rules: 'NAMESPACE RULES HERE', extension_consumption_rules: 'EXT RULES HERE' }
);

assert((fixVars.original_prompt?.length || 0) > 5, 'fix: original_prompt has content');
assert((fixVars.code?.length || 0) > 5, 'fix: code has content');
assert(fixVars.errors?.includes('1. missing action'), 'fix: errors formatted');
assert(fixVars.type_constraints?.includes('SANDBOX RULES'), 'fix: type_constraints has sandbox for extension');
assert(fixVars.test_context?.includes('Test Failure Context'), 'fix: test_context has content');
assert(fixVars.previous_attempts?.includes('PREVIOUS FIX ATTEMPTS'), 'fix: previous_attempts has content');
assert(fixVars.previous_attempts?.includes('wrong API URL'), 'fix: previous_attempts has diagnosis');
assert(fixVars.reflection_diagnosis?.includes('ROOT CAUSE ANALYSIS'), 'fix: reflection_diagnosis has content');

// ═══ gen-fresh-generation resolver ═══
console.log('\n═══ gen-fresh-generation resolver ═══');

const freshVars = await resolvePromptVars(
  null as any,
  'gen-fresh-generation',
  {
    blueprint,
    interviewSpec,
    originalPrompt: 'Create an extension...',
    previousAttempts: [
      { round: 1, diagnosis: 'wrong API URL', errors: ['400 from API'] },
      { round: 2, diagnosis: 'missing action', errors: ['getCompanyDetails not found'] },
    ],
    testContext: { trace: [{ fn: 'callExt', args: 'test', result: '{"ok":true}', status: '200' }] },
  } as unknown as PromptRuntimeData,
  {}
);

assert((freshVars.original_prompt?.length || 0) > 5, 'fresh: original_prompt has content');
assert(freshVars.pitfalls?.includes('KNOWN PITFALLS'), 'fresh: pitfalls has content');
assert(freshVars.pitfalls?.includes('wrong API URL'), 'fresh: pitfalls has diagnosis from round 1');
assert(freshVars.pitfalls?.includes('missing action'), 'fresh: pitfalls has diagnosis from round 2');
assert(freshVars.test_trace?.includes('ACTUAL API RESPONSES'), 'fresh: test_trace has content');

// ═══ Summary ═══
console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
