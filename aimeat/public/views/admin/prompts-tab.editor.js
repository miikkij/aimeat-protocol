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
 *   v2.0.0 — 2026-09-27 — Library components only: the head is SubHeading, Marks and Actions, the
 *     facts are Facts, the texts TextArea with their labels and hints, the foot Loud with the note's
 *     TextField, the versions a List; no class written.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dt, num, Spinner } from './shared.js';
import { promptChips } from './prompts-tab.list.js';
import { SubHeading } from '/components/SubHeading.js';
import { Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Facts } from '/components/Facts.js';
import { TextField, TextArea } from '/components/TextField.js';
import { EmptyState } from '/components/EmptyState.js';
import { List, Row as ListRow, Name, Desc, Doors } from '/components/List.js';
import { Row, Stack, Split } from '/components/Layout.js';

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
  if (loading) return html`<${Spinner} text=${t('dashboard.loading')} />`;
  if (!prompt) return html`<${EmptyState} text=${P('pickOne')} />`;

  const orphan = prompt.source_kind === 'orphan';

  return html`
    <${Stack} gap="large">
      <${Stack} gap="small">
        <${SubHeading} level=${3}>${prompt.name}<//>
        <${Note}>${prompt.description}<//>
        <${Row} wrap justify="between">
          <${Marks}>${promptChips(prompt)}<//>
          <${Actions}>
            ${!orphan && html`
              <${Action} small soft disabled=${saving} onClick=${onTakeCurrent}>${P('takeOne')}<//>`}
            <${Action} small soft disabled=${saving} onClick=${onToggleActive}>${prompt.active ? P('switchOff') : P('switchOn')}<//>
            <${Action} small soft onClick=${onVersions}>${P('versions')}<//>
          <//>
        <//>
      <//>

      <${Facts} rows=${[
    { key: 'at', k: P('fact.handedAt'), v: (prompt.usedIn || []).join(' · ') || prompt.id, mono: true },
    { key: 'with', k: P('fact.filledWith'), v: (prompt.variables || []).join(' · ') || P('fact.noVariables'), mono: true },
    { key: 'update', k: P('fact.onUpdate'), v: updateLine(prompt.source_kind) },
    { key: 'last', k: P('fact.lastChange'), v: P('fact.lastChangeValue', { when: dt(prompt.updatedAt), who: prompt.updatedBy || '-', v: num(prompt.version) }) },
  ]} />

      <${Stack} gap="medium">
        <${TextArea} id="adm-pr-en" code rows=${16} label=${P('textLabel')} hint=${P('textHint')}
          value=${draft.content} onInput=${(v) => onDraft('content', v)} />

        ${LANGUAGES.map(l => html`
          <${TextArea} key=${l.tag} id=${'adm-pr-' + l.tag} code rows=${6}
            label=${P('langLabel', { language: P(l.key) })}
            placeholder=${P('langPh', { language: P(l.key) })}
            value=${(draft.locales && draft.locales[l.tag]) || ''}
            onInput=${(v) => onLocale(l.tag, v)} />`)}
        <${Note}>${P('langHint')}<//>
      <//>

      <${Split}>
        <${Row} wrap gap="large">
          <${Loud} control disabled=${saving} onClick=${onSave}>${saving ? P('saving') : P('save')}<//>
          <${TextField} value=${draft.changeNote || ''} placeholder=${P('notePh')} ariaLabel=${P('notePh')}
            onInput=${(v) => onDraft('changeNote', v)} />
        <//>
      <//>

      ${versions !== null && html`
        <${Split} gap="small">
          <${Note}>${P('versionsLead')}<//>
          ${versions.length === 0
    ? html`<${Note}>${P('versionsNone')}<//>`
    : html`
            <${List} cols="name-desc-doors" dense>
              ${versions.map(v => html`
                <${ListRow} key=${v.version}>
                  <${Name} meta=${v.changeNote || undefined}>v${num(v.version)}<//>
                  <${Desc}>${dt(v.changedAt)} · ${v.changedBy}<//>
                  <${Doors}><${Action} small soft disabled=${saving} onClick=${() => onRestore(v.version)}>${P('restore')}<//><//>
                <//>`)}
            <//>`}
        <//>`}
    <//>`;
}
