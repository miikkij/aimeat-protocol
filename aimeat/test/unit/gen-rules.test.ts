/**
 * @file test/unit/gen-rules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The generation rules' pure decision (services/ai/gen-rules.ts): the operator's setting,
 *   the owner's record, the order a required rule, an exception and a bypass are weighed in, and the
 *   marks an arrival gets.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  parseNodeGenRules, normaliseOwnerGenRules, resolveGenRules, arrivalMarks, parseGenRulesBypass, directiveText,
  EMPTY_OWNER_GEN_RULES, type OwnerGenRules,
} from '../../src/services/ai/gen-rules.js';

const R = 'people-artistic';
const owner = (o: Partial<OwnerGenRules>): OwnerGenRules => ({ ...EMPTY_OWNER_GEN_RULES, ...o });
const person = { ownerInPerson: true };
const agent = { ownerInPerson: false, agent: 'bot' };

describe('parseNodeGenRules', () => {
  it('reads <rule>=<level> pairs and leaves an unnamed rule off', () => {
    expect(parseNodeGenRules('people-artistic=required')).toEqual({ modes: { [R]: 'required' }, problems: [] });
    expect(parseNodeGenRules('').modes).toEqual({});
  });
  it('names every problem instead of guessing', () => {
    const r = parseNodeGenRules('people-artistic=always, nope=on');
    expect(r.modes).toEqual({});
    expect(r.problems).toHaveLength(2);
  });
});

describe('resolveGenRules', () => {
  it('gives nothing while the node leaves the rule off and the owner has not chosen', () => {
    const d = resolveGenRules({ medium: 'image', nodeModes: {}, owner: EMPTY_OWNER_GEN_RULES, caller: person });
    expect(d.marks).toEqual([]);
    expect(directiveText(d.given, 'image')).toBe('');
  });
  it('gives the directive when the owner switches it on, or the node turns it on', () => {
    const own = resolveGenRules({ medium: 'image', nodeModes: {}, owner: owner({ rules: { [R]: true } }), caller: agent });
    expect(own.marks).toEqual([{ id: R, version: 1, state: 'applied' }]);
    const node = resolveGenRules({ medium: 'video', nodeModes: { [R]: 'on' }, owner: EMPTY_OWNER_GEN_RULES, caller: agent });
    expect(directiveText(node.given, 'video')).toMatch(/non-photorealistic/);
    const off = resolveGenRules({ medium: 'image', nodeModes: { [R]: 'on' }, owner: owner({ rules: { [R]: false } }), caller: agent });
    expect(off.marks).toEqual([]);
  });
  it('lets only the owner in person bypass, and never a required rule', () => {
    const bypass = { rules: [R], reason: 'product shot' };
    expect(resolveGenRules({ medium: 'image', nodeModes: { [R]: 'on' }, owner: EMPTY_OWNER_GEN_RULES, caller: agent, bypass }).refused).toBeTruthy();
    expect(resolveGenRules({ medium: 'image', nodeModes: { [R]: 'required' }, owner: EMPTY_OWNER_GEN_RULES, caller: person, bypass }).refused).toBeTruthy();
    const ok = resolveGenRules({ medium: 'image', nodeModes: { [R]: 'on' }, owner: EMPTY_OWNER_GEN_RULES, caller: person, bypass });
    expect(ok.marks[0]).toMatchObject({ state: 'bypassed', reason: 'Owner in person: product shot' });
    expect(ok.given).toEqual([]);
  });
  it('applies an exception to the named agent or app only, and not to a required rule', () => {
    const o = owner({ rules: { [R]: true }, exceptions: [{ rule: R, agent: 'bot', reason: 'photos' }] });
    expect(resolveGenRules({ medium: 'image', nodeModes: {}, owner: o, caller: agent }).marks[0].state).toBe('bypassed');
    expect(resolveGenRules({ medium: 'image', nodeModes: {}, owner: o, caller: { ownerInPerson: false, agent: 'other' } }).marks[0].state).toBe('applied');
    expect(resolveGenRules({ medium: 'image', nodeModes: { [R]: 'required' }, owner: o, caller: agent }).marks[0].state).toBe('applied');
  });
});

describe('arrivalMarks', () => {
  it('says declared for a rule the writer named and unknown for the rest', () => {
    const d = resolveGenRules({ medium: 'image', nodeModes: { [R]: 'on' }, owner: EMPTY_OWNER_GEN_RULES, caller: agent });
    expect(arrivalMarks(d, [R])[0].state).toBe('declared');
    expect(arrivalMarks(d, undefined)[0].state).toBe('unknown');
  });
});

describe('the owner record and the bypass shape', () => {
  it('refuses an unknown rule and an exception without exactly one of app or agent', () => {
    const r = normaliseOwnerGenRules({ rules: { nope: true }, exceptions: [{ rule: R, reason: 'x' }] });
    expect('problems' in r && r.problems.map(p => p.field)).toEqual(['rules.nope', 'exceptions[0]']);
  });
  it('takes null as "follow the node" and leaves it out of the record', () => {
    const r = normaliseOwnerGenRules({ rules: { [R]: null } });
    expect('record' in r && r.record.rules).toEqual({});
  });
  it('reads a bypass, and names what is wrong with one', () => {
    expect(parseGenRulesBypass({ rules: [R], reason: 'why' })).toEqual({ bypass: { rules: [R], reason: 'why' } });
    expect('problem' in parseGenRulesBypass({ rules: [R] })).toBe(true);
    expect(parseGenRulesBypass(undefined)).toEqual({});
  });
});
