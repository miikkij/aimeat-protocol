/**
 * @file src/services/agent-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an agent may invite people, read from its permissions.
 *
 *   An agent holding organism:invite may invite people into the organisms its owner belongs to, and
 *   an invitation can create a new account on this node (an email invitation the person accepts, or
 *   an invitation code an organism owner makes). That is allowed: sometimes it is the agent's job.
 *   It must be visible, so the agent list says it and the proposal answer says it (Jouni,
 *   2026-10-18). It is derived from the permissions on every read and never written down, so it
 *   cannot go out of date. Nothing here changes who may invite.
 * @structure invitesPeople(scopes) · INVITES_SENTENCE · withInvitesSentence(text, scopes)
 * @usage import { invitesPeople } from './agent-invites.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-datakarttaan-ja-agentin-kuvaukseen-tieto-kutsuista-ja-tilien).
 */
import { scopeIsCovered } from '../utils/scope-coverage.js';

/** The permission that lets a principal invite people into organisms. */
export const INVITE_SCOPE = 'organism:invite';

/** True when these permissions cover organism:invite, read the way requireScope reads them. */
export function invitesPeople(scopes: readonly string[] | null | undefined): boolean {
  return scopeIsCovered(scopes ?? [], INVITE_SCOPE);
}

/**
 * The sentence an answer relays to the person. The SPA says the same in the person's language
 * (consent.preset.invitesPeople in the locales).
 */
export const INVITES_SENTENCE = 'It can invite people into the shared spaces you belong to. An invitation can create a new account for that person.';

/** `text` with the sentence after it when the permissions cover organism:invite. */
export function withInvitesSentence(text: string, scopes: readonly string[] | null | undefined): string {
  return invitesPeople(scopes) ? `${text} ${INVITES_SENTENCE}` : text;
}
