/**
 * @file voice/index.js
 * @description Reusable, configurable speech conversations for AIMEAT apps.
 * @structure Configuration and stage adapters feed the session coordinator and browser devices.
 * @usage AIMEAT.voice.createSession({ appId: 'companion', tts: { model: 'your-speech-model' } })
 * @version-history v1.0.0 - 2026-09-19 - Initial configurable OpenRouter-compatible voice pipeline.
 */
import { attach } from '../_core/namespace.js';
import { configure, defaults, presets } from './config.js';
import { createSession } from './session.js';
import { createCapture } from './capture.js';
import { createPlayer } from './player.js';
import { nodeAdapters } from './adapters.js';

attach('voice', {
  version: '1.0.0',
  get defaults() { return structuredClone(defaults); },
  get presets() { return structuredClone(presets); },
  configure,
  createSession(options = {}, adapters = {}) {
    return createSession(options, adapters, { capture: createCapture, player: createPlayer, adapters: nodeAdapters });
  },
});
