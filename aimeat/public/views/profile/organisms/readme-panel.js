/**
 * @file readme-panel.js
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
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
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

  const copyPrompt = async () => {
    const prompt = buildAiPrompt(kind, name, aiPromptSeed);
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { /* clipboard may be blocked; the user can still type the README */ }
  };

  if (editing) {
    return html`
      <div class="pj-readme pj-readme-edit card-detail">
        <div class="pj-readme-bar">
          <strong>${t('readme.editTitle') || 'Edit README'}</strong>
          <div class="pj-readme-actions">
            <button class="btn-ghost" onClick=${() => setPreview(p => !p)}>${preview ? (t('readme.write') || 'Write') : (t('readme.preview') || 'Preview')}</button>
            ${aiPromptSeed !== undefined ? html`<button class="btn-ghost" onClick=${copyPrompt}>${copied ? (t('readme.copied') || 'Copied!') : (t('readme.generateAi') || 'Generate with AI')}</button>` : null}
            <button class="btn-outline" disabled=${busy} onClick=${() => { setDraft(markdown || ''); setEditing(false); }}>${t('common.cancel') || 'Cancel'}</button>
            <button class="btn-primary" disabled=${busy} onClick=${save}>${busy ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save')}</button>
          </div>
        </div>
        ${preview
          ? html`<div class="pj-readme-body"><${Markdown} text=${draft} /></div>`
          : html`<textarea class="input-field pj-readme-textarea" rows="14" value=${draft} placeholder=${t('readme.placeholder') || '# Title\n\nDescribe what this is about. Mermaid diagrams are allowed.'} onInput=${e => setDraft(e.target.value)}></textarea>`}
        ${copied ? html`<div class="section-desc">${t('readme.pasteBack') || 'Prompt copied — run it in your AI chat, then paste the Markdown result here.'}</div>` : null}
      </div>`;
  }

  if (!markdown) {
    if (!canEdit) return null;   // nothing to show and can't add → render nothing
    return html`
      <div class="pj-readme pj-readme-empty card-detail">
        <div class="section-desc">${t('readme.emptyHint') || 'No description yet. Add a README so people (and agents) know what this is about.'}</div>
        <div class="pj-readme-actions">
          <button class="btn-outline" onClick=${() => { setDraft(''); setEditing(true); }}>${t('readme.write') || 'Write'}</button>
          ${aiPromptSeed !== undefined ? html`<button class="btn-ghost" onClick=${() => { setDraft(''); setEditing(true); setTimeout(copyPrompt, 0); }}>${t('readme.generateAi') || 'Generate with AI'}</button>` : null}
        </div>
      </div>`;
  }

  return html`
    <div class="pj-readme card-detail">
      <div class="pj-readme-body"><${Markdown} text=${markdown} /></div>
      ${canEdit ? html`
        <div class="pj-readme-actions">
          <button class="btn-ghost" onClick=${() => { setDraft(markdown); setEditing(true); }}>${t('readme.edit') || 'Edit README'}</button>
        </div>` : null}
    </div>`;
}
