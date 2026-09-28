/**
 * @file public/views/admin/portal-tab.sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 03 to 08 of the Portal page (design canvas "AIMEAT Admin Portal"): which
 *   version a visitor gets, the links in the top menu, the operator's own HTML page with the
 *   warning that has never been on screen, the saved texts and what a template may name, the paste
 *   for an operator whose AI cannot reach this node, and what changed.
 *
 *   THE LADDER IS THE POINT OF THIS FILE. Saving an HTML page quietly stops every arranged part
 *   from being shown, and nothing in this product has ever said so. Section 03 says it in three
 *   rows, and section 05 says it again in the box above the editor, because that is where the
 *   decision is actually made.
 *
 *   Every part is a library component; the page passes data and writes no class.
 * @structure WhichVersion · MenuLinks · OwnHtml · SavedTexts · AskAi · WhatChanged
 * @usage html`<${WhichVersion} hasCustom=${false} source="default" parts=${9} />`
 * @version-history
 *   2026-09-28 — What changed shows an entry's `summary`, the field the change log carries.
 *   v2.0.1 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a saved text's key or value, a change description or an editor name with a quote
 *     or an ampersand showed as &quot; / &amp;.
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): Section, the List (cuts
 *     n-name-doors, name-desc-doors, tag-name) for the ladder, the texts, the template names and
 *     the versions, Readings for the menu and the change log, MoveButtons for the menu's arrows,
 *     SettingBox for the warning, TextField and TextArea for the fields, Loud and Action for the
 *     buttons, Columns for the two halves of the texts.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose shared poster headings and external section spacing.
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dt, Badge } from './shared.js';
import { Section } from '/components/Section.js';
import { Readings, Reading } from '/components/Readings.js';
import { List, Row, Name, Desc, Num, Cell, When, Doors } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { MoveButtons } from '/components/MoveButtons.js';
import { Columns, Space } from '/components/Layout.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/** Section 03: three things can decide what a visitor gets, and only the first that exists is used. */
export function WhichVersion({ hasCustom, source, parts, number }) {
  const step = (n, key, value) => html`
    <${Row} key=${key}>
      <${Num}><${Figure} small step n=${n} /><//>
      <${Name} desc=${P('rank.' + key + 'Why')}>${P('rank.' + key)}<//>
      <${Doors}><${Note} kind="meta" mono inline>${value}<//><//>
    <//>`;
  return html`
    <${Section} id="adm-pt-rank" num=${number} title=${P('rank.title')}>
      <${Note} kind="lead">${P('rank.lead')}<//>
      <${List} cols="n-name-doors">
        ${step(1, 'html', hasCustom ? P('rank.inUse') : P('rank.htmlNone'))}
        ${step(2, 'layout', source === 'stored' ? (hasCustom ? P('rank.notUsed') : P('rank.inUse')) : P('rank.layoutNone'))}
        ${step(3, 'default', source === 'stored' || hasCustom ? P('rank.notUsed') : P('rank.inUse'))}
      <//>
      <${Note} kind="hint">${P('rank.parts', { n: parts })}<//>
    <//>`;
}

/** Section 04: the menu above the page, which is saved on its own. */
export function MenuLinks({ links, labels, saving, onToggle, onMove, onSave, number }) {
  return html`
    <${Section} id="adm-pt-menu" num=${number} title=${P('menu.title')}
      doors=${html`<${Action} small soft disabled=${saving || !links} onClick=${onSave}>${P('menu.save')}<//>`}>
      <${Note} kind="lead">${P('menu.lead')}<//>
      ${links === null
        ? html`<${Note} kind="quiet">${t('dashboard.loading')}<//>`
        : html`<${Readings} rows=${links.map((l, idx) => ({
          key: l.id,
          name: t(labels[l.id]) || l.id,
          why: P('menu.' + l.id + 'Why'),
          mark: html`<${Action} small soft onClick=${() => onToggle(l.id)}>${l.visible ? P('menu.shown') : P('menu.hidden')}<//>`,
          end: html`<${MoveButtons} across first=${idx === 0} last=${idx === links.length - 1}
            onUp=${() => onMove(idx, -1)} onDown=${() => onMove(idx, 1)} upLabel=${P('parts.moveUp')} downLabel=${P('parts.moveDown')} />`,
          last: idx === links.length - 1,
        }))} />`}
    <//>`;
}

