/**
 * @file ai-model-defaults.test.ts
 * @description Unit tests for the one model-selection rule: owner setting, then instance default,
 *   then nothing.
 *
 *   The case that matters most is the one that must NOT change: with no instance defaults set, every
 *   role has to resolve exactly as it did before the layer existed. A node that quietly started
 *   substituting models for owners who had chosen none would be a worse defect than the gap this
 *   closes, so most of what follows pins the absence of behaviour.
 * @usage cd aimeat && pnpm vitest run test/unit/ai-model-defaults.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: precedence per role, empty-string handling, the untouched-node
 *     case, and the speech language hint.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import {
  resolveModelFor, resolveSttLanguage, type ModelRole,
} from '../../src/services/ai-model-defaults.js';

const ROLES: ModelRole[] = ['chat', 'reasoning', 'execution', 'vision', 'stt', 'image'];

/** A node with nothing configured — the shape every existing deployment already has. */
const bareNode = {
  modelDefaultChat: '', modelDefaultReasoning: '', modelDefaultExecution: '',
  modelDefaultVision: '', modelDefaultStt: '', modelDefaultImage: '', sttLanguageDefault: '',
} as unknown as AimeatConfig;

/** A node whose operator has named a model for every role. */
const configuredNode = {
  modelDefaultChat: 'node/chat', modelDefaultReasoning: 'node/reasoning',
  modelDefaultExecution: 'node/execution', modelDefaultVision: 'node/vision',
  modelDefaultStt: 'node/whisper', modelDefaultImage: 'node/image',
  sttLanguageDefault: 'fi',
} as unknown as AimeatConfig;

function assert(cond: boolean, msg: string): void {
  expect(cond, msg).toBe(true);
}

describe('resolveModelFor', () => {
  it('leaves an unconfigured node exactly as it was: every role resolves to nothing', () => {
    for (const role of ROLES) {
      assert(resolveModelFor(bareNode, {}, role) === undefined, `${role} names no model`);
      assert(resolveModelFor(bareNode, undefined, role) === undefined, `${role} with no prefs at all`);
    }
  });

  it('falls back to the instance default for every role', () => {
    const expected: Record<ModelRole, string> = {
      chat: 'node/chat', reasoning: 'node/reasoning', execution: 'node/execution',
      vision: 'node/vision', stt: 'node/whisper', image: 'node/image',
    };
    for (const role of ROLES) {
      const got = resolveModelFor(configuredNode, {}, role);
      assert(got === expected[role], `${role} falls back to ${expected[role]}, got ${got}`);
    }
  });

  it('the owner wins over the node, per role and independently', () => {
    const prefs = { visionModel: 'owner/vision', sttModel: 'owner/whisper' };

    assert(resolveModelFor(configuredNode, prefs, 'vision') === 'owner/vision', 'owner vision wins');
    assert(resolveModelFor(configuredNode, prefs, 'stt') === 'owner/whisper', 'owner stt wins');
    // The roles the owner said nothing about still come from the node.
    assert(resolveModelFor(configuredNode, prefs, 'chat') === 'node/chat', 'chat still from the node');
    assert(resolveModelFor(configuredNode, prefs, 'image') === 'node/image', 'image still from the node');
  });

  it('reads each role from its own preference key', () => {
    const prefs = {
      model: 'owner/chat',
      reasoningModel: 'owner/reasoning',
      executionModel: 'owner/execution',
      visionModel: 'owner/vision',
      sttModel: 'owner/stt',
      imageModel: 'owner/image',
    };
    const expected: Record<ModelRole, string> = {
      chat: 'owner/chat', reasoning: 'owner/reasoning', execution: 'owner/execution',
      vision: 'owner/vision', stt: 'owner/stt', image: 'owner/image',
    };
    for (const role of ROLES) {
      const got = resolveModelFor(bareNode, prefs, role);
      assert(got === expected[role], `${role} reads its own key, expected ${expected[role]}, got ${got}`);
    }
  });

  it('treats an empty or blank owner setting as unset, not as a choice', () => {
    // This is how the settings route clears a model: PUT with '' or null.
    assert(resolveModelFor(configuredNode, { sttModel: '' }, 'stt') === 'node/whisper', 'empty string falls through');
    assert(resolveModelFor(configuredNode, { sttModel: '   ' }, 'stt') === 'node/whisper', 'blank falls through');
    assert(resolveModelFor(configuredNode, { sttModel: null }, 'stt') === 'node/whisper', 'null falls through');
    assert(resolveModelFor(bareNode, { sttModel: '' }, 'stt') === undefined, 'and with no node default, nothing');
  });

  it('ignores a non-string preference rather than passing it to a provider', () => {
    assert(resolveModelFor(bareNode, { model: 42 }, 'chat') === undefined, 'a number is not a model');
    assert(resolveModelFor(bareNode, { model: { id: 'x' } }, 'chat') === undefined, 'an object is not a model');
  });
});

describe('resolveSttLanguage', () => {
  it('prefers the owner, then the node, then detection', () => {
    assert(resolveSttLanguage(configuredNode, { sttLanguage: 'sv' }) === 'sv', 'owner wins');
    assert(resolveSttLanguage(configuredNode, {}) === 'fi', 'node default applies');
    assert(resolveSttLanguage(bareNode, {}) === undefined, 'neither set means let the model detect');
  });

  it('an owner who cleared the hint gets the node default, not an empty string', () => {
    assert(resolveSttLanguage(configuredNode, { sttLanguage: '' }) === 'fi', 'cleared falls through');
    assert(resolveSttLanguage(bareNode, { sttLanguage: '' }) === undefined, 'and never returns an empty string');
  });
});
