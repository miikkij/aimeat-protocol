/**
 * @file app-ai-capability-hints.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish check's hints about how an app uses the AI capabilities (System 2 plan,
 *   docs/internal/llmproviderintegrations/13, section 4). Each one is written for the AI that built
 *   the app, names what to change, and never stops a publish (decision D2): lintAppAiDisclosure
 *   (app-ai-posture.ts) adds them to `hints` for an app that requests ai:use.
 *
 *   What each hint catches is a thing that works on the builder's node and breaks later on someone
 *   else's: a capability used without checking whether it is on, a model named in a call that the
 *   app's own meta does not declare, and vectors written into one memory value, which holds 1024 kB.
 *   A declared model the catalogue does not know is app-ai-model-hints.ts: this file is in the
 *   posture's import graph, which must not reach the catalogue store (an import cycle through
 *   storage/types/apps.ts). Pure: it imports nothing.
 * @structure lintAppAiCapabilityUse(html, { models })
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */

/** A capability call that fails on a node where the capability is off. */
const CAPABILITY_CALL = /\bai\s*\.\s*(image|speak|transcribe|embed)\s*\(|\bai\s*\.\s*complete(?:Json)?\s*\(\s*\{[^}]*\bfiles\s*:/;
/** The two ways to ask first. */
const CHECK_CALL = /\bai\s*\.\s*(capabilities|isAvailable)\s*\(/;
/** A call that names its model. */
const MODEL_IN_CALL = /\bai\s*\.\s*(complete|completeJson|stream|image|speak|transcribe|embed)\s*\(\s*\{[^}]*\bmodel\s*:/;
const EMBED_CALL = /\bai\s*\.\s*embed\s*\(/;
const MEMORY_WRITE = /\bdata\s*\.\s*set\s*\(/;

/** `models` is the app's declared list (AppAiPosture.models); only that is read, so this file does
 *  not import app-ai-posture.ts, which imports it. */
export function lintAppAiCapabilityUse(html: string, posture: { models?: string[] }): string[] {
  const hints: string[] = [];
  if (CAPABILITY_CALL.test(html) && !CHECK_CALL.test(html)) {
    hints.push(
      'Check the capability first with AIMEAT.ai.capabilities() and show the person a message when it is off: '
      + '`const caps = await AIMEAT.ai.capabilities(); if (!caps.capabilities.image.on) show(caps.capabilities.image.fix);`. '
      + 'Without it the button fails on a node or an account where that capability is not set up.',
    );
  }
  if (MODEL_IN_CALL.test(html) && !posture.models?.length) {
    hints.push(
      'This app names a model in a call, and its aimeat-ai meta declares no models. Declare the models it needs: '
      + '`<meta name="aimeat-ai" content="generates=text; discloses=yes; models=<type>:<model id>">`, or ask for the '
      + 'capability without a model and let the owner\'s providers choose.',
    );
  }
  if (EMBED_CALL.test(html) && MEMORY_WRITE.test(html)) {
    hints.push(
      'This app makes embeddings and writes memory. A vector is 6 to 12 kB, and one memory value holds 1024 kB, so keep '
      + 'a collection of vectors small or split it across records. See the aimeat-ai-capabilities skill, section Embeddings.',
    );
  }
  return hints;
}
