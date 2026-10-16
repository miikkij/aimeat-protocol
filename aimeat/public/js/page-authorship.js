/**
 * @file public/js/page-authorship.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who wrote a workspace page and how, as the member's views and editors use it: the
 *   writer's name (the record's own writer when the page has a record, since an agent's page is
 *   stored in its owner's name; else the workspace read's `_writtenBy`), and the provenance a person
 *   declares when they tick that an AI made the page they are saving. The declaration rides the
 *   draft write as `ai_provenance`, and the node keeps it as the page's record, so the page shows the
 *   AI label it owes wherever it is shared (EU AI Act Art. 50(4)).
 * @structure writerName · AI_MADE_DECLARATION · recordedAsAiMade · aiDeclarationFor
 * @usage import { writerName, aiDeclarationFor } from '/js/page-authorship.js';
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the AI label on every public page).
 */

/** A writer as a member reads it: an agent as "claude (alice)", a person by their account name. */
export function writerName(identity) {
  if (typeof identity !== 'string' || !identity) return '';
  const [principal] = identity.split('@');
  const [agent, owner] = principal.split('#');
  return owner ? `${agent} (${owner})` : agent;
}

/** What a person declares by ticking "An AI made this": a model made it, and nobody reviewed it. */
export const AI_MADE_DECLARATION = Object.freeze({ level: 'ai-generated', media_kind: 'text' });

/** Was this page, as stored, recorded as made with an AI? The editor's starting answer. */
export function recordedAsAiMade(page) {
  const level = page?._aiProvenance?.level;
  return !!level && level !== 'original';
}

/** The `ai_provenance` a save sends: the declaration when the box is ticked, nothing otherwise. */
export function aiDeclarationFor(page) {
  return page && page.aiMade ? { ...AI_MADE_DECLARATION } : undefined;
}
