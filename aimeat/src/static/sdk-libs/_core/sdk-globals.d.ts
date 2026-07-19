/**
 * @file sdk-globals.d.ts
 * @description Ambient declarations for the browser globals the served SDK libraries touch that
 *   are not on TypeScript's stock lib.dom `Window` — the webkit-prefixed / non-standard APIs
 *   (webkitAudioContext, SpeechRecognition, webkitSpeechRecognition) plus the serve-time config
 *   prelude (window.__AIMEAT_SDK_CFG__) and the window.AIMEAT namespace. Declaring them here keeps
 *   checkJs honest at those exact call sites instead of erasing type-safety with per-site `any`
 *   casts, and is shared by every lib (e.g. audio also needs webkitAudioContext).
 * @usage Picked up by tsconfig.sdk.json (its include globs the sdk-libs .d.ts files). No runtime effect.
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: webkit audio/speech globals + SDK config prelude + AIMEAT namespace.
 */

interface Window {
  // The AIMEAT namespace is assembled dynamically across ~21 libs (each attaches its own surface);
  // there is no single static shape, so `any` is the honest type for cross-lib member access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AIMEAT?: Record<string, any>;
  /** Serve-time config prelude prepended to each bundle (see _core/config.js + libs/sdk-serve.ts). */
  __AIMEAT_SDK_CFG__?: { nodeId: string; baseUrl: string; heartbeatMs?: number };
  /** Safari's prefixed AudioContext. */
  webkitAudioContext?: typeof AudioContext;
  // SpeechRecognition / webkitSpeechRecognition have no lib.dom type; the instance API is accessed
  // dynamically (lang/continuous/onresult/…), so the constructed value is intentionally `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SpeechRecognition?: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webkitSpeechRecognition?: new () => any;
}
