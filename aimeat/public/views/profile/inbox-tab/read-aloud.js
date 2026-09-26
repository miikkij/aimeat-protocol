/**
 * @file public/views/profile/inbox-tab/read-aloud.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read-aloud controls for the profile Inbox thread — the same "listen instead of read"
 *   affordance the (L)AIMEAT Sanomat app gives its articles, brought to direct messages:
 *   ThreadReadAloud (the thread-head button that reads the whole open conversation, sender by sender,
 *   with pause/resume; it owns its hooks, so the pure ThreadPanel stays hook-free). A single message's
 *   Listen is the Message component's (components/Message.js). Both drive the shared
 *   /js/services/speech-reader.js engine, which keeps ONE reader active at a time — starting a message
 *   stops the thread reader and vice versa.
 * @structure ThreadReadAloud · threadParagraphs (thread → speakable paragraphs, each message prefixed
 *   by its sender).
 * @usage import { ThreadReadAloud } from './inbox-tab/read-aloud.js';
 * @version-history
 *   v1.4.0 — 2026-09-26 — Listen is the pane head's door (ConversationPane PaneDoor): its words hide in a narrow pane, its mark stays.
 *   v1.3.1 — 2026-09-26 — The thread head's Listen is the kit's Action (small, row), the same cut as Reply with AI beside it; its 🔊/⏸ mark, its words (Listen, Pause, Continue) and its pressed state stay; ✕ is the Icon.
 *   v1.3.0 — 2026-09-26 — useSpeechPhase and a message's Listen (BubbleSpeakButton) moved into the
 *     Message component unchanged; the thread head's reader stays here.
 *   v1.2.0 — 2026-09-26 — A message's read-aloud control is the chat's Listen: the word, in the text
 *     tone of the action link, in the line under the message (Jouni's decision "Message").
 *   v1.1.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.0.0 — 2026-07-31 — Initial version: per-message and whole-thread read-aloud in the Inbox tab.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { isSpeechSupported, speak, stop, pause, resume, textToParagraphs } from '/js/services/speech-reader.js';
// The phase hook and a message's own Listen live with the Message component now.
import { useSpeechPhase } from '/components/Message.js';
import { Icon } from '/components/Action.js';
import { PaneDoor } from '/components/ConversationPane.js';

/** The open thread as speakable paragraphs: each message announces its sender, then its body. Messages
 *  with no speakable body (attachment-only) are skipped rather than announced into silence. */
export function threadParagraphs(thread, youLabel, peerLabelText) {
  const out = [];
  for (const m of thread || []) {
    const body = textToParagraphs(m.body);
    if (!body.length) continue;
    out.push(`${m.direction === 'outbound' ? youLabel : peerLabelText}:`);
    out.push(...body);
  }
  return out;
}

/** Thread-head "Listen": reads the whole open conversation. Idle → Listen, speaking → Pause,
 *  paused → Continue (the Sanomat header model). A ✕ next to it stops and resets.
 *  The reader id carries the conversation id: this component is NOT remounted when you switch threads
 *  (same position in the head), so without that the reader would keep reading the conversation you just
 *  left. Changing the id re-runs useSpeechPhase's cleanup, which stops the old reading. */
export function ThreadReadAloud({ thread, peerLabelText, convId }) {
  const id = `thread:${convId || ''}`;
  const phase = useSpeechPhase(id);
  if (!isSpeechSupported()) return null;
  const label = phase === 'speaking' ? t('inbox.speak.pause')
    : phase === 'paused' ? t('inbox.speak.resume')
      : t('inbox.speak.listen');
  const onClick = () => {
    if (phase === 'speaking') { pause(); return; }
    if (phase === 'paused') { resume(); return; }
    speak(id, threadParagraphs(thread, t('inbox.quoteYou'), peerLabelText));
  };
  return html`
    <${PaneDoor} mark=${phase === 'speaking' ? '⏸' : '🔊'} label=${label} title=${t('inbox.speak.thread')}
      pressed=${!!phase} onClick=${onClick} />
    ${phase ? html`<${Icon} small label=${t('inbox.speak.stop')} onClick=${() => stop()}>✕<//>` : null}`;
}
