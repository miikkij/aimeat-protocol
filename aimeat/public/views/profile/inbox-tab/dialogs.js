/**
 * @file public/views/profile/inbox-tab/dialogs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three dialogs the Messages page opens: the in-app viewer for a markdown
 *   attachment, Reply with AI (TARGET-031: hand the conversation or one message to the person's own
 *   AI chat, by copying a prompt or through MCP) and Conversation to Notebook (capture a whole
 *   thread with its images: a server-side AI summary on the owner's key, a prompt for their own
 *   chat, or the raw chain). Each owns its own hooks; InboxTab supplies the async work.
 * @structure MarkdownViewer · ReplyWithAiPopover · ConversationToNotebookPopover
 * @usage import { MarkdownViewer, ReplyWithAiPopover, ConversationToNotebookPopover } from './dialogs.js';
 * @version-history
 *   v1.0.0 -- 2026-09-22 -- Moved out of components.js and composed from the shared set (Dialog,
 *     Action tabs, Field, Surface), so the three dialogs look like every other dialog on the site
 *     and the inbox sheets could go. The emoji left the buttons. Behaviour unchanged.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { AiInteractionNotice } from '/components/ai-label.js';
import { MODES } from '/js/services/messages-ai-prompts.js';
import { Dialog, Action, CopyAction, Field, Stack, Surface, Text } from '/components/poster-parts.js';

/** In-app viewer for a markdown attachment — browsers don't render .md, so we fetch the (same-origin,
 *  presigned) file and render it with the shared safe Markdown component. Offers open-raw + download. */
