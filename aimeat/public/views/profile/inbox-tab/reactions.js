/**
 * @file public/views/profile/inbox-tab/reactions.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The marks on a message in a Messages thread: the person's palette and the press that
 *   gives or takes back a mark. The palette is the person's memory record `messages.reactions`
 *   ({ symbols: [{ symbol, meaning }] }), which they or their AI change with a memory write; without
 *   one the page offers the same acknowledgement symbols as the node (services/message-reactions.ts
 *   DEFAULT_PALETTE). The thread takes the node's answer at once, and the SSE `messages` change brings
 *   the other side's marks.
 * @structure DEFAULT_PALETTE · useMessageReactions({ setThread, showToast }) → { palette, me, react } ·
 *   reactionItems(msg, me, nameOf)
 * @usage const reactions = useMessageReactions({ setThread, showToast }); … <${MessageBubble} reactions=${reactions} />
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { getGhii } from '/js/services/auth.js';
import * as messages from '/js/services/messages.js';
import { swallowed } from '/js/swallowed.js';

/** The node's default palette (services/message-reactions.ts DEFAULT_PALETTE): acknowledgement symbols. */
export const DEFAULT_PALETTE = Object.freeze([
  { symbol: '✓', meaning: 'done' },
  { symbol: '👍', meaning: 'agreed' },
  { symbol: '❤️', meaning: 'thank you' },
  { symbol: '😄', meaning: 'that made me smile' },
  { symbol: '🙏', meaning: 'thanks, appreciated' },
  { symbol: '👀', meaning: 'seen, looking at it' },
]);

const PALETTE_KEY = 'messages.reactions';
const MAX = 32;

/** The palette a record holds, or null when it holds none worth offering. */
function paletteOf(value) {
  const list = Array.isArray(value?.symbols) ? value.symbols : null;
  if (!list) return null;
  const out = list
    .map(s => (typeof s === 'string' ? { symbol: s, meaning: '' } : { symbol: String(s?.symbol || '').trim(), meaning: String(s?.meaning || '') }))
    .filter(s => s.symbol && s.symbol.length <= MAX);
  return out.length ? out : null;
}

export function useMessageReactions({ setThread, showToast }) {
  const me = getGhii() || '';
  const [palette, setPalette] = useState(DEFAULT_PALETTE);

  useEffect(() => {
    if (!me) return;
    let gone = false;
    apiGet(`/v1/memory/${encodeURIComponent(me)}/${encodeURIComponent(PALETTE_KEY)}`)
      .then(r => { const p = paletteOf(r?.data?.value); if (p && !gone) setPalette(p); })
      // No record is the ordinary case: the default palette stays.
      .catch(err => swallowed('inbox reactions: palette', err));
    return () => { gone = true; };
  }, [me]);

  /** Give a mark, or take one's own back when `remove`. The thread takes the node's answer. */
  const react = useCallback(async (msg, reaction, remove) => {
    const symbol = String(reaction || '').trim();
    if (!symbol) return;
    if (symbol.length > MAX) { showToast?.(t('inbox.react.tooLong', { max: String(MAX) }), true); return; }
    let resp;
    try { resp = await messages.reactToMessage(msg.id, symbol, remove); }
    catch { showToast?.(t('inbox.react.failed'), true); return; }
    if (resp?.ok === false) { showToast?.(resp.error?.message || t('inbox.react.failed'), true); return; }
    const list = resp?.data?.reactions || [];
    setThread(prev => prev.map(m => (m.id === msg.id ? { ...m, reactions: list } : m)));
  }, [setThread, showToast]);

  return { palette, me, react };
}

/**
 * A message's marks as the bubble draws them: the symbol, how many gave it, whether one of them is
 * this person, and who they are in the tooltip. The person's own name reads "you".
 */
export function reactionItems(msg, me, nameOf) {
  return (msg.reactions || []).map(r => {
    const mine = r.by.includes(me);
    const names = r.by.map(g => (g === me ? t('inbox.quoteYou') : nameOf(g)));
    return { reaction: r.reaction, count: r.by.length, mine, title: names.join(', ') };
  });
}
