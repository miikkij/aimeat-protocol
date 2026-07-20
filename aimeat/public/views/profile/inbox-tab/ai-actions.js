/**
 * @file public/views/profile/inbox-tab/ai-actions.js
 * @description Builds the config objects behind the Inbox thread-head AI actions, so InboxTab's handlers
 *   stay one-liners (and the file stays under max-file-lines). Two families:
 *     - Reply with AI (TARGET-031): buildConversationReplyProps / buildMessageReplyProps → { title, build }
 *       for ReplyWithAiPopover (build(mode) → copy/mcp prompt).
 *     - Conversation → Notebook: buildConversationNotebookProps → { title, promptText, runServerSummary,
 *       parkConversation } for ConversationToNotebookPopover. runServerSummary calls /v1/ai/complete on the
 *       owner's own OpenRouter key (vision-aware, up to 8 images); parkConversation files the whole thread.
 * @structure
 *   - collectThreadImages(thread, urlMap) — [{messageId,id,name,url}] for every image attachment
 *   - buildConversationReplyProps({ activeConv, thread, peerName, peerDisplayName })
 *   - buildMessageReplyProps({ activeConv, msg, peerName })
 *   - buildConversationNotebookProps({ activeConv, thread, urlMap, peerName, title })
 * @usage
 *   import { buildConversationNotebookProps } from './inbox-tab/ai-actions.js';
 *   setNbConv(buildConversationNotebookProps({ activeConv, thread, urlMap, peerName, title }));
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: extracted the Reply-with-AI + Conversation→Notebook assembly from inbox-tab.js.
 */
import { api } from '/js/api.js';
import { t } from '/js/i18n.js';
import { parkConversationToNotebook } from '/js/services/notebook.js';
import { buildConversationReplyPrompt, buildMessageReplyPrompt, buildConversationSummaryPrompt } from '/js/services/messages-ai-prompts.js';
import { attachKind } from './helpers.js';

/** Reply-with-AI props for the whole open conversation (ReplyWithAiPopover: build(mode) → prompt). */
export function buildConversationReplyProps({ activeConv, thread, peerName, peerDisplayName }) {
  const src = { peerGhii: activeConv.peerGhii, subject: activeConv.subject, conversationId: activeConv.conversationId, thread, peerName };
  return { title: `${t('inbox.ai.replyTo')} ${peerDisplayName}`, build: (mode) => buildConversationReplyPrompt(src, mode) };
}

/** Reply-with-AI props scoped to one message the user pointed at. */
export function buildMessageReplyProps({ activeConv, msg, peerName }) {
  const src = { peerGhii: activeConv.peerGhii, subject: activeConv.subject, conversationId: activeConv.conversationId, message: msg, peerName };
  return { title: t('inbox.ai.replyToMessage'), build: (mode) => buildMessageReplyPrompt(src, mode) };
}

/** Every image attachment across the loaded thread, resolved to a viewable url (urlMap is keyed
 *  `${messageId}::${attachmentId}`). Used both for the vision summary call and the notebook embeds. */
export function collectThreadImages(msgs, urls) {
  const out = [];
  for (const m of (msgs || [])) {
    for (const a of (m.attachments || [])) {
      if (attachKind(a) !== 'image' || a.expired) continue;
      const url = urls[`${m.id}::${a.id}`];
      if (url) out.push({ messageId: m.id, id: a.id, name: a.name || a.storageKey || 'image', url });
    }
  }
  return out;
}

/**
 * Build the ConversationToNotebookPopover config for the open thread: the summary prompt, plus the
 * server-summary and park callbacks (the popover picks the mode and calls back).
 * @param {object} args
 * @param {{ conversationId?:string, peerGhii?:string, subject?:string }} args.activeConv
 * @param {Array} args.thread
 * @param {Record<string,string>} args.urlMap
 * @param {string} [args.peerName]
 * @param {string} args.title
 */
export function buildConversationNotebookProps({ activeConv, thread, urlMap, peerName, title }) {
  const src = { peerGhii: activeConv.peerGhii, subject: activeConv.subject, thread, peerName };
  const images = collectThreadImages(thread, urlMap);
  const promptText = buildConversationSummaryPrompt(src);
  // Server-side summary on the owner's own OpenRouter key. Text-only on purpose: the thread's image
  // attachments are JWT-presigned `/v1/download/…` urls that OpenRouter's servers can't fetch (→ 502),
  // so we never send them to the model. The images are still captured into the notebook entry below
  // (transcript embeds + source.attachments) for the owner to view; the durable value is the text.
  const runServerSummary = async () => {
    const resp = await api('/v1/ai/complete', {
      method: 'POST',
      body: JSON.stringify({ prompt: promptText }),
      timeoutMs: 1_800_000,
      retries: 0,
    });
    if (resp?.ok === false) throw new Error(resp.error?.message || t('inbox.failed'));
    return resp?.data?.content || '';
  };
  const parkConversation = ({ summary }) => parkConversationToNotebook({
    conv: { conversationId: activeConv.conversationId, peerGhii: activeConv.peerGhii, subject: activeConv.subject },
    thread, peerName, summary, images,
  });
  return { title, promptText, runServerSummary, parkConversation };
}