export function MarkdownViewer({ url, name, onClose }) {
  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error('http'))).then(tx => { if (alive) setText(tx); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${name} size="large" guard=${false}
      actions=${html`
        <${Action} href=${url} target="_blank">${t('inbox.attachmentOpenRaw')}<//>
        <${Action} href=${url} download=${name}>${t('inbox.attachmentDownload')}<//>`}>
      ${failed ? html`<${Text} tone="muted">${t('inbox.attachmentLoadError')}<//>`
        : text === null ? html`<${Text} tone="muted">…<//>`
        : html`<${Markdown} text=${text} />`}
    <//>`;
}

/** Two or three ways as tabs; what the chosen one decides sits on the panel under them. */
const ModeTabs = ({ modes, mode, setMode }) => html`
  <${Stack} direction="wrap" role="tablist">
    ${modes.map(([id, label]) => html`<${Action} key=${id} kind="tab" semantics="tab" selected=${mode === id}
      onClick=${() => setMode(id)}>${label}<//>`)}
  <//>`;

/* ── Reply with AI (TARGET-031) — hand the conversation (or one message) to the user's OWN AI chat so
 *    it can craft a reply WITH access to their AIMEAT (organisms, memory, workspaces, librarian). Two
 *    modes: COPY (paste into any AI chat, paste the reply back) and MCP (an AI with the AIMEAT MCP reads
 *    the thread via aimeat_dm_thread, researches, drafts, and sends via aimeat_dm_send after approval).
 *    `build(mode)` returns the prompt for the picked mode; the InboxTab supplies it per source. ── */
export function ReplyWithAiPopover({ title, build, onClose, showToast }) {
  const [mode, setMode] = useState(MODES.COPY);
  const text = build(mode);
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${title} size="large" guard=${false}
      actions=${html`<${CopyAction} kind="primary" text=${text}
        label=${t('common.copy')} copiedLabel=${'✓ ' + t('inbox.ai.copied')}
        onCopied=${() => showToast?.(t('inbox.ai.copied'))} />`}>
      <${Stack}>
        <${ModeTabs} mode=${mode} setMode=${setMode} modes=${[[MODES.COPY, t('common.copyPrompt')], [MODES.MCP, t('inbox.ai.modeMcp')]]} />
        <${Surface} kind="panel">
          <${Stack}>
            <${Text}>${mode === MODES.COPY ? t('inbox.ai.hintCopy') : t('inbox.ai.hintMcp')}<//>
            <${Field} type="textarea" readOnly=${true} rows=${14} value=${text} ariaLabel=${title} />
          <//>
        <//>
      <//>
    <//>`;
}

/* ── Conversation → Notebook — capture a WHOLE thread (with its images) into the notebook for later
 *    filing/enrichment into a workspace. Three modes, all landing in parkConversationToNotebook:
 *      ai   — summarize server-side with the owner's own OpenRouter key (runServerSummary), edit, park.
 *      copy — copy the summary prompt into the owner's own AI chat, paste the result back, park.
 *      raw  — park the whole chain (text + images) as-is; enrich it later in the Notebook.
 *    The parent (InboxTab) owns the async work (AI call + park + toasts) via the passed callbacks. ── */
export function ConversationToNotebookPopover({ title, promptText, runServerSummary, parkConversation, onClose, showToast }) {
  const [mode, setMode] = useState('ai');       // 'ai' | 'copy' | 'raw'
  const [aiSummary, setAiSummary] = useState('');
  // TARGET-058: `meta.provenance` for the summary the model just produced, so the reader is told a
  // model wrote it before they keep it. It is NOT an Art. 50(4) content label — this text is private
  // to its owner and owes none — which is why the standing AiInteractionNotice carries it and not
  // AiLabel (whose whole job is to render only when a label is legally owed).
  const [aiProvenance, setAiProvenance] = useState(null);
  const [pasted, setPasted] = useState('');
  const [running, setRunning] = useState(false);
  const [parking, setParking] = useState(false);

  const genSummary = async () => {
    setRunning(true);
    try {
      const r = await runServerSummary();
      const text = (typeof r === 'string' ? r : r?.content) || '';
      if (text.trim()) {
        setAiSummary(text.trim());
        setAiProvenance(typeof r === 'string' ? null : (r?.provenance || null));
      } else showToast?.(t('inbox.notebook.summaryEmpty'), true);
    } catch (e) { showToast?.(e?.message || t('inbox.failed'), true); }
    finally { setRunning(false); }
  };

  const doPark = async (summary) => {
    setParking(true);
    try { await parkConversation({ summary: summary || '' }); showToast?.(t('inbox.notebook.parked')); onClose(); }
    catch (e) { showToast?.(e?.message || t('inbox.failed'), true); setParking(false); }
  };

  // A summary being written or pasted is a half-written form: the dialog's guard keeps it open.
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${title} size="large">
      <${Stack}>
        <${ModeTabs} mode=${mode} setMode=${setMode} modes=${[['ai', t('inbox.notebook.modeAi')], ['copy', t('common.copyPrompt')], ['raw', t('inbox.notebook.modeRaw')]]} />
        <${Surface} kind="panel">
          <${Stack}>
          ${mode === 'ai' ? html`
            <${Text}>${t('inbox.notebook.hintAi')}<//>
            ${!aiSummary ? html`
              <${Stack} direction="horizontal">
                <${Action} kind="primary" disabled=${running} onClick=${genSummary}>${running ? '… ' + t('inbox.notebook.summarizing') : t('inbox.notebook.genSummary')}<//>
              <//>`
            : html`
              <${AiInteractionNotice} titleKey="aiLabel.draftTitle" bodyKey="aiLabel.draftBody"
                recordUrl=${aiProvenance?.recordUrl} />
              <${Field} type="textarea" rows=${12} value=${aiSummary} ariaLabel=${title} onInput=${(e) => setAiSummary(e.target.value)} />
              <${Stack} direction="horizontal">
                <${Action} disabled=${running} onClick=${genSummary}>${running ? '…' : t('inbox.notebook.regen')}<//>
                <${Action} kind="primary" disabled=${parking} onClick=${() => doPark(aiSummary)}>${parking ? '…' : t('inbox.notebook.park')}<//>
              <//>`}
          ` : mode === 'copy' ? html`
            <${Text}>${t('inbox.notebook.hintCopy')}<//>
            <${Field} type="textarea" readOnly=${true} rows=${8} value=${promptText} ariaLabel=${t('common.copyPrompt')} />
            <${Stack} direction="horizontal">
              <${CopyAction} text=${promptText} label=${t('common.copy')} copiedLabel=${'✓ ' + t('inbox.ai.copied')}
                onCopied=${() => showToast?.(t('inbox.ai.copied'))} />
            <//>
            <${Text}>${t('inbox.notebook.pasteHint')}<//>
            <${Field} type="textarea" rows=${8} placeholder=${t('inbox.notebook.pastePh')} ariaLabel=${t('inbox.notebook.pastePh')}
              value=${pasted} onInput=${(e) => setPasted(e.target.value)} />
            <${Stack} direction="horizontal">
              <${Action} kind="primary" disabled=${parking || !pasted.trim()} onClick=${() => doPark(pasted)}>${parking ? '…' : t('inbox.notebook.park')}<//>
            <//>
          ` : html`
            <${Text}>${t('inbox.notebook.hintRaw')}<//>
            <${Stack} direction="horizontal">
              <${Action} kind="primary" disabled=${parking} onClick=${() => doPark('')}>${parking ? '…' : t('inbox.notebook.parkRaw')}<//>
            <//>
          `}
          <//>
        <//>
      <//>
    <//>`;
}
