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
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared component set: the open prompt in a shared box,
 *     its facts as key-value rows, the texts as shared fields, the versions as list rows; no sheet
 *     of its own.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dt, num, Spinner } from './shared.js';
import { promptChips } from './prompts-tab.list.js';
import { Stack, Text, Action, ListRow, KeyValue, Field, Surface } from '/components/poster-parts.js';

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
  if (loading) return html`<${Surface} kind="box"><${Spinner} text=${t('dashboard.loading')} /><//>`;
  if (!prompt) return html`<${Surface} kind="box" density="roomy"><${Text} tone="muted">${P('pickOne')}<//><//>`;

  const orphan = prompt.source_kind === 'orphan';
  const chips = promptChips(prompt);

  return html`
    <${Surface} kind="box">
      <${Stack}>
        <${Stack} density="compact">
          <${Text} kind="heading" size="small">${prompt.name}<//>
          <${Text} tone="muted">${prompt.description}<//>
          <${Stack} direction="wrap" align="between">
            <${Stack} direction="wrap" density="compact">${chips}<//>
            <${Stack} direction="wrap" align="center">
              ${!orphan && html`
                <${Action} disabled=${saving} onClick=${onTakeCurrent}>${P('takeOne')}<//>`}
              <${Action} disabled=${saving} onClick=${onToggleActive}>${prompt.active ? P('switchOff') : P('switchOn')}<//>
              <${Action} onClick=${onVersions}>${P('versions')}<//>
            <//>
          <//>
        <//>

        <div>
          <${KeyValue} label=${P('fact.handedAt')} value=${html`<${Text} kind="mono">${(prompt.usedIn || []).join(' · ') || prompt.id}<//>`} />
          <${KeyValue} label=${P('fact.filledWith')} value=${html`<${Text} kind="mono">${(prompt.variables || []).join(' · ') || P('fact.noVariables')}<//>`} />
          <${KeyValue} label=${P('fact.onUpdate')} value=${updateLine(prompt.source_kind)} />
          <${KeyValue} label=${P('fact.lastChange')} value=${P('fact.lastChangeValue', { when: dt(prompt.updatedAt), who: prompt.updatedBy || '-', v: num(prompt.version) })} />
        </div>

        <${Stack} density="compact">
          <${Field} type="textarea" id="adm-pr-en" rows=${16} label=${P('textLabel')} value=${draft.content} spellCheck=${false}
            onInput=${(e) => onDraft('content', e.target.value)} />
          <${Text} kind="caption" tone="muted">${P('textHint')}<//>
        <//>

        ${LANGUAGES.map(l => html`
          <${Field} key=${l.tag} type="textarea" id=${'adm-pr-' + l.tag} rows=${6}
            label=${P('langLabel', { language: P(l.key) })}
            placeholder=${P('langPh', { language: P(l.key) })}
            value=${(draft.locales && draft.locales[l.tag]) || ''}
            onInput=${(e) => onLocale(l.tag, e.target.value)} />`)}
        <${Text} kind="caption" tone="muted">${P('langHint')}<//>

        <${Stack} direction="wrap" align="end">
          <${Action} kind="primary" disabled=${saving} onClick=${onSave}>
            ${saving ? P('saving') : P('save')}
          <//>
          <${Field} value=${draft.changeNote || ''} placeholder=${P('notePh')} ariaLabel=${P('notePh')}
            onInput=${(e) => onDraft('changeNote', e.target.value)} />
        <//>

        ${versions !== null && html`
          <${Stack} density="compact">
            <${Text} kind="caption" tone="muted">${P('versionsLead')}<//>
            ${versions.length === 0
              ? html`<${Text} kind="caption" tone="muted">${P('versionsNone')}<//>`
              : html`<div>${versions.map(v => html`<${ListRow} key=${v.version} density="compact"
                  name=${`v${num(v.version)}`} detail=${v.changeNote || null} detailKind="text"
                  value=${`${dt(v.changedAt)} · ${v.changedBy}`}
                  actions=${html`<${Action} kind="text" disabled=${saving} onClick=${() => onRestore(v.version)}>${P('restore')}<//>`} />`)}</div>`}
          <//>`}
      <//>
    <//>`;
}
