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
 *   v1.7.0 — 2026-09-26 — Every part is a kit component (page group G2a): the README is the Box (the editor's title and ways in its head, the Edit README way at its foot), the field the TextArea, the ways the Action (the AI prompt's copy is the Action's copy) and the Loud action, the lines the section description (HeadDesc). The page writes no class.
 *   v1.6.0 — 2026-09-26 — An organism's README and its draft are the Markdown reader's small cut (Markdown `small`), a unification: Jouni's decision "Small reader".
 *   v1.5.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.4.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.3.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v1.0.0 — 2026-06-22 — Initial: README display + editor + prompt-driven AI fill (Osa A).
 *   v1.1.0 — 2026-08-08 — The editor's "Generate with AI" is a shared <CopyButton> driving the paste-back hint via
 *       onCopied. The empty-state button opens the editor AND copies, so it stays a plain button —
 *       but copies through the shared copyToClipboard helper, not its own clipboard call.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { Box } from '/components/Box.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { TextArea } from '/components/TextField.js';
import { HeadDesc } from '/components/SubHeading.js';
import { Row } from '/components/Layout.js';

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
    return html`
      <${Box} name=${t('readme.editTitle') || 'Edit README'} end=${html`<${Actions}>
          <${Action} small onClick=${() => setPreview(p => !p)}>${preview ? (t('readme.write') || 'Write') : (t('readme.preview') || 'Preview')}<//>
          ${aiPromptSeed !== undefined ? html`<${Action} small copy=${buildAiPrompt(kind, name, aiPromptSeed)} onCopied=${markCopied}>${t('readme.generateAi') || 'Generate with AI'}<//>` : null}
          <${Action} small disabled=${busy} onClick=${() => { setDraft(markdown || ''); setEditing(false); }}>${t('common.cancel') || 'Cancel'}<//>
          <${Loud} control disabled=${busy} onClick=${save}>${busy ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save')}<//>
        <//>`}>
        ${preview
          ? html`<${Markdown} text=${draft} small />`
          : html`<${TextArea} rows=${14} value=${draft} placeholder=${t('readme.placeholder') || '# Title\n\nDescribe what this is about. Mermaid diagrams are allowed.'} onInput=${setDraft} />`}
        ${copied ? html`<${HeadDesc}>${t('readme.pasteBack') || 'Prompt copied — run it in your AI chat, then paste the Markdown result here.'}<//>` : null}
      <//>`;
  }

  if (!markdown) {
    if (!canEdit) return null;   // nothing to show and can't add → render nothing
    return html`
      <${Box}>
        <${Row} wrap justify="between" gap="medium">
          <${HeadDesc}>${t('readme.emptyHint') || 'No description yet. Add a README so people (and agents) know what this is about.'}<//>
          <${Actions}>
            <${Action} small onClick=${() => { setDraft(''); setEditing(true); }}>${t('readme.write') || 'Write'}<//>
            ${aiPromptSeed !== undefined ? html`<${Action} small onClick=${() => { setDraft(''); setEditing(true); setTimeout(openEditorAndCopy, 0); }}>${t('readme.generateAi') || 'Generate with AI'}<//>` : null}
          <//>
        <//>
      <//>`;
  }

  return html`
    <${Box} doors=${canEdit ? html`<${Action} small onClick=${() => { setDraft(markdown); setEditing(true); }}>${t('readme.edit') || 'Edit README'}<//>` : null}>
      <${Markdown} text=${markdown} small />
    <//>`;
}
