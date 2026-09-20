/**
 * @file crew-def-schemas.test.ts
 * @description The publish gate over a crew-def carried in an app manifest (`cortex.agents`), and
 *   in particular its TOOL-NAME CHARSET.
 *
 *   WHY THIS FILE EXISTS. The charset admitted `decide` and refused `decide:sort-a-message`, while
 *   the node's own `aimeat-decide` skill documents both as rows in the Crew tab's tool picker and
 *   the runtime resolves both. So an app manifest was refused for using the syntax this node told
 *   it to use, and the refusal named the charset rather than the disagreement. A gate and the
 *   documentation it enforces have to agree; when they do not, one of them is a bug, and here it
 *   was the gate.
 *
 *   The colon is a SELECTOR and exactly one is allowed. This stays a shape-and-charset check: the
 *   FLEET resolves the name, and membership is crewaimeat's TOOL_REGISTRY to decide.
 * @usage cd aimeat && pnpm exec vitest run test/unit/crew-def-schemas.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial, with the selector charset.
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { validateCortexAgents } from '../../src/models/crew-def-schemas.js';

/** A crew-def that is correct in every way, so each test breaks exactly one thing. */
function sound(tools?: string[]): Record<string, unknown> {
  return {
    agent_name: 'probe',
    agents: [{ role: 'Reader', goal: 'read', backstory: 'You read.', ...(tools ? { tools } : {}) }],
    tasks: [{ id: 'read', description: 'Read this: {{ctx.prompt}}', expected_output: 'notes', agent: 'Reader' }],
  };
}

const problems = (tools?: string[]): string[] => {
  const out = validateCortexAgents([sound(tools)]);
  return out.ok ? [] : out.errors;
};

describe('the tool-name charset', () => {
  it('takes a plain tool name', () => {
    assert.deepEqual(problems(['memory', 'web', 'app_tools', 'exchange-run']), []);
  });

  it('takes a decision rule named after the colon, which is what the Crew tab offers', () => {
    assert.deepEqual(problems(['decide', 'decide:sort-a-message']), []);
  });

  it('takes a rule id with digits and hyphens, the whole of RULE_ID_RE', () => {
    assert.deepEqual(problems(['decide:pay-an-invoice-over-500']), []);
  });

  it('refuses a second colon, because one selector is the rule', () => {
    assert.notDeepEqual(problems(['decide:a:b']), []);
  });

  it('refuses a colon with nothing after it', () => {
    assert.notDeepEqual(problems(['decide:']), []);
  });

  it('refuses a colon with nothing before it', () => {
    assert.notDeepEqual(problems([':sort-a-message']), []);
  });

  it('still refuses whitespace and capitals, which is what the charset was always for', () => {
    assert.notDeepEqual(problems(['Crew Registry']), []);
    assert.notDeepEqual(problems(['decide:Sort A Message']), []);
  });

  it('names the tool syntax in the refusal, so the reader learns the selector form', () => {
    const errs = problems(['decide:BAD']);
    assert.ok(errs.some(e => e.includes('decide:sort-a-message')), errs.join(' | '));
  });
});

describe('the rest of the gate is unchanged', () => {
  it('still requires a task that injects the runtime prompt', () => {
    const doc = sound(['memory']) as { tasks: Array<{ description: string }> };
    doc.tasks[0].description = 'Read something.';
    const out = validateCortexAgents([doc]);
    assert.equal(out.ok, false);
    assert.ok(!out.ok && out.errors.some(e => e.includes('{{ctx.prompt}}')), 'the prompt rule must still bite');
  });

  it('still refuses a task pointing at an agent role nobody declared', () => {
    const doc = sound(['memory']) as { tasks: Array<{ agent: string }> };
    doc.tasks[0].agent = 'Nobody';
    const out = validateCortexAgents([doc]);
    assert.equal(out.ok, false);
  });
});
