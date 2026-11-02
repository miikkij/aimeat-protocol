/**
 * @file public/js/services/party-session.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outside party's session in this browser tab, held in memory only (WP11; design
 *   canvas "Jaettu data", board Kirjasto-avaimella). The recipient page (views/shared-data.js) holds the
 *   party token it got when the person took their key; the library (views/public-knowledge-library.js)
 *   reads with that token what the party's shares give, and the dataset page (views/dataset.js) opens a
 *   shared package with it. The key itself is never held here, and nothing is written to storage: a
 *   reload ends the session, as the recipient page already says.
 *
 *   A party is not an account session (js/services/auth.js): its token is sent only by these pages'
 *   own fetches, and only to the endpoints that take a party token (services/parties/contract.ts
 *   PARTY_TOKEN_ROUTES on the node).
 * @structure holdPartySession · partySession · keepRecipientPage · keptRecipientPage · partyHeaders
 * @usage holdPartySession({ token, expiresIn, party, inviteCode });  const s = partySession();
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (WP11).
 */

/** @type {{ token: string, expiresAt: number, party: { name: string, display_name: string, kind: string, owner: string, owner_name?: string }, inviteCode?: string } | null} */
let held = null;
/** The recipient page as it stood, so a return from the library shows it again (the code is spent). */
let recipient = null;

/**
 * Hold the party token for this tab. `expiresIn` is the token's life in seconds (the node's answer).
 * @param {{ token: string, expiresIn?: number, party: { name: string, display_name: string, kind: string, owner: string, owner_name?: string }, inviteCode?: string }} s
 */
export function holdPartySession(s) {
  if (!s?.token) return;
  held = { token: s.token, expiresAt: Date.now() + Math.max(60, Number(s.expiresIn) || 900) * 1000, party: s.party, inviteCode: s.inviteCode };
}

/** The party session while its token lives, or null. */
export function partySession() {
  if (held && Date.now() < held.expiresAt) return held;
  held = null;
  return null;
}

/** The recipient page's state for this invite code, kept in memory for the way back from the library. */
export function keepRecipientPage(code, state) { recipient = code ? { code, state } : null; }

/** The recipient page's state kept for `code`, or null. */
export function keptRecipientPage(code) { return recipient && recipient.code === code ? recipient.state : null; }

/** The Authorization header for a party read, or {} without a session. */
export function partyHeaders() {
  const s = partySession();
  return s ? { Authorization: `Bearer ${s.token}` } : {};
}
