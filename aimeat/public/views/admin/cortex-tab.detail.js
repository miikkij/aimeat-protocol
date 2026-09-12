/**
 * @file cortex-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One cortex opened, on the admin Cortex extensions page.
 *
 *   THE QUESTION THIS SCREEN ANSWERS is "what did turning this on put on my site". The old screen
 *   listed component types and nothing else, so the one piece that outlives the extension was
 *   invisible: seed data is written into somebody's memory on activation and stays there through
 *   both a deactivation and a deletion. It is a row of its own here, and the box under it says so.
 *
 *   WHO LOADS IT comes from the LISTING, not from this read: the detail route carries components,
 *   versions and activation artifacts but no dependants, so the row the operator opened is handed
 *   in beside the detail rather than fetched twice.
 * @structure CortexDetail (default export) · pieceName() · pieceDetail()
 * @usage <${CortexDetail} ext=${detail} row=${row} onBack=${...} ... />
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, dt, Badge } from './shared.js';
import { isSiteOwn } from './cortex-tab.groups.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.cortex.' + key, params);

/** The manifest's word for a piece, and the key under which the page keeps a person's word for it. */
const KIND_WORD = {
    'schema': 'schema',
    'prompt': 'prompt',
    'action': 'action',
    'board-template': 'board',
    'ontology': 'ontology',
    'seed-data': 'seed',
    'lib': 'lib',
};

const code = (s) => html`<span class="adm-cx-code">${String(s)}</span>`;

/** The one line under a piece's name: what that kind of piece actually is on this site. */
function pieceDetail(comp, artifacts) {
    switch (comp.type) {
        case 'schema':
            return comp.key_pattern
                ? html`${C('piece.schemaWhy')} ${code(comp.key_pattern)}`
                : C('piece.schemaPlain');
        case 'prompt':
            return C('piece.promptWhy');
        case 'action':
            return C('piece.actionWhy');
        case 'board-template':
            return C('piece.boardWhy');
        case 'ontology':
            return C('piece.ontologyWhy');
        case 'seed-data': {
            const keys = artifacts?.seedDataKeys ?? [];
            if (keys.length === 0) return C('piece.seedNone');
            return html`${C('piece.seedWhy')} ${keys.slice(0, 6).map((k, i) => html`${i > 0 ? ' ' : ''}${code(k)}`)}`;
        }
        case 'lib': {
            const ex = Array.isArray(comp.exports) ? comp.exports : [];
            return ex.length > 0
                ? html`${C('piece.libWhy')} ${ex.map((e, i) => html`${i > 0 ? ' ' : ''}${code(e)}`)}`
                : C('piece.libPlain');
        }
        default:
            return C('piece.otherWhy');
    }
}

/** The name shown for a piece: the manifest's own, or the file it is served as. */
function pieceName(comp) {
    if (comp.name) return comp.name;
    if (comp.filename) return comp.filename;
    return C('kind.' + (KIND_WORD[comp.type] ?? 'other'));
}

export default function CortexDetail({ ext, row, busy, onBack, onTurnOff, onTurnOn, onVisibility, onRemove }) {
    const on = ext.status === 'active';
    const site = isSiteOwn(ext);
    const apps = row?.used_by?.apps ?? 0;
    const names = row?.used_by?.app_names ?? [];
    const comps = Array.isArray(ext.components) ? ext.components : [];
    const versions = Array.isArray(ext.versions) ? ext.versions : [];

    let counter = 0;
    const n = () => String(++counter).padStart(2, '0');

    return html`
    <div class="adm-cx">
      <button type="button" class="og-door og-door--quiet" onClick=${onBack}>${C('detail.back')}</button>

      <div class="adm-cx-head">
        <h2>${ext.name}</h2>
        <span class="adm-cx-ver">${ext.version || '?'}</span>
        <${Badge} type=${on ? 'success' : 'warning'} label=${on ? C('state.on') : C('state.off')} />
        ${site && html`<${Badge} type="muted" label=${C('thisSite')} />`}
        <${Badge} type=${ext.visibility === 'public' ? 'public' : 'muted'}
          label=${ext.visibility === 'public' ? C('read.public') : C('read.private')} />
      </div>
      ${ext.description && html`<p class="adm-cx-desc">${ext.description}</p>`}
      <p class="adm-cx-meta">${C('detail.meta', {
        when: dt(ext.installed_at),
        who: site ? C('thisSite') : (ext.installed_by || '?'),
        space: ext.namespace || '?',
      })}</p>

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${C('detail.who')}<small>${n()}</small></h2></div>
        ${apps > 0
          ? html`
            <p class="adm-cx-big">${apps === 1 ? C('detail.loadedByOne') : C('detail.loadedBy', { n: num(apps) })}</p>
            <p class="adm-cx-applist">${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}
              ${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}</p>`
          : html`
            <p class="adm-cx-big">${C('detail.nobody')}</p>
            <p class="adm-cx-lead" style="margin-top: 8px">${site ? C('detail.nobodySite') : C('detail.nobodyWhy')}</p>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${C('detail.put')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-cx-note">${C('detail.pieceCount', { n: num(comps.length) })}</span></div></div>
        ${comps.length === 0
          ? html`<p class="adm-cx-note">${C('detail.noPieces')}</p>`
          : comps.map((c, i) => html`
            <div class=${'adm-cx-piece' + (i === comps.length - 1 ? ' adm-cx-piece--last' : '')}>
              <span class="adm-cx-kind">${C('kind.' + (KIND_WORD[c.type] ?? 'other'))}</span>
              <span><b>${pieceName(c)}</b>
                <span class="adm-why">${pieceDetail(c, ext.activation_artifacts)}</span></span>
            </div>`)}
        <div class="og-box" style="margin-top: 18px">
          <span class="og-box-label">${C('detail.keepsLabel')}</span>
          ${C('detail.keeps')}
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${C('detail.versions')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-cx-note">${C('detail.versionCount', { n: num(versions.length) })}</span></div></div>
        ${versions.length === 0
          ? html`<p class="adm-cx-note">${C('detail.noVersions')}</p>`
          : versions.map((v, i) => html`
            <div class=${'adm-cx-vrow' + (i === versions.length - 1 ? ' adm-cx-vrow--last' : '')}>
              <span style="font-weight: 700">${v.version}</span>
              <span>${v.version === ext.version ? C('detail.thisOne') : C('detail.olderOne')}</span>
              <span class="adm-mval">${dt(v.created_at)}</span>
            </div>`)}
        <p class="adm-cx-lead" style="margin-top: 12px">${C('detail.versionsWhy')}</p>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${C('detail.can')}<small>${n()}</small></h2></div>
        <div class="adm-cx-doers">
          ${on
            ? html`<button type="button" class="og-slab" disabled=${busy} onClick=${onTurnOff}>${C('turnOff')}</button>`
            : html`<button type="button" class="og-slab" disabled=${busy} onClick=${onTurnOn}>${C('turnOn')}</button>`}
          <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${onVisibility}>
            ${ext.visibility === 'public' ? C('detail.makePrivate') : C('detail.makePublic')}
          </button>
          <button type="button" class="og-door og-door--quiet og-door--danger" disabled=${busy} onClick=${onRemove}>
            ${C('removeForGood')}
          </button>
        </div>
        <p class="adm-cx-lead" style="margin-top: 14px">${C('detail.canWhy')}</p>
      </section>
    </div>`;
}
