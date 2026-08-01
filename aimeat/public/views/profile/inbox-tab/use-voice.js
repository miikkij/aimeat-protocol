/**
 * @file public/views/profile/inbox-tab/use-voice.js
 * @description The Inbox tab's voice-message state: whether this owner can transcribe at all, how
 *   long the node lets a recording run, and the call that turns one voice attachment into text.
 *   Extracted from inbox-tab.js to keep it under the max-file-lines rule.
 * @structure useVoiceMessages(loadThread, activeConvRef) → { canTranscribe, voiceMaxSeconds, transcribeVoice }
 * @usage const { canTranscribe, voiceMaxSeconds, transcribeVoice } = useVoiceMessages(loadThread, activeConvRef);
 * @version-history
 *   v1.0.0 — 2026-08-01 — Extracted from inbox-tab.js (voice messages).
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import * as messages from '/js/services/messages.js';
import { swallowed } from '/js/swallowed.js';

/**
 * @param {(conv: any, markRead?: boolean) => Promise<void>} loadThread
 * @param {{ current: any }} activeConvRef  the OPEN conversation, read at call time
 */
export function useVoiceMessages(loadThread, activeConvRef) {
  // canTranscribe answers "has this owner chosen a transcription model", which decides whether a
  // voice bubble offers a Transcribe button or explains why it cannot. Read once per mount: an owner
  // does not change it mid-thread, and polling it would be a request per render for one boolean.
  const [canTranscribe, setCanTranscribe] = useState(null);
  // Served by the node so the recorder stops at the operator's number rather than one compiled in.
  const [voiceMaxSeconds, setVoiceMaxSeconds] = useState(300);

  useEffect(() => {
    apiGet('/v1/openrouter/settings')
      .then((r) => {
        setCanTranscribe(!!(r?.data?.sttModel));
        const n = Number(r?.data?.limits?.voice_msg_max_seconds);
        if (n > 0) setVoiceMaxSeconds(n);
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
