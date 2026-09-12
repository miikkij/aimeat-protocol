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
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge } from './shared.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/** Section 03: three things can decide what a visitor gets, and only the first that exists is used. */
export function WhichVersion({ hasCustom, source, parts, number }) {
  const step = (n, key, value, last) => html`
    <div class=${'adm-pt-step' + (last ? ' adm-pt-step--last' : '')}>
      <span class="adm-pt-stepn">${n}</span>
      <span><b>${P('rank.' + key)}</b><span class="adm-why">${P('rank.' + key + 'Why')}</span></span>
      <span class="adm-mval">${value}</span>
    </div>`;
  return html`
    <section class="og-sec" id="adm-pt-rank">
      <div class="og-sec-h"><h2>${P('rank.title')}<small>${number}</small></h2></div>
      <p class="adm-pt-lead">${P('rank.lead')}</p>
      ${step(1, 'html', hasCustom ? P('rank.inUse') : P('rank.htmlNone'))}
      ${step(2, 'layout', source === 'stored' ? (hasCustom ? P('rank.notUsed') : P('rank.inUse')) : P('rank.layoutNone'))}
      ${step(3, 'default', source === 'stored' || hasCustom ? P('rank.notUsed') : P('rank.inUse'), true)}
      <p class="adm-pt-note">${P('rank.parts', { n: parts })}</p>
    </section>`;
}

