/**
 * @file messages-ai-prompts.js
 * @description Builds the copy-pasteable / MCP prompts behind the Inbox "Reply with AI" feature
 *   (TARGET-031). The user drives their own AI chat (Claude, …) to craft a reply to an AIMEAT
 *   Postilaatikko conversation — with the AI able to reach INTO their AIMEAT (organisms, memory,
 *   workspaces, librarian) so the reply is grounded, unlike a generic LinkedIn/Telegram AI button.
 *   Two builders (whole conversation / single message) × two modes:
 *     - 'copy' : a self-contained prompt the user pastes into any AI chat; they paste the reply back.
 *     - 'mcp'  : an instruction prompt for an AI with the AIMEAT MCP connected — it reads the LIVE thread
 *                (aimeat_dm_thread) and researches inside AIMEAT, then hands the finished reply back for
 *                the OWNER to send from the UI. It deliberately does NOT call aimeat_dm_send: an MCP
 *                session authenticates as the owner's AGENT, so a direct send would post under the agent
 *                (a separate thread), not as the owner. (A consent-gated "send as owner" delegation is a
 *                separate follow-up.)
 *   The Postilaatikko is the FEDERATION dm surface (aimeat_dm_*, NOT the private agent↔owner
 *   aimeat_message_* channel). Prompt text is English (house rule); the AI answers in the conv's language.
 * @structure
 *   - MODES: { COPY, MCP }
 *   - handleOf(id) / peerLabel(id) — short label helpers (mirrors inbox-tab peerName)
 *   - buildConversationReplyPrompt({ peerGhii, subject, conversationId, thread }, mode)
 *   - buildMessageReplyPrompt({ peerGhii, subject, conversationId, message }, mode)
 * @usage
 *   import { buildConversationReplyPrompt, MODES } from '/js/services/messages-ai-prompts.js';
 *   const text = buildConversationReplyPrompt({ peerGhii, subject, conversationId, thread }, MODES.COPY);
 * @version-history
 *   v1.0.0 -- 2026-07-12 -- Initial: conversation + message reply prompts, copy + mcp modes (TARGET-031).
 *   v1.1.0 -- 2026-07-12 -- Fix MCP-mode identity trap: the prompt no longer tells the AI to send via
 *     aimeat_dm_send (an MCP session is the owner's AGENT, so the send went out under the agent into a
 *     separate thread). MCP mode now reads + researches + drafts and hands the reply back to the owner
 *     to send from the UI. "Send as owner" delegation tracked as a follow-up.
 */

export const MODES = { COPY: 'copy', MCP: 'mcp' };

/** The login handle behind any principal id: 'agent#owner@node' → 'agent', 'owner@node' → 'owner'. */
export function handleOf(id) {
  if (!id) return '';
  const beforeAt = String(id).split('@')[0];
  return beforeAt.includes('#') ? beforeAt.split('#').pop() : beforeAt;
}

/** A human-friendly label for the peer. `displayName` wins when present, with the handle in parens. */
export function peerLabel(id, displayName) {
  const handle = handleOf(id);
  const dn = (displayName || '').trim();
  return dn && dn !== handle ? `${dn} (${handle})` : handle;
}

/** A short, stable timestamp for the transcript (locale-independent so the prompt is reproducible). */
function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '';
}

/** Render the thread as a plain-text transcript: "Me" for my messages, the peer's label otherwise. */
function transcript(thread, peerGhii, peerName) {
  const them = peerName || handleOf(peerGhii);
  return (thread || [])
    .map((m) => {
      const who = m.direction === 'outbound' ? 'Me' : them;
      const when = stamp(m.createdAt);
      const body = String(m.body || '').trim();
      return `[${when}] ${who}:\n${body}`;
    })
    .join('\n\n');
}

/* The shared framing that makes AIMEAT's edge explicit: the AI can look INSIDE the user's own
 * AIMEAT (organisms, memory, workspaces, librarian) to ground the reply. */
function enrichmentBlock() {
  return [
    'This conversation lives in AIMEAT — my AI-native workspace, where my company\'s knowledge lives',
    '(organisms, workspaces, memory, documents). If you have my AIMEAT MCP connected, look things up',
    'before you answer instead of guessing:',
    '- Search my memory (aimeat_memory_search) and read my workspaces (aimeat_workspace_overview,',
    '  aimeat_workspace_read) and organisms (aimeat_organism_list, aimeat_organism_overview) for',
    '  anything relevant to this conversation.',
    '- Use whatever knowledge / librarian / catalogue search my MCP offers (e.g. aimeat_catalogue_search)',
    '  to find documents, facts, or links I can point to.',
    'Ground the reply in what you find. When you can point to a specific place — an AIMEAT Pages link, a',
    'workspace document, or a URL — include that link in the reply so I can send it back.',
  ].join('\n');
}

/**
 * @typedef {Object} ReplyMsg
 * @property {string} [direction]
 * @property {string} [body]
 * @property {string} [createdAt]
 */
/**
 * @typedef {Object} ConversationSource
 * @property {string} [peerGhii]
 * @property {string} [subject]
 * @property {string} [conversationId]
 * @property {ReplyMsg[]} [thread]
 * @property {string} [peerName]
 */
/**
 * @typedef {Object} MessageSource
 * @property {string} [peerGhii]
 * @property {string} [subject]
 * @property {string} [conversationId]
 * @property {ReplyMsg} [message]
 * @property {string} [peerName]
 */

