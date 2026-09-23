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
 * @structure WhichVersion · MenuLinks · OwnHtml · SavedTexts · AskAi · WhatChanged
 * @usage html`<${WhichVersion} hasCustom=${false} source="default" parts=${9} />`
 * @version-history
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared component set: sections, the ladder and the
 *     lists as shared list rows, the menu's shown state as a switch, the editors as shared fields,
 *     the warning as an aside; no sheet of its own.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose shared poster headings and external section spacing.
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, Row } from './shared.js';
import { Section, Columns, Stack, Text, Action, ListRow, Field, Surface } from '/components/poster-parts.js';
import { CHEVRON_UP, CHEVRON_DOWN } from './portal-tab.parts.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/** Section 03: three things can decide what a visitor gets, and only the first that exists is used. */
export function WhichVersion({ hasCustom, source, parts, number }) {
  const step = (n, key, value) => html`<${ListRow} number=${String(n)}
    name=${P('rank.' + key)} detail=${P('rank.' + key + 'Why')} detailKind="text" value=${value} />`;
  return html`
    <${Section} id="adm-pt-rank" title=${P('rank.title')} count=${number} description=${P('rank.lead')}>
      <div>
        ${step(1, 'html', hasCustom ? P('rank.inUse') : P('rank.htmlNone'))}
        ${step(2, 'layout', source === 'stored' ? (hasCustom ? P('rank.notUsed') : P('rank.inUse')) : P('rank.layoutNone'))}
        ${step(3, 'default', source === 'stored' || hasCustom ? P('rank.notUsed') : P('rank.inUse'))}
      </div>
      <${Text} kind="caption" tone="muted">${P('rank.parts', { n: parts })}<//>
    <//>`;
}

/** Section 04: the menu above the page, which is saved on its own. */
export function MenuLinks({ links, labels, saving, onToggle, onMove, onSave, number }) {
  return html`
    <${Section} id="adm-pt-menu" title=${P('menu.title')} count=${number} description=${P('menu.lead')}
      actions=${html`<${Action} disabled=${saving || !links} onClick=${onSave}>${P('menu.save')}<//>`}>
      ${links === null
        ? html`<${Text} tone="muted">${t('dashboard.loading')}<//>`
        : html`<div>${links.map((l, idx) => html`<${ListRow} key=${l.id}
            name=${t(labels[l.id]) || l.id} detail=${P('menu.' + l.id + 'Why')} detailKind="text"
            actions=${html`
              <${Action} kind="tab" semantics="switch" selected=${!!l.visible} onClick=${() => onToggle(l.id)}>
                ${l.visible ? P('menu.shown') : P('menu.hidden')}
              <//>
              <${Action} kind="icon" disabled=${idx === 0} onClick=${() => onMove(idx, -1)} title=${P('parts.moveUp')}
                label=${P('parts.moveUp')}>${CHEVRON_UP}<//>
              <${Action} kind="icon" disabled=${idx === links.length - 1} onClick=${() => onMove(idx, 1)} title=${P('parts.moveDown')}
                label=${P('parts.moveDown')}>${CHEVRON_DOWN}<//>`} />`)}</div>`}
    <//>`;
}

/**
 * Section 05: the operator's own HTML page. The warning comes BEFORE the editor, because the
 * decision it warns about is made by pressing Save in the editor.
 */
