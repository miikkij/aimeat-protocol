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
 *   v1.2.0 — 2026-10-02 — The free router a key-only save wrote is not a choice; a marked one is.
 *   v1.1.0 — 2026-09-28 — Speech and embeddings take only the node's default; the owner fields are not read.
 *   v1.0.0 — 2026-08-16 — initial: precedence per role, empty-string handling, the untouched-node
 *     case, and the speech language hint.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import {
  resolveModelFor, resolveSttLanguage, resolveTtsVoice, holdsImplicitFreeModel, type ModelRole,
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

  it('the free router a key-only save wrote is NOT a choice: the node default comes first, and a chosen one stays', () => {
    // Until 2026-10-02 PUT /v1/openrouter/settings with a key and no model wrote model 'openrouter/free'
    // (no modelChosen mark), and an owner's own key then thought with a free model on a node that
    // names a default. Ruled by Jouni: an own key uses the node's default unless the owner chose.
    const implicit = { model: 'openrouter/free' };
    expect(holdsImplicitFreeModel(implicit)).toBe(true);
    expect(resolveModelFor(configuredNode, implicit, 'chat')).toBe('node/chat');
    // On a node with no default nothing changes: nothing is chosen, and the completion path's last
    // fallback is still the free router.
    expect(resolveModelFor(bareNode, implicit, 'chat')).toBeUndefined();
    // The owner who picked the free router on purpose keeps it.
    const chosen = { model: 'openrouter/free', modelChosen: true };
    expect(holdsImplicitFreeModel(chosen)).toBe(false);
    expect(resolveModelFor(configuredNode, chosen, 'chat')).toBe('openrouter/free');
    // Another model needs no mark: only the free router was ever written unasked.
    expect(resolveModelFor(configuredNode, { model: 'owner/chat' }, 'chat')).toBe('owner/chat');
    // The other roles are not touched by the mark.
    expect(resolveModelFor(configuredNode, { ...implicit, reasoningModel: 'owner/reasoning' }, 'reasoning')).toBe('owner/reasoning');
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

describe('speech and embeddings', () => {
  const node = { modelDefaultTts: 'node/tts', modelDefaultEmbed: 'node/embed', ttsVoiceDefault: 'alloy' } as unknown as AimeatConfig;
  const owner = { ttsModel: 'owner/tts', embedModel: 'owner/embed', ttsVoice: 'nova' };
  it('take only the node\'s default: the owner sets them on a provider, and nothing wrote these fields', () => {
    assert(resolveModelFor(node, owner, 'tts') === 'node/tts', 'tts: the node default, not the owner field');
    assert(resolveModelFor(node, owner, 'embed') === 'node/embed', 'embed: the node default, not the owner field');
    assert(resolveTtsVoice(node, owner) === 'alloy', 'voice: the node default, not the owner field');
    assert(resolveModelFor(bareNode, owner, 'tts') === undefined, 'no node default: nothing');
  });
});
