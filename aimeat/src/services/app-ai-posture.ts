/**
 * @file src/services/app-ai-posture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a published app says about the AI inside it, and the publish-time check that
 *   notices when it says nothing (TARGET-058 Phase 5).
 *
 *   THE PROBLEM THIS SOLVES. Over a hundred apps are published on this node and more arrive every
 *   week, each one built by talking to a model. Every app that generates content is, in AI Act
 *   terms, a system with a provider — its owner — carrying a marking duty and, when it publishes to
 *   the public, a labelling duty. There are two ways to handle that: every builder learns EU law, or
 *   the platform makes the compliant path the easy one. Only the second happens in reality, so the
 *   SDK hands back the record, `AIMEAT.ai.disclose()` draws the label, the build prompt asks for
 *   both, and this file is the part that checks.
 *
 *   IT WARNS, IT NEVER BLOCKS (decision D2). A publish that fails is a publish that gets worked
 *   around — the builder strips the scope, or hand-rolls a fetch, and the app ships with less
 *   transparency than before. A warning that names the exact call to add, in words the AI that built
 *   the app can act on in the same session, gets the label added. A refusal gets it removed.
 *
 *   THE MANIFEST IS ALL-OR-NOTHING, SO THIS FAILS SOFT. One invalid field in an app-tools manifest
 *   silently delists EVERY offering that app has. The posture is therefore OPTIONAL everywhere, a
 *   malformed `<meta name="aimeat-ai">` yields `null` rather than an error, and nothing here can
 *   reject a publish.
 * @structure
 *   - AppAiPosture — the stored statement (lives on the manifest; no storage migration)
 *   - parseAiPosture(html) — read `<meta name="aimeat-ai">`, or null
 *   - AppAiLintResult — the publish check's return shape, named so services/app-publish.ts can hold it
 *   - lintAppAiDisclosure(html, previous?) — THE publish check: { posture, hints }, carrying an
 *     earlier version's or a parent app's declaration forward
 *   - publicPosture(p) — the catalogue-safe projection (no gap: that is owner-only)
 * @usage
 *   import { lintAppAiDisclosure } from '../services/app-ai-posture.js';
 *   const { posture, hints } = lintAppAiDisclosure(html, previous?.manifest.aiPosture);
 *   if (posture) manifest.aiPosture = posture;
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8 step 0a: `AppAiLintResult` named, so the one shared
 *     publish path can carry the check's result instead of each door restating its shape.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5.
 */
import { parseAppScopes } from './protected-resource.js';

/** The modalities Article 50(2) names. Frozen here so the meta and the catalogue agree. */
export const AI_GENERATES_KINDS = ['text', 'image', 'audio', 'video'] as const;
export type AiGeneratesKind = (typeof AI_GENERATES_KINDS)[number];

/**
 * An app's transparency posture — its own statement, plus what the node observed at publish time.
 *
 * Stored on the MANIFEST rather than as a column: the manifest is already a JSON blob on both
 * storage providers, so this needs no migration and no second place to keep in sync, and it rides
 * along with every mechanism that already copies a manifest (update, fork, backup, purchase
 * snapshot).
 */
export interface AppAiPosture {
  /** What the app says it generates. Empty = it says it generates nothing. */
  generates: AiGeneratesKind[];
  /** Does it show the user a label? */
  discloses: boolean;
  /** Does it publish on matters of public interest (which raises the labelling duty)? */
  publicInterest: boolean;
  /** `declared` = the app carries `<meta name="aimeat-ai">`; `observed` = the node worked it out. */
  source: 'declared' | 'observed';
  /** Did the published source actually contain a disclosure call? The observed half. */
  disclosureCallFound: boolean;
  /** Does the app request `ai:use`? */
  usesAi: boolean;
  /** The publish check's finding, when there is one. OWNER-ONLY — publicPosture() strips it. */
  gap?: { code: string; message: string; at: string };
}

/**
 * What the publish check returns: the posture to store, and the hints to hand back to whoever (or
 * whatever) is publishing. Named so the shared publish path can carry it without re-spelling the
 * shape — three doors spelling it three times is how they drifted in the first place.
 */
export interface AppAiLintResult {
  posture: AppAiPosture;
  hints: string[];
}

/** Only look at the head-ish part of a big file, as parseAppScopes does. */
const SCAN_BYTES = 64 * 1024;

/**
 * The calls that mean "this app shows the user an AI label".
 *
 * Deliberately generous. A false negative here nags a builder who did the right thing, which is
 * exactly the noise that trains people to ignore a warning; a false positive costs nothing, because
 * the posture is a statement the owner is responsible for either way. Both the SDK primitives and a
 * hand-rolled label built on the platform's own class names count.
 */
