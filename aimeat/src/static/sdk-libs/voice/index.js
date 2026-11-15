/**
 * @file voice/index.js
 * @description Reusable, configurable speech conversations for AIMEAT apps.
 * @structure Configuration and stage adapters feed the session coordinator and browser devices.
 * @usage AIMEAT.voice.createSession({ appId: 'companion' }), or choose the model and voice yourself:
 *   tts: { model: 'your-speech-model', voice: 'nova' }
 * @version-history
 *   v1.2.0 - 2026-11-15 - tts.voice defaults to '' instead of 'alloy': the speech request names a voice
 *     only when the app sets one, and otherwise the node applies the voice set on the owner's speech
 *     provider, then the node's default; with neither, the speech request fails with NO_TTS_VOICE.
 *   v1.1.2 - 2026-11-15 - createSession takes node speech without tts.model: the node's speech role
 *     chooses the model (the owner's provider, the owner's default, then the node's default).
 *   v1.0.0 - 2026-09-19 - Initial configurable OpenRouter-compatible voice pipeline.
 */
import { attach } from '../_core/namespace.js';
import { configure, defaults, presets } from './config.js';
import { createSession } from './session.js';
import { createCapture } from './capture.js';
import { createPlayer } from './player.js';
import { nodeAdapters } from './adapters.js';

attach('voice', {
  version: '1.2.0',
  get defaults() { return structuredClone(defaults); },
  get presets() { return structuredClone(presets); },
  configure,
  createSession(options = {}, adapters = {}) {
    return createSession(options, adapters, { capture: createCapture, player: createPlayer, adapters: nodeAdapters });
  },
});