/** Section 04: the menu above the page, which is saved on its own. */
export function MenuLinks({ links, labels, saving, onToggle, onMove, onSave, number }) {
  return html`
    <section class="og-sec" id="adm-pt-menu">
      <div class="og-sec-h"><h2>${P('menu.title')}<small>${number}</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" disabled=${saving || !links} onClick=${onSave}>${P('menu.save')}</button>
        </div></div>
      <p class="adm-pt-lead">${P('menu.lead')}</p>
      ${links === null
        ? html`<p class="adm-pt-empty">${t('dashboard.loading')}</p>`
        : links.map((l, idx) => html`
          <div class=${'adm-mrow' + (idx === links.length - 1 ? ' adm-mrow--last' : '')} key=${l.id}>
            <span>
              <b>${t(labels[l.id]) || l.id}</b>
              <span class="adm-why">${P('menu.' + l.id + 'Why')}</span>
            </span>
            <span>
              <button type="button" class="og-door og-door--quiet" onClick=${() => onToggle(l.id)}>
                ${l.visible ? P('menu.shown') : P('menu.hidden')}
              </button>
            </span>
            <span class="adm-mval">
              <span class="adm-pt-move" style="display:inline-flex;flex-direction:row;gap:8px;vertical-align:middle">
                <button type="button" disabled=${idx === 0} onClick=${() => onMove(idx, -1)} title=${P('parts.moveUp')}
                  aria-label=${P('parts.moveUp')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg></button>
                <button type="button" disabled=${idx === links.length - 1} onClick=${() => onMove(idx, 1)} title=${P('parts.moveDown')}
                  aria-label=${P('parts.moveDown')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button>
              </span>
            </span>
          </div>`)}
    </section>`;
}

/**
 * Section 05: the operator's own HTML page. The warning comes BEFORE the editor, because the
 * decision it warns about is made by pressing Save in the editor.
 */
export function OwnHtml({ hasCustom, updatedAt, template, onTemplate, onSave, onLoadCurrent, onDownload, onDelete, number }) {
  const [open, setOpen] = useState(hasCustom);
  return html`
    <section class="og-sec" id="adm-pt-html">
      <div class="og-sec-h"><h2>${P('html.title')}<small>${number}</small></h2>
        <div class="og-doors">
          ${!open && html`<button type="button" class="og-door og-door--quiet" onClick=${() => setOpen(true)}>${P('html.write')}</button>`}
          <button type="button" class="og-door og-door--quiet" onClick=${() => { setOpen(true); onLoadCurrent(); }}>${P('html.loadCurrent')}</button>
        </div></div>
      <div class="adm-mrow adm-mrow--last">
        <span><b>${P('html.state')}</b><span class="adm-why">${hasCustom ? P('html.stateYours') : P('html.stateNone')}</span></span>
        <span>${hasCustom
          ? html`<${Badge} type="healthy" label=${P('html.badgeYours')} />`
          : html`<${Badge} type="muted" label=${P('html.badgeNone')} />`}</span>
        <span class="adm-mval">${hasCustom && updatedAt ? dt(updatedAt) : '__site_template__'}</span>
      </div>
      <div class="og-box" style="margin-top: 14px">
        <span class="og-box-label">${P('html.warnLabel')}</span>
        ${P('html.warn')}
      </div>
      ${open && html`
        <div style="margin-top: 14px">
          <textarea class="adm-pt-textarea" rows="18" value=${template}
            placeholder=${P('html.editorPh')}
            onInput=${(e) => onTemplate(e.target.value)}></textarea>
          <div class="og-doors" style="margin-top: 12px">
            <button type="button" class="adm-btn" onClick=${onSave}>${P('html.save')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${onDownload}>${P('html.download')}</button>
            ${hasCustom && html`<button type="button" class="og-door og-door--quiet og-door--danger" onClick=${onDelete}>${P('html.delete')}</button>`}
          </div>
        </div>`}
    </section>`;
}

/** Section 06: the texts the parts and any HTML page can show, and the names they are written as. */
export function SavedTexts({ memKeys, kv, newKey, newVal, onKey, onVal, onAdd, onDelete, number }) {
  const kvKeys = Object.keys(kv ?? {});
  const tagRow = (tag, what, last) => html`
    <div class=${'adm-pt-krow' + (last ? ' adm-pt-krow--last' : '')}>
      <span class="adm-pt-tag">${tag}</span><span class="adm-pt-kv">${what}</span>
    </div>`;
  return html`
    <section class="og-sec" id="adm-pt-texts">
      <div class="og-sec-h"><h2>${P('texts.title')}<small>${number}</small></h2></div>
      <div class="adm-pt-two">
        <div>
          <p class="adm-pt-lead">${P('texts.lead')}</p>
          ${memKeys === null && html`<p class="adm-pt-empty">${t('dashboard.loading')}</p>`}
          ${memKeys !== null && memKeys.length === 0 && html`<p class="adm-pt-empty">${P('texts.none')}</p>`}
          ${(memKeys ?? []).map((k, i) => html`
            <div class=${'adm-pt-krow' + (i === memKeys.length - 1 && kvKeys.length === 0 ? ' adm-pt-krow--last' : '')} key=${k.key}>
              <span class="adm-pt-kk">${escHtml(k.key)}</span>
              <span class="adm-pt-kv">${escHtml(String(k.value ?? ''))}</span>
              <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${() => onDelete(k.key)}>${P('texts.delete')}</button>
            </div>`)}
          ${kvKeys.map((k, i) => html`
            <div class=${'adm-pt-krow' + (i === kvKeys.length - 1 ? ' adm-pt-krow--last' : '')} key=${k}>
              <span class="adm-pt-kk">${escHtml(k)}</span>
              <span class="adm-pt-kv">${escHtml(String(kv[k]))}</span>
              <span class="adm-pt-note">${P('texts.fromSettings')}</span>
            </div>`)}
          <div class="adm-pt-add">
            <label class="adm-fld"><span>${P('texts.keyLabel')}</span>
              <input class="adm-input" value=${newKey} placeholder="portal/welcome" onInput=${(e) => onKey(e.target.value)} /></label>
            <label class="adm-fld adm-fld--wide"><span>${P('texts.valueLabel')}</span>
              <input class="adm-input" value=${newVal} placeholder=${P('texts.valuePh')} onInput=${(e) => onVal(e.target.value)} /></label>
            <button type="button" class="og-door og-door--quiet" onClick=${onAdd}>${P('texts.add')}</button>
          </div>
          <p class="adm-pt-note" style="margin-top: 8px">${P('texts.saveNote')}</p>
        </div>
        <div>
          <p class="adm-pt-lead">${P('texts.tagsLead')}</p>
          ${tagRow('{{memory:portal/welcome}}', P('texts.tagMemory'))}
          ${tagRow('{{kv:site_name}}', P('texts.tagKv'))}
          ${tagRow('{{config:node_id}}', P('texts.tagConfig'))}
          ${tagRow('{{storage:type}}', P('texts.tagStorage'))}
          ${tagRow('{{board:general}}', P('texts.tagBoard'), true)}
        </div>
      </div>
    </section>`;
}

/** Section 07: the road in for an operator whose AI cannot reach this node. */
export function AskAi({ paste, onPaste, onCopyLayout, onCopySite, onApply, busy, number }) {
  return html`
    <section class="og-sec" id="adm-pt-ai">
      <div class="og-sec-h"><h2>${P('ai.title')}<small>${number}</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onCopyLayout}>${P('ai.copyLayout')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${onCopySite}>${P('ai.copySite')}</button>
        </div></div>
      <p class="adm-pt-lead">${P('ai.lead')}</p>
      <textarea class="adm-pt-textarea" rows="6" value=${paste}
        placeholder=${P('ai.pastePh')} onInput=${(e) => onPaste(e.target.value)}></textarea>
      <div class="og-doors" style="margin-top: 12px">
        <button type="button" class="og-door og-door--quiet" disabled=${busy || !paste.trim()} onClick=${onApply}>${P('ai.apply')}</button>
        <span class="adm-pt-note">${P('ai.applyNote')}</span>
      </div>
    </section>`;
}

/** Section 08: what changed, and who changed it. */
export function WhatChanged({ changes, versions, onVersions, onRestore, number }) {
  return html`
    <section class="og-sec" id="adm-pt-log">
      <div class="og-sec-h"><h2>${P('log.title')}<small>${number}</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onVersions}>${P('log.versions')}</button>
        </div></div>
      ${changes.length === 0
        ? html`<p class="adm-pt-empty">${P('log.none')}</p>`
        : changes.slice(0, 12).map((c, i) => html`
          <div class=${'adm-mrow' + (i === Math.min(changes.length, 12) - 1 ? ' adm-mrow--last' : '')} key=${c.id ?? i}>
            <span>
              <b>${P('log.action.' + (c.action ?? 'other')) !== 'admin.portal.log.action.' + (c.action ?? 'other')
                ? P('log.action.' + (c.action ?? 'other')) : (c.action ?? '')}</b>
              <span class="adm-why">${escHtml(c.description ?? c.detail ?? '')}</span>
            </span>
            <span><${Badge} type="info" label=${c.action ?? ''} /></span>
            <span class="adm-mval">${dt(c.changed_at ?? c.changedAt)} · ${escHtml(c.changed_by ?? c.changedBy ?? '-')}</span>
          </div>`)}
      ${versions !== null && html`
        <div style="margin-top: 14px">
          <p class="adm-pt-lead">${P('log.versionsLead')}</p>
          ${versions.length === 0
            ? html`<p class="adm-pt-empty">${P('log.versionsNone')}</p>`
            : versions.map((v, i) => html`
              <div class=${'adm-pt-krow' + (i === versions.length - 1 ? ' adm-pt-krow--last' : '')} key=${v.version}>
                <span class="adm-pt-kk">${dt(v.recorded_at)}</span>
                <span class="adm-pt-kv">${escHtml(v.changed_by ?? '')}</span>
                <button type="button" class="og-door og-door--quiet" onClick=${() => onRestore(v.version)}>${P('log.restore')}</button>
              </div>`)}
        </div>`}
    </section>`;
}
