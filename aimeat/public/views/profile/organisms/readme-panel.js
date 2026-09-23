/**
 * @file readme-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Free-form README panel for an organism or workspace — a markdown body (mermaid allowed)
 *   rendered at the top of the page that explains what the thing is about and is kept up to date. View
 *   mode renders via the safe Markdown component; edit mode is a markdown textarea with a live preview
 *   toggle. README is authored (by a human or, primarily, an agent via MCP) — it is SEPARATE from the
 *   deterministic structure overview/mindmap. The "Generate with AI" affordance follows the prompt-
 *   driven model: it copies a ready prompt (seeded with the structure table of contents) for the user
 *   to run in their AI chat and paste back. Save is delegated to the parent (`onSave(markdown)`).
 * @structure ReadmePanel({ markdown, canEdit, onSave, aiPromptSeed, kind })
 * @usage import { ReadmePanel } from '/views/profile/organisms/readme-panel.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: README display + editor + prompt-driven AI fill (Osa A).
 *   v1.1.0 — 2026-08-08 — The editor's "Generate with AI" is a shared <CopyButton> driving the paste-back hint via
 *       onCopied. The empty-state button opens the editor AND copies, so it stays a plain button —
 *       but copies through the shared copyToClipboard helper, not its own clipboard call.
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared set (Stack, Field, Action, CopyAction): no class of
 *     its own; the one Save is the loud action, preview is a tab that is on while it shows.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { Stack, Surface, Field, Action, CopyAction, Text } from '/components/poster-parts.js';
import { Markdown } from '/components/Markdown.js';

/** Build a ready copy-paste prompt for an AI chat to write the README, seeded with the structure. */
function buildAiPrompt(kind, name, seed) {
  const what = kind === 'workspace' ? 'workspace' : 'organism';
  return [
    `Write a clear, well-structured README in Markdown for the AIMEAT ${what} "${name}".`,
    `Explain what it is for, what it contains, and how it is organised. You MAY include a Mermaid`,
    `diagram (in a \`\`\`mermaid code block) if it helps, but it is optional. Keep it accurate and`,
    `concise. Return ONLY the Markdown.`,
    '',
    `Here is the current structure (table of contents) to base it on:`,
    '',
    seed || '(no structure captured yet)',
  ].join('\n');
}

export function ReadmePanel({ markdown, canEdit, onSave, aiPromptSeed, kind, name }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(markdown || '');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setDraft(markdown || ''); }, [markdown]);

  const save = async () => {
    setBusy(true);
    try { await onSave?.(draft); setEditing(false); }
    finally { setBusy(false); }
  };

  // `copied` outlives the button's own 2s confirmation: it also reveals the paste-back hint
  // under the editor, which is why the state stays here and CopyButton drives it via onCopied.
  const markCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 2500); };

  // The empty-state affordance opens the editor AND copies, so it stays a plain button — but it
  // copies through the same shared helper <CopyButton> uses, not its own clipboard call.
  const openEditorAndCopy = async () => {
    await copyToClipboard(buildAiPrompt(kind, name, aiPromptSeed));
    markCopied();
  };

  if (editing) {
    return html`<${Stack}>
      <${Stack} direction="wrap" align="between">
        <${Text} kind="label">${t('readme.editTitle') || 'Edit README'}<//>
        <${Stack} direction="wrap" align="center">
          <${Action} kind="tab" selected=${preview} onClick=${() => setPreview(p => !p)}>${preview ? (t('readme.write') || 'Write') : (t('readme.preview') || 'Preview')}<//>
          ${aiPromptSeed !== undefined ? html`<${CopyAction} text=${buildAiPrompt(kind, name, aiPromptSeed)}
            label=${t('readme.generateAi') || 'Generate with AI'} onCopied=${markCopied} />` : null}
          <${Action} disabled=${busy} onClick=${() => { setDraft(markdown || ''); setEditing(false); }}>${t('common.cancel') || 'Cancel'}<//>
          <${Action} kind="primary" disabled=${busy} onClick=${save}>${busy ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save')}<//>
        <//>
      <//>
      ${preview
        ? html`<${Surface} kind="box"><${Markdown} text=${draft} /><//>`
        : html`<${Field} type="textarea" rows=${14} value=${draft} placeholder=${t('readme.placeholder') || '# Title\n\nDescribe what this is about. Mermaid diagrams are allowed.'} onInput=${e => setDraft(e.target.value)} />`}
      ${copied ? html`<${Text} kind="caption" tone="muted">${t('readme.pasteBack') || 'Prompt copied — run it in your AI chat, then paste the Markdown result here.'}<//>` : null}
    <//>`;
  }

  if (!markdown) {
    if (!canEdit) return null;   // nothing to show and can't add → render nothing
    return html`<${Stack} align="start">
      <${Text} tone="muted">${t('readme.emptyHint') || 'No description yet. Add a README so people (and agents) know what this is about.'}<//>
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${() => { setDraft(''); setEditing(true); }}>${t('readme.write') || 'Write'}<//>
        ${aiPromptSeed !== undefined ? html`<${Action} onClick=${() => { setDraft(''); setEditing(true); setTimeout(openEditorAndCopy, 0); }}>${t('readme.generateAi') || 'Generate with AI'}<//>` : null}
      <//>
    <//>`;
  }

  return html`<${Stack}>
    <${Markdown} text=${markdown} />
    ${canEdit ? html`<${Stack} direction="wrap">
      <${Action} onClick=${() => { setDraft(markdown); setEditing(true); }}>${t('readme.edit') || 'Edit README'}<//>
    <//>` : null}
  <//>`;
}