const DISCLOSURE_CALL = /\bai\s*\.\s*(disclose|chatNotice|declare)\s*\(|["'`]ai-label|aimeat-ai-label|AiLabel\b|aiProvenance\b/;

/** Does the app request the AI scope? The one signal that it can generate anything at all. */
export function appUsesAi(html: string): boolean {
  return parseAppScopes(html).includes('ai:use');
}

/**
 * Read `<meta name="aimeat-ai" content="generates=text,image; discloses=yes; public-interest=no">`.
 *
 * Returns null when the app declares nothing or the value is unreadable — never an error, because a
 * malformed declaration must not be able to stop a publish or delist an offering.
 */
export function parseAiPosture(html: string): Pick<AppAiPosture, 'generates' | 'discloses' | 'publicInterest'> | null {
  const metas = html.slice(0, SCAN_BYTES).match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metas) {
    if (!/name\s*=\s*["']aimeat-ai["']/i.test(tag)) continue;
    const m = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!m) continue;
    const parts = new Map<string, string>();
    for (const chunk of m[1].split(';')) {
      const eq = chunk.indexOf('=');
      if (eq < 0) continue;
      parts.set(chunk.slice(0, eq).trim().toLowerCase(), chunk.slice(eq + 1).trim().toLowerCase());
    }
    const generates = (parts.get('generates') ?? '')
      .split(',').map((s) => s.trim())
      .filter((s): s is AiGeneratesKind => (AI_GENERATES_KINDS as readonly string[]).includes(s));
    return {
      generates,
      discloses: isYes(parts.get('discloses')),
      publicInterest: isYes(parts.get('public-interest')),
    };
  }
  return null;
}

function isYes(v: string | undefined): boolean {
  return v === 'yes' || v === 'true' || v === '1';
}

/**
 * THE publish-time check — one function, so the REST publish, the draft publish, the MCP tools and
 * the catalogue flow cannot disagree about what an app's posture is.
 *
 * The gap is exactly one situation: the app asks for `ai:use`, so it can generate content, and
 * NOTHING in it says so — no `<meta name="aimeat-ai">`, no disclosure call. Anything else is the
 * builder's own statement and is taken at face value.
 *
 * The message is written for the model that built the app, because that is who reads a publish
 * response in practice: it names the call, the parameter and where the object comes from, so the
 * fix happens in the same session rather than becoming a task nobody picks up.
 *
 * `previous` is the posture of the version being replaced, or of the app this one was FORKED from.
 * A fork of a generative app is still a generative app, and without this the posture silently resets
 * to "says nothing" every time somebody takes the code over — which is exactly when a compliance
 * statement is worth most. So an earlier DECLARATION survives a version that forgot to declare,
 * while the observed half is always re-measured from the bytes actually being published: a statement
 * about code that is no longer there would be worse than none.
 */
export function lintAppAiDisclosure(html: string, previous?: AppAiPosture): AppAiLintResult {
  const declared = parseAiPosture(html)
    ?? (previous?.source === 'declared'
      ? { generates: previous.generates, discloses: previous.discloses, publicInterest: previous.publicInterest }
      : null);
  const inherited = !parseAiPosture(html) && !!declared;
  const disclosureCallFound = DISCLOSURE_CALL.test(html);
  const usesAi = appUsesAi(html);
  const hints: string[] = [];

  const posture: AppAiPosture = {
    generates: declared?.generates ?? (usesAi ? ['text'] : []),
    discloses: declared?.discloses ?? disclosureCallFound,
    publicInterest: declared?.publicInterest ?? false,
    source: declared ? 'declared' : 'observed',
    disclosureCallFound,
    usesAi,
  };

  if (inherited) {
    hints.push(
      'This app inherited its AI transparency posture from the version it replaces (or the app it '
      + 'was forked from) because this source declares none. Restate it so it travels with the code: '
      + '`<meta name="aimeat-ai" content="generates=' + (posture.generates.join(',') || 'text')
      + '; discloses=' + (posture.discloses ? 'yes' : 'no')
      + '; public-interest=' + (posture.publicInterest ? 'yes' : 'no') + '">`.',
    );
  }

  if (usesAi && !declared && !disclosureCallFound) {
    posture.gap = {
      code: 'AI_DISCLOSURE_MISSING',
      message:
        'This app requests the `ai:use` scope but never tells the user that a model made what they '
        + 'are reading. Two additions fix it, and both are one line. (1) Keep the `provenance` object '
        + '`AIMEAT.ai.complete()` returns and render the label at first exposure: '
        + '`const r = await AIMEAT.ai.complete({ app_id, prompt }); render(r.content); '
        + 'AIMEAT.ai.disclose(r.provenance, { target: "#ai-label" });` — it draws the official EU '
        + 'label in your app\'s own theme and draws nothing when no label is owed. (2) Declare the '
        + 'posture in the head: '
        + '`<meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no">`. '
        + 'If the app opens a chat, also call `AIMEAT.ai.chatNotice({ target: "#chat-top" })` so the '
        + 'first message says a model is on the other end. Anything the app stores or publishes '
        + 'should carry the record: `AIMEAT.data.set(key, AIMEAT.ai.declare(item, r.provenance))`. '
        + 'The app is published either way — this is a warning, not a rejection.',
      at: new Date().toISOString(),
    };
    hints.push(posture.gap.message);
  }

  // A separate, quieter nudge: the app DOES label, but never said so where a catalogue can read it.
  if (usesAi && !declared && disclosureCallFound) {
    hints.push(
      'This app labels its AI output but declares no posture, so the catalogue cannot show it. Add '
      + '`<meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no">` to the head.',
    );
  }

  return { posture, hints };
}

/**
 * The catalogue-safe view. The gap is a note to the OWNER about their own app, not a public
 * scarlet letter, so it never leaves here — the owner-facing surfaces read the posture directly.
 */
export function publicPosture(p: AppAiPosture | undefined): Omit<AppAiPosture, 'gap'> | undefined {
  if (!p) return undefined;
  return {
    generates: p.generates, discloses: p.discloses, publicInterest: p.publicInterest,
    source: p.source, disclosureCallFound: p.disclosureCallFound, usesAi: p.usesAi,
  };
}
