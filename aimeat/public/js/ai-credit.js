/**
 * @file public/js/ai-credit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI credit a buyer paid for, in euros, and whether their AI is ready, read from
 *   GET /v1/chat/status. One place for the sum, so every page that shows the credit (the Home's
 *   nameplate, the chat's status line, the AI page and the profile's usage card) says the same
 *   number (Jouni v27 P6 and v28 finding 9, 2026-10-31: the credit in euros, and consistent).
 *
 *   HOW EUROS ARE COUNTED. The store takes its 20 % fee from what the buyer paid, converts the rest
 *   to dollars at the day's rate and makes the node's OpenRouter key with that dollar limit: a 10 €
 *   starter is 8,33 € of AI credit (Jouni's C, 2026-10-31). The fleet service writes the rate it
 *   used as site.ai_credit_eur_per_usd, and again as a total on every top-up, so what is left in
 *   euros is what is left of the key times that rate. A node without the setting counts a dollar
 *   as a euro, which is how the keys before 2026-10-31 were made. Only on a node the store sold
 *   (site.js customerNode()); elsewhere the allowance stays in dollars, as the node's own key
 *   reports it.
 * @structure eurPerUsd() · aiCredit(status) · creditEur(usd) · topupHref()
 * @usage const credit = aiCredit(chatStatus); // { eur, state } or null
 * @version-history
 *   v1.2.0 — 2026-10-31 — topupHref(locale) adds the page's language, as the server's notice does
 *     (ai-fix-words.ts balanceChoices); the Home and the AI page offer it at all times (v28 #19).
 *   v1.1.0 — 2026-10-31 — Euros come from site.ai_credit_eur_per_usd, the rate the store converted
 *     at, with 1 when it is not set; the fixed 1.2 showed the price paid, fee included, as credit
 *     (Jouni's C). creditEur() for the pages that hold a dollar figure of their own.
 *   v1.0.0 — 2026-10-31 — Initial (Jouni v27 P6).
 */
import { customerNode, siteLink } from '/js/site.js';

/** Euros of AI credit per dollar of the node's key: the store's rate, or 1 when it wrote none. */
export function eurPerUsd() {
  const n = Number(siteLink('aiCreditEurPerUsd'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * A dollar figure of the node's key as euros of AI credit, or null when this is not a node the
 * store sold and the figure stays in dollars.
 * @param {number} usd
 * @returns {number | null}
 */
export function creditEur(usd) {
  if (!customerNode()) return null;
  const n = Number(usd);
  return Number.isFinite(n) ? Math.max(0, n * eurPerUsd()) : 0;
}

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
  const eur = creditEur(status.allowance_remaining_usd ?? 0) ?? 0;
  const state = status.enabled === false ? 'off'
    : eur < 0.005 ? 'empty'
      : status.allowance_low ? 'low'
        : 'ready';
  return { eur, state };
}

/**
 * Where more credit is bought for this node, in the page's language, or '' when the store named no
 * address. The store keeps the address's own parameters (the place, the test lane's guestext).
 * @param {string} [locale]
 * @returns {string}
 */
export function topupHref(locale) {
  const raw = siteLink('storeTopup');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (locale) url.searchParams.set('lang', String(locale).slice(0, 2));
    return url.toString();
  } catch (err) {
    console.warn('[ai-credit] the top-up address is not a URL:', err.message);
    return '';
  }
}
