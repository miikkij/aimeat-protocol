/**
 * @file public/views/admin/prompts-tab.editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The right pane of the System Prompts page: one prompt, what it is, who is handed it,
 *   what is filled into it, the text in English and in the languages this site serves, and the four
 *   things you can do to it (design canvas "AIMEAT Admin System Prompts", direction A).
 *
 *   TAKING THE CURRENT VERSION IS THE EVERYDAY BUTTON. The software keeps improving these texts,
 *   and for a prompt that is the operator's own it is the only way a newer one gets into use. It is
 *   the first action here, in the ordinary underline, and not a red one at the end of the row.
 *
 *   WHAT AN UPDATE DOES TO THIS PROMPT IS A FACT ON SCREEN. Half the catalogue is rewritten from
 *   source on every boot; an operator editing one of those needs to know before they type, not
 *   after the deploy.
 * @structure PromptEditor
 * @usage html`<${PromptEditor} prompt=${p} versions=${v} onSave=${fn} ... />`
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dt, num, Spinner } from './shared.js';
import { promptChips } from './prompts-tab.list.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.prompts.' + key, params);

/** The languages this site serves besides English, in the order the language switch shows them. */
const LANGUAGES = [
  { tag: 'fi', key: 'lang.fi' },
  { tag: 'es', key: 'lang.es' },
];

/** What an update does to this one, as a sentence rather than a word. */
function updateLine(kind) {
  return P('kind.' + kind);
}

export function PromptEditor({
  prompt, draft, versions, saving, loading,
  onDraft, onLocale, onSave, onTakeCurrent, onToggleActive, onVersions, onRestore,
}) {
  if (loading) return html`<div class="adm-pr-editor"><${Spinner} text=${t('dashboard.loading')} /></div>`;
  if (!prompt) return html`<div class="adm-pr-editor"><p class="adm-pr-empty">${P('pickOne')}</p></div>`;

  const orphan = prompt.source_kind === 'orphan';

  return html`
    <div class="adm-pr-editor">
      <div class="adm-pr-head">
        <span class="adm-pr-title">${prompt.name}</span>
        <span class="adm-pr-desc">${prompt.description}</span>
        <div class="adm-pr-headrow">
          <span class="adm-pr-chips">${promptChips(prompt)}</span>
          <span class="og-doors">
            ${!orphan && html`
              <button type="button" class="og-door og-door--quiet" disabled=${saving}
                onClick=${onTakeCurrent}>${P('takeOne')}</button>`}
            <button type="button" class="og-door og-door--quiet" disabled=${saving}
              onClick=${onToggleActive}>${prompt.active ? P('switchOff') : P('switchOn')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${onVersions}>${P('versions')}</button>
          </span>
        </div>
      </div>

      <div class="adm-pr-facts">
        <span class="k">${P('fact.handedAt')}</span>
        <span class="adm-pr-mono">${(prompt.usedIn || []).join(' · ') || prompt.id}</span>
        <span class="k">${P('fact.filledWith')}</span>
        <span class="adm-pr-mono">${(prompt.variables || []).join(' · ') || P('fact.noVariables')}</span>
        <span class="k">${P('fact.onUpdate')}</span>
        <span>${updateLine(prompt.source_kind)}</span>
        <span class="k">${P('fact.lastChange')}</span>
        <span>${P('fact.lastChangeValue', { when: dt(prompt.updatedAt), who: prompt.updatedBy || '-', v: num(prompt.version) })}</span>
      </div>

      <div class="adm-pr-body">
        <label class="adm-pr-label" for="adm-pr-en">${P('textLabel')}</label>
        <textarea id="adm-pr-en" class="adm-pr-text" rows="16" value=${draft.content}
          onInput=${(e) => onDraft('content', e.target.value)}></textarea>
        <p class="adm-pr-hint">${P('textHint')}</p>

        ${LANGUAGES.map(l => html`
          <div class="adm-pr-lang" key=${l.tag}>
            <label class="adm-pr-label" for=${'adm-pr-' + l.tag}>${P('langLabel', { language: P(l.key) })}</label>
            <textarea id=${'adm-pr-' + l.tag} class="adm-pr-text" rows="6"
              placeholder=${P('langPh', { language: P(l.key) })}
              value=${(draft.locales && draft.locales[l.tag]) || ''}
              onInput=${(e) => onLocale(l.tag, e.target.value)}></textarea>
          </div>`)}
        <p class="adm-pr-hint">${P('langHint')}</p>

        <div class="adm-pr-foot">
          <button type="button" class="adm-btn" disabled=${saving} onClick=${onSave}>
            ${saving ? P('saving') : P('save')}
          </button>
          <label class="adm-pr-notefield">
            <input type="text" value=${draft.changeNote || ''} placeholder=${P('notePh')}
              onInput=${(e) => onDraft('changeNote', e.target.value)} />
          </label>
        </div>

        ${versions !== null && html`
          <div class="adm-pr-versions">
            <p class="adm-pr-note">${P('versionsLead')}</p>
            ${versions.length === 0
              ? html`<p class="adm-pr-note">${P('versionsNone')}</p>`
              : versions.map(v => html`
                <div class="adm-pr-vrow" key=${v.version}>
                  <span><b>v${num(v.version)}</b> ${v.changeNote ? html`<span class="adm-pr-note">${v.changeNote}</span>` : ''}</span>
                  <span class="adm-pr-vwhen">${dt(v.changedAt)} · ${v.changedBy}</span>
                  <button type="button" class="og-door og-door--quiet" disabled=${saving}
                    onClick=${() => onRestore(v.version)}>${P('restore')}</button>
                </div>`)}
          </div>`}
      </div>
    </div>`;
}
