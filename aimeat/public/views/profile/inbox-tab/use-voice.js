/**
 * @file public/views/profile/inbox-tab/use-voice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Inbox tab's voice-message state: whether this owner can transcribe at all, how
 *   long the node lets a recording run, and the call that turns one voice attachment into text.
 *   Extracted from inbox-tab.js to keep it under the max-file-lines rule.
 * @structure useVoiceMessages(loadThread, activeConvRef) → { canTranscribe, voiceMaxSeconds, transcribeVoice }
 * @usage const { canTranscribe, voiceMaxSeconds, transcribeVoice } = useVoiceMessages(loadThread, activeConvRef);
 * @version-history
 *   v1.2.0 — 2026-10-13 — Legacy route first, provider path on 410 (js/services/ai-connection.js
 *     legacyOr): on 3.x the Transcribe control follows the owner's transcription model in GET
 *     /v1/openrouter/settings again, as before v1.1.0; the reads of v1.1.0 run on node 4.0.0.
 *   v1.1.0 — 2026-10-12 — Whether this owner can transcribe comes from GET /v1/ai/capabilities
 *     (transcription.on), and the recorder's limit from GET /v1/ai/settings (limits): node 4.0.0
 *     removes GET /v1/openrouter/settings, which answered both.
 *   v1.0.0 — 2026-08-01 — Extracted from inbox-tab.js (voice messages).
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { legacyOr } from '/js/services/ai-connection.js';
import * as messages from '/js/services/messages.js';
import { swallowed } from '/js/swallowed.js';

/**
 * @param {(conv: any, markRead?: boolean) => Promise<void>} loadThread
 * @param {{ current: any }} activeConvRef  the OPEN conversation, read at call time
 */
export function useVoiceMessages(loadThread, activeConvRef) {
  // canTranscribe answers "can this owner transcribe now", which decides whether a
  // voice bubble offers a Transcribe button or explains why it cannot. Read once per mount: an owner
  // does not change it mid-thread, and polling it would be a request per render for one boolean.
  const [canTranscribe, setCanTranscribe] = useState(null);
  // Served by the node so the recorder stops at the operator's number rather than one compiled in.
  const [voiceMaxSeconds, setVoiceMaxSeconds] = useState(300);

  useEffect(() => {
    // The legacy route while the node answers it; on a 410 (node 4.0.0) the provider path
    // (js/services/ai-connection.js legacyOr).
    legacyOr(() => apiGet('/v1/openrouter/settings')
      .then((r) => {
        setCanTranscribe(!!(r?.data?.sttModel));
        const n = Number(r?.data?.limits?.voice_msg_max_seconds);
        if (n > 0) setVoiceMaxSeconds(n);
      }), async () => {
      // Whether a transcription would find a provider and a model now: the same gate the call runs.
      apiGet('/v1/ai/capabilities')
        .then((r) => setCanTranscribe(!!(r?.data?.capabilities?.transcription?.on)))
        .catch((err) => { swallowed('inbox-tab: transcription capability', err); setCanTranscribe(false); });
      // The node's ceiling comes with the owner's AI budget settings.
      apiGet('/v1/ai/settings')
        .then((r) => {
          const n = Number(r?.data?.limits?.voice_msg_max_seconds);
          if (n > 0) setVoiceMaxSeconds(n);
        })
        .catch((err) => swallowed('inbox-tab: voice limit', err));
    })
      .catch((err) => { swallowed('inbox-tab: stt settings', err); setCanTranscribe(false); });
  }, []);

  /** Transcribe one voice attachment on the caller's OWN copy, then reload the thread so the text
   *  appears where the audio is. Errors are rethrown so the bubble can show them in place. */
  const transcribeVoice = useCallback(async (msgId, attId) => {
    const r = await messages.transcribeAttachment(msgId, attId);
    if (r?.ok === false) throw new Error(r?.error?.message || t('inbox.transcribeFailed'));
    const conv = activeConvRef.current;
    if (conv) await loadThread(conv);
    return r?.data;
  }, [loadThread, activeConvRef]);

  return { canTranscribe, voiceMaxSeconds, transcribeVoice };
}
