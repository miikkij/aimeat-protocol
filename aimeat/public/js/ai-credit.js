/**
 * @file public/js/ai-credit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI credit a buyer paid for, in euros, and whether their AI is ready, read from
 *   GET /v1/chat/status. One place for the sum, so the Home's nameplate and the chat's status line
 *   say the same number (Jouni v27 P6, 2026-10-31: "AI-saldo 10 €" on the Home, not "8.33 USD").
 *
 *   HOW EUROS ARE COUNTED. The store mints a sold node's OpenRouter key with a dollar limit of the
 *   euros paid divided by 1.2: the 20 % is the service fee, and a euro is counted as a dollar
 *   (aimeat-commercial, 2026-10-31). So what is left in euros is what is left of the key times 1.2,
 *   which is the honest number for what the buyer paid, and a top-up keeps the same rule. Only on a
 *   node the store sold (site.js customerNode()); elsewhere the allowance stays in dollars, as the
 *   node's own key reports it.
 * @structure STORE_CREDIT_FACTOR · aiCredit(status) · topupHref()
 * @usage const credit = aiCredit(chatStatus); // { eur, state } or null
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni v27 P6).
 */
import { customerNode, siteLink } from '/js/site.js';

/** Euros paid per dollar of the key's limit: the store's 20 % service fee on a euro counted as a dollar. */
export const STORE_CREDIT_FACTOR = 1.2;

/**
 * The buyer's AI credit, or null when it is not the subject: not a node the store sold, no status
 * yet, or the person's own key pays.
 * `state`: 'ready' (the AI answers and there is credit), 'low' (under a tenth of the limit),
 * 'empty' (nothing left) or 'off' (the chat is switched off on this node).
 * @param {any} status the data of GET /v1/chat/status
 * @returns {{ eur: number, state: 'ready'|'low'|'empty'|'off' } | null}
 */
export function aiCredit(status) {
  if (!customerNode() || !status || status.pays === 'own') return null;
  const usd = Number(status.allowance_remaining_usd ?? 0);
  const eur = Number.isFinite(usd) ? Math.max(0, usd * STORE_CREDIT_FACTOR) : 0;
  const state = status.enabled === false ? 'off'
    : eur < 0.005 ? 'empty'
      : status.allowance_low ? 'low'
        : 'ready';
  return { eur, state };
}

/** Where more credit is bought for this node, or '' when the store named no address. */
export function topupHref() {
  return siteLink('storeTopup');
}