/**
 * Section 05: the operator's own HTML page. The warning comes BEFORE the editor, because the
 * decision it warns about is made by pressing Save in the editor.
 */
export function OwnHtml({ hasCustom, updatedAt, template, onTemplate, onSave, onLoadCurrent, onDownload, onDelete, number }) {
  const [open, setOpen] = useState(hasCustom);
  return html`
    <${Section} id="adm-pt-html" num=${number} title=${P('html.title')}
      doors=${html`
        ${!open && html`<${Action} small soft onClick=${() => setOpen(true)}>${P('html.write')}<//>`}
        <${Action} small soft onClick=${() => { setOpen(true); onLoadCurrent(); }}>${P('html.loadCurrent')}<//>`}>
      <${Reading} last name=${P('html.state')} why=${hasCustom ? P('html.stateYours') : P('html.stateNone')}
        mark=${hasCustom
          ? html`<${Badge} type="healthy" label=${P('html.badgeYours')} />`
          : html`<${Badge} type="muted" label=${P('html.badgeNone')} />`}
        value=${hasCustom && updatedAt ? dt(updatedAt) : '__site_template__'} />
      <${SettingBox} label=${P('html.warnLabel')}>${P('html.warn')}<//>
      ${open && html`
        <${Space} above="large">
          <${TextArea} code rows=${18} value=${template} placeholder=${P('html.editorPh')} ariaLabel=${P('html.title')}
            onInput=${(v) => onTemplate(v)} />
          <${Space} above="medium">
            <${Actions}>
              <${Loud} control onClick=${onSave}>${P('html.save')}<//>
              <${Action} small soft onClick=${onDownload}>${P('html.download')}<//>
              ${hasCustom && html`<${Action} small soft tone="danger" onClick=${onDelete}>${P('html.delete')}<//>`}
            <//>
          <//>
        <//>`}
    <//>`;
}

/** Section 06: the texts the parts and any HTML page can show, and the names they are written as. */
export function SavedTexts({ memKeys, kv, newKey, newVal, onKey, onVal, onAdd, onDelete, number }) {
  const kvKeys = Object.keys(kv ?? {});
  const tagRow = (tag, what) => html`
    <${Row} key=${tag}>
      <${Cell}><${Code}>${tag}<//><//>
      <${Desc}>${what}<//>
    <//>`;
  return html`
    <${Section} id="adm-pt-texts" num=${number} title=${P('texts.title')}>
      <${Columns}>
        <div>
          <${Note} kind="lead">${P('texts.lead')}<//>
          ${memKeys === null && html`<${Note} kind="quiet">${t('dashboard.loading')}<//>`}
          ${memKeys !== null && memKeys.length === 0 && html`<${Note} kind="quiet">${P('texts.none')}<//>`}
          <${List} cols="name-desc-doors" dense>
            ${(memKeys ?? []).map((k) => html`
              <${Row} key=${k.key}>
                <${Name} asKey>${k.key}<//>
                <${Desc} clip>${String(k.value ?? '')}<//>
                <${Doors}><${Action} small row soft tone="danger" onClick=${() => onDelete(k.key)}>${P('texts.delete')}<//><//>
              <//>`)}
            ${kvKeys.map((k) => html`
              <${Row} key=${k}>
                <${Name} asKey>${k}<//>
                <${Desc} clip>${String(kv[k])}<//>
                <${Doors}><${Note} kind="meta" inline>${P('texts.fromSettings')}<//><//>
              <//>`)}
          <//>
          <${Space} above="large">
            <${Fields} cols=${2}>
              <${TextField} label=${P('texts.keyLabel')} code value=${newKey} placeholder="portal/welcome" onInput=${(v) => onKey(v)} />
              <${TextField} label=${P('texts.valueLabel')} value=${newVal} placeholder=${P('texts.valuePh')} onInput=${(v) => onVal(v)} />
            <//>
            <${Actions}><${Action} small soft onClick=${onAdd}>${P('texts.add')}<//><//>
          <//>
          <${Note} kind="hint">${P('texts.saveNote')}<//>
        </div>
        <div>
          <${Note} kind="lead">${P('texts.tagsLead')}<//>
          <${List} cols="tag-name" dense>
            ${tagRow('{{memory:portal/welcome}}', P('texts.tagMemory'))}
            ${tagRow('{{kv:site_name}}', P('texts.tagKv'))}
            ${tagRow('{{config:node_id}}', P('texts.tagConfig'))}
            ${tagRow('{{storage:type}}', P('texts.tagStorage'))}
            ${tagRow('{{board:general}}', P('texts.tagBoard'))}
          <//>
        </div>
      <//>
    <//>`;
}

/** Section 07: the road in for an operator whose AI cannot reach this node. */
export function AskAi({ paste, onPaste, onCopyLayout, onCopySite, onApply, busy, number }) {
  return html`
    <${Section} id="adm-pt-ai" num=${number} title=${P('ai.title')}
      doors=${html`
        <${Action} small soft onClick=${onCopyLayout}>${P('ai.copyLayout')}<//>
        <${Action} small soft onClick=${onCopySite}>${P('ai.copySite')}<//>`}>
      <${Note} kind="lead">${P('ai.lead')}<//>
      <${TextArea} code rows=${6} value=${paste} placeholder=${P('ai.pastePh')} ariaLabel=${P('ai.title')}
        onInput=${(v) => onPaste(v)} />
      <${Space} above="medium">
        <${Actions}>
          <${Action} small soft disabled=${busy || !paste.trim()} onClick=${onApply}>${P('ai.apply')}<//>
          <${Note} kind="hint" inline>${P('ai.applyNote')}<//>
        <//>
      <//>
    <//>`;
}

/** Section 08: what changed, and who changed it. */
export function WhatChanged({ changes, versions, onVersions, onRestore, number }) {
  return html`
    <${Section} id="adm-pt-log" num=${number} title=${P('log.title')}
      doors=${html`<${Action} small soft onClick=${onVersions}>${P('log.versions')}<//>`}>
      ${changes.length === 0
        ? html`<${Note} kind="quiet">${P('log.none')}<//>`
        : html`<${Readings} rows=${changes.slice(0, 12).map((c, i) => ({
          key: c.id ?? i,
          name: P('log.action.' + (c.action ?? 'other')) !== 'admin.portal.log.action.' + (c.action ?? 'other')
            ? P('log.action.' + (c.action ?? 'other')) : (c.action ?? ''),
          // A change log entry carries `summary` (storage/types/apps.ts SiteChangeLogEntry).
          why: c.summary ?? c.description ?? c.detail ?? '',
          mark: html`<${Badge} type="info" label=${c.action ?? ''} />`,
          value: `${dt(c.changed_at ?? c.changedAt)} · ${c.changed_by ?? c.changedBy ?? '-'}`,
          last: i === Math.min(changes.length, 12) - 1,
        }))} />`}
      ${versions !== null && html`
        <${Space} above="large">
          <${Note} kind="lead">${P('log.versionsLead')}<//>
          <${List} cols="name-desc-doors" dense empty=${P('log.versionsNone')}>
            ${versions.map((v) => html`
              <${Row} key=${v.version}>
                <${When}>${dt(v.recorded_at)}<//>
                <${Desc}>${v.changed_by ?? ''}<//>
                <${Doors}><${Action} small row soft onClick=${() => onRestore(v.version)}>${P('log.restore')}<//><//>
              <//>`)}
          <//>
        <//>`}
    <//>`;
}