export function OwnHtml({ hasCustom, updatedAt, template, onTemplate, onSave, onLoadCurrent, onDownload, onDelete, number }) {
  const [open, setOpen] = useState(hasCustom);
  return html`
    <${Section} id="adm-pt-html" title=${P('html.title')} count=${number}
      actions=${html`
        ${!open && html`<${Action} onClick=${() => setOpen(true)}>${P('html.write')}<//>`}
        <${Action} onClick=${() => { setOpen(true); onLoadCurrent(); }}>${P('html.loadCurrent')}<//>`}>
      <${Stack}>
        ${Row({
    title: P('html.state'),
    why: hasCustom ? P('html.stateYours') : P('html.stateNone'),
    chip: hasCustom
      ? html`<${Badge} type="healthy" label=${P('html.badgeYours')} />`
      : html`<${Badge} type="muted" label=${P('html.badgeNone')} />`,
    value: hasCustom && updatedAt ? dt(updatedAt) : '__site_template__',
  })}
        <${Surface} kind="aside">
          <${Stack} density="compact">
            <${Text} kind="label">${P('html.warnLabel')}<//>
            <${Text}>${P('html.warn')}<//>
          <//>
        <//>
        ${open && html`
          <${Stack}>
            <${Field} type="textarea" rows=${18} value=${template} ariaLabel=${P('html.title')}
              placeholder=${P('html.editorPh')} spellCheck=${false}
              onInput=${(e) => onTemplate(e.target.value)} />
            <${Stack} direction="wrap" align="center">
              <${Action} onClick=${onSave}>${P('html.save')}<//>
              <${Action} onClick=${onDownload}>${P('html.download')}<//>
              ${hasCustom && html`<${Action} tone="danger" onClick=${onDelete}>${P('html.delete')}<//>`}
            <//>
          <//>`}
      <//>
    <//>`;
}

/** Section 06: the texts the parts and any HTML page can show, and the names they are written as. */
export function SavedTexts({ memKeys, kv, newKey, newVal, onKey, onVal, onAdd, onDelete, number }) {
  const kvKeys = Object.keys(kv ?? {});
  const tagRow = (tag, what) => html`<${ListRow} density="compact" name=${tag} detail=${what} detailKind="text" />`;
  return html`
    <${Section} id="adm-pt-texts" title=${P('texts.title')} count=${number}>
      <${Columns} layout="equal" collapse=${900} density="roomy">
        <${Stack}>
          <${Text}>${P('texts.lead')}<//>
          <div>
            ${memKeys === null && html`<${Text} tone="muted">${t('dashboard.loading')}<//>`}
            ${memKeys !== null && memKeys.length === 0 && html`<${Text} tone="muted">${P('texts.none')}<//>`}
            ${(memKeys ?? []).map((k) => html`<${ListRow} key=${k.key} density="compact"
              name=${escHtml(k.key)} detail=${escHtml(String(k.value ?? ''))}
              actions=${html`<${Action} kind="text" tone="danger" onClick=${() => onDelete(k.key)}>${P('texts.delete')}<//>`} />`)}
            ${kvKeys.map((k) => html`<${ListRow} key=${k} density="compact"
              name=${escHtml(k)} detail=${escHtml(String(kv[k]))}
              value=${html`<${Text} kind="caption" tone="muted">${P('texts.fromSettings')}<//>`} />`)}
          </div>
          <${Stack} direction="wrap" align="end">
            <${Field} label=${P('texts.keyLabel')} value=${newKey} placeholder="portal/welcome" width="narrow"
              passwordManager=${false} onInput=${(e) => onKey(e.target.value)} />
            <${Field} label=${P('texts.valueLabel')} value=${newVal} placeholder=${P('texts.valuePh')}
              passwordManager=${false} onInput=${(e) => onVal(e.target.value)} />
            <${Action} onClick=${onAdd}>${P('texts.add')}<//>
          <//>
          <${Text} kind="caption" tone="muted">${P('texts.saveNote')}<//>
        <//>
        <${Stack}>
          <${Text}>${P('texts.tagsLead')}<//>
          <div>
            ${tagRow('{{memory:portal/welcome}}', P('texts.tagMemory'))}
            ${tagRow('{{kv:site_name}}', P('texts.tagKv'))}
            ${tagRow('{{config:node_id}}', P('texts.tagConfig'))}
            ${tagRow('{{storage:type}}', P('texts.tagStorage'))}
            ${tagRow('{{board:general}}', P('texts.tagBoard'))}
          </div>
        <//>
      <//>
    <//>`;
}

/** Section 07: the road in for an operator whose AI cannot reach this node. */
export function AskAi({ paste, onPaste, onCopyLayout, onCopySite, onApply, busy, number }) {
  return html`
    <${Section} id="adm-pt-ai" title=${P('ai.title')} count=${number} description=${P('ai.lead')}
      actions=${html`
        <${Action} onClick=${onCopyLayout}>${P('ai.copyLayout')}<//>
        <${Action} onClick=${onCopySite}>${P('ai.copySite')}<//>`}>
      <${Stack}>
        <${Field} type="textarea" rows=${6} value=${paste} ariaLabel=${P('ai.title')} spellCheck=${false}
          placeholder=${P('ai.pastePh')} onInput=${(e) => onPaste(e.target.value)} />
        <${Stack} direction="wrap" align="center">
          <${Action} disabled=${busy || !paste.trim()} onClick=${onApply}>${P('ai.apply')}<//>
          <${Text} kind="caption" tone="muted">${P('ai.applyNote')}<//>
        <//>
      <//>
    <//>`;
}

/** Section 08: what changed, and who changed it. */
export function WhatChanged({ changes, versions, onVersions, onRestore, number }) {
  return html`
    <${Section} id="adm-pt-log" title=${P('log.title')} count=${number}
      actions=${html`<${Action} onClick=${onVersions}>${P('log.versions')}<//>`}>
      ${changes.length === 0
        ? html`<${Text} tone="muted">${P('log.none')}<//>`
        : html`<div>${changes.slice(0, 12).map((c, i) => html`<${Row} key=${c.id ?? i}
            title=${P('log.action.' + (c.action ?? 'other')) !== 'admin.portal.log.action.' + (c.action ?? 'other')
              ? P('log.action.' + (c.action ?? 'other')) : (c.action ?? '')}
            why=${escHtml(c.description ?? c.detail ?? '')}
            chip=${html`<${Badge} type="info" label=${c.action ?? ''} />`}
            value=${`${dt(c.changed_at ?? c.changedAt)} · ${escHtml(c.changed_by ?? c.changedBy ?? '-')}`} />`)}</div>`}
      ${versions !== null && html`
        <${Stack}>
          <${Text}>${P('log.versionsLead')}<//>
          ${versions.length === 0
            ? html`<${Text} tone="muted">${P('log.versionsNone')}<//>`
            : html`<div>${versions.map((v) => html`<${ListRow} key=${v.version} density="compact"
                name=${dt(v.recorded_at)} detail=${escHtml(v.changed_by ?? '')}
                actions=${html`<${Action} kind="text" onClick=${() => onRestore(v.version)}>${P('log.restore')}<//>`} />`)}</div>`}
        <//>`}
    <//>`;
}
