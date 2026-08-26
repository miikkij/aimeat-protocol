/**
 * @file src/services/outbound/ai-disclosure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Saying, in the message itself, that a machine wrote it.
 *
 *   WHAT THE LAW ACTUALLY REQUIRES, checked against Article 50 rather than assumed. Paragraph 4 —
 *   the one that obliges a DEPLOYER to disclose AI-generated text — is scoped to text "published
 *   with the purpose of informing the public on matters of public interest". A message to one
 *   customer is neither published to the public nor about a matter of public interest, and the same
 *   paragraph exempts text that has had "human review or editorial control" with somebody holding
 *   editorial responsibility, which is exactly what a person pressing send is. Paragraph 2 does
 *   cover text and does require a machine-readable mark, but it is the obligation of whoever
 *   PROVIDES the generating system, about that system's outputs; this node already mints a
 *   provenance record for every completion it runs.
 *
 *   SO THIS IS OPTIONAL, AND IT IS A HEADER. Optional because nothing here is obliged, and a
 *   sentence added to somebody's sales mail that the law does not ask for is a product decision
 *   nobody made. A header because the audience for it is machines: a person reading their inbox
 *   does not follow a link to a hash, and the value of the mark is that a filter, an archive or a
 *   recipient's own tooling can see it.
 *
 *   THE NAME IS BORROWED, NOT INVENTED. The IETF's AI-Disclosure draft (draft-abaris-aicdh) defines
 *   the field and the vocabulary — none | ai-assisted | ai-generated | autonomous — for HTTP. It has
 *   no formal standing and it is not about mail, but borrowing a documented name and its four words
 *   beats coining a private fifth. The `X-` prefix is here because Microsoft Graph accepts a custom
 *   header only in that form, and one header that works on both providers beats two that each work
 *   on one.
 *
 *   WHAT CAN AND CANNOT BE PROMISED ABOUT REMOVING IT, in the order that matters:
 *     - An APP OR AGENT CANNOT SUPPRESS IT. The node builds the message; a caller that declares AI
 *       authorship cannot then ask for the header to be left out, because there is no parameter for
 *       that. This is the removal that is actually within reach, and it is closed.
 *     - A DKIM SIGNATURE OVER IT MAKES REMOVAL DETECTABLE rather than impossible, and only where we
 *       hold the key. When the message leaves through somebody's own Gmail or Outlook, that
 *       provider decides which headers it signs, and we do not.
 *     - NOTHING STOPS AN INTERMEDIARY STRIPPING AN UNKNOWN HEADER. In practice none do. Saying it
 *       cannot happen would be a promise this node is in no position to keep.
 * @structure AiDisclosureLevel · AiDisclosure · disclosureHeaders
 * @usage const headers = disclosureHeaders(input.aiDisclosure, config);
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { AimeatConfig } from '../../config.js';

/** The IETF draft's vocabulary, unchanged. 'none' exists so a caller can say so explicitly. */
export type AiDisclosureLevel = 'none' | 'ai-assisted' | 'ai-generated' | 'autonomous';

export const AI_DISCLOSURE_LEVELS: readonly AiDisclosureLevel[] =
  ['none', 'ai-assisted', 'ai-generated', 'autonomous'] as const;

export interface AiDisclosure {
  level: AiDisclosureLevel;
  /**
   * The provenance record this node already minted for the completion, by id. Optional, and it is
   * the difference between "a machine wrote this" and "here is which one, when, and under whose
   * name" — which is what somebody investigating a message actually wants.
   */
  provenanceId?: string;
}

/** Is this a level worth stamping? 'none' is an answer, not a mark to put on a message. */
export function isDeclared(d: AiDisclosure | undefined): boolean {
  return !!d && d.level !== 'none';
}

/**
 * The headers to add, or nothing.
 *
 * Returned as a plain map so all three send paths carry the same two lines: nodemailer takes
 * `headers` for the node's own transport and for a company's SMTP, and Graph takes the same pairs
 * as `internetMessageHeaders`. A disclosure that only appeared when a person happened to send
 * through their own mailbox would be worse than none, because it would look like the ones without
 * it were human-written.
 */
export function disclosureHeaders(
  d: AiDisclosure | undefined, config: AimeatConfig,
): Record<string, string> {
  if (!isDeclared(d)) return {};
  const headers: Record<string, string> = { 'X-AI-Disclosure': d!.level };
  if (d!.provenanceId) {
    headers['X-AI-Disclosure-Record'] =
      `${config.baseUrl.replace(/\/$/, '')}/v1/provenance/${encodeURIComponent(d!.provenanceId)}`;
  }
  return headers;
}

/** Parse what a caller sent, refusing a word outside the vocabulary rather than guessing at it. */
export function parseDisclosure(raw: unknown): AiDisclosure | undefined | { error: string } {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    return AI_DISCLOSURE_LEVELS.includes(raw as AiDisclosureLevel)
      ? { level: raw as AiDisclosureLevel }
      : { error: `ai_disclosure must be one of: ${AI_DISCLOSURE_LEVELS.join(', ')}.` };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `ai_disclosure is a level (${AI_DISCLOSURE_LEVELS.join(', ')}), optionally with a provenance_id.` };
  }
  const o = raw as Record<string, unknown>;
  const level = typeof o.level === 'string' ? o.level : '';
  if (!AI_DISCLOSURE_LEVELS.includes(level as AiDisclosureLevel)) {
    return { error: `ai_disclosure.level must be one of: ${AI_DISCLOSURE_LEVELS.join(', ')}.` };
  }
  const provenanceId = typeof o.provenance_id === 'string' ? o.provenance_id
    : (typeof o.provenanceId === 'string' ? o.provenanceId : '');
  return { level: level as AiDisclosureLevel, ...(provenanceId ? { provenanceId } : {}) };
}