/**
 * Whole-conversation reply prompt (Postilaatikko thread) in the requested mode.
 * @param {ConversationSource} [src]
 * @param {string} [mode]
 */
export function buildConversationReplyPrompt({ peerGhii, subject, conversationId, thread, peerName } = {}, mode = MODES.COPY) {
  const them = peerLabel(peerGhii, peerName);
  const topic = subject ? ` (topic: "${subject}")` : '';
  const convo = transcript(thread, peerGhii, peerName || handleOf(peerGhii));

  if (mode === MODES.MCP) {
    return [
      '# Reply in AIMEAT with MCP research',
      '',
      `Use my connected AIMEAT MCP to help me reply to my conversation with **${them}**${topic} in the`,
      'AIMEAT Postilaatikko (the federation-wide direct-message inbox). Read the live thread and research',
      'inside my AIMEAT, then give me a finished reply that I will send myself.',
      '',
      '## Steps',
      `1. Read the full, up-to-date thread: call \`aimeat_dm_thread\` with conversation_id "${conversationId || ''}".`,
      `   If that id doesn't resolve, call \`aimeat_dm_inbox\` and find the thread with ${handleOf(peerGhii)} (${peerGhii}).`,
      '2. Research before answering:',
      enrichmentBlock().split('\n').map((l) => `   ${l}`).join('\n'),
      '3. Draft a reply in the SAME language as the conversation, grounded in what you found, with links',
      '   to the specific place (AIMEAT Pages, a workspace document, a URL) where useful.',
      '4. Give me the finished reply so I can review it and send it from the AIMEAT UI myself.',
      '   Do NOT send it with `aimeat_dm_send`: your MCP connection is my agent, so a direct send would go',
      '   out under the agent\'s name and start a separate thread — I want the reply to come from me, in',
      '   this thread, so I will send it myself.',
      '',
      '## The conversation so far',
      convo,
    ].join('\n');
  }

  // COPY mode — self-contained, paste into any AI chat, paste the reply back yourself.
  return [
    '# Help me reply in AIMEAT',
    '',
    `I want to reply to my conversation with **${them}**${topic} in AIMEAT. Help me write a strong,`,
    'accurate reply that I can review and send myself.',
    '',
    '## Context',
    enrichmentBlock(),
    '',
    '## The conversation',
    convo,
    '',
    '## What I need from you',
    `1. A one-line read of what ${them} is asking or expecting.`,
    '2. A ready-to-send reply in the same language as the conversation, that I can review and tweak.',
    '3. Any links or references you found that back it up.',
    '',
    'Ask me for anything you need before finalizing. I will paste your reply back into AIMEAT myself.',
  ].join('\n');
}

/**
 * Single-message reply prompt — scoped to one message the user pointed at.
 * @param {MessageSource} [src]
 * @param {string} [mode]
 */
export function buildMessageReplyPrompt({ peerGhii, subject, conversationId, message, peerName } = {}, mode = MODES.COPY) {
  const them = peerLabel(peerGhii, peerName);
  const topic = subject ? ` (topic: "${subject}")` : '';
  const who = message?.direction === 'outbound' ? 'Me' : (peerName || handleOf(peerGhii));
  const one = `[${stamp(message?.createdAt)}] ${who}:\n${String(message?.body || '').trim()}`;

  if (mode === MODES.MCP) {
    return [
      '# Reply to one message in AIMEAT with MCP research',
      '',
      `Use my connected AIMEAT MCP to help me reply to this specific message from **${them}**${topic} in`,
      'the AIMEAT Postilaatikko (federation-wide direct-message inbox). Read the live thread and research',
      'inside my AIMEAT, then give me a finished reply that I will send myself.',
      '',
      '## The message',
      one,
      '',
      '## Steps',
      `1. For full context, read the thread with \`aimeat_dm_thread\` (conversation_id "${conversationId || ''}"; if it`,
      `   doesn't resolve, use \`aimeat_dm_inbox\` to find the thread with ${handleOf(peerGhii)}).`,
      '2. Research before answering:',
      enrichmentBlock().split('\n').map((l) => `   ${l}`).join('\n'),
      '3. Draft a reply in the SAME language as the message, grounded in what you found, with links to the',
      '   specific place (AIMEAT Pages, a workspace document, a URL) where useful.',
      '4. Give me the finished reply so I can review it and send it from the AIMEAT UI myself.',
      '   Do NOT send it with `aimeat_dm_send`: your MCP connection is my agent, so a direct send would go',
      '   out under the agent\'s name and start a separate thread — I want the reply to come from me, in',
      '   this thread, so I will send it myself.',
    ].join('\n');
  }

  // COPY mode
  return [
    '# Help me reply to one message in AIMEAT',
    '',
    `I want to reply to this specific message from **${them}**${topic} in AIMEAT. Help me write a strong,`,
    'accurate reply that I can review and send myself.',
    '',
    '## Context',
    enrichmentBlock(),
    '',
    '## The message',
    one,
    '',
    '## What I need from you',
    '1. A one-line read of what they are asking or expecting.',
    '2. A ready-to-send reply in the same language as the message, that I can review and tweak.',
    '3. Any links or references you found that back it up.',
    '',
    'Ask me for anything you need before finalizing. I will paste your reply back into AIMEAT myself.',
  ].join('\n');
}
