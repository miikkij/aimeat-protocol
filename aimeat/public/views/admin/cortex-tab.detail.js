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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, pieces and versions as
 *     list rows, chips, the aside and the actions. Its own classes are gone with the page's sheet.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose shared B1 headings and stylesheet-owned spacing.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, dt, Badge } from './shared.js';
import { isSiteOwn } from './cortex-tab.groups.js';
import { Section, Stack, ListRow, Chip, Action, Surface, Text } from '/components/poster-parts.js';

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

const code = (s) => html`<${Text} kind="mono">${String(s)}<//>`;

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

    return html`<${Stack}>
      <${Stack} direction="horizontal"><${Action} onClick=${onBack}>${C('detail.back')}<//><//>

      <${Stack} density="compact">
        <${Stack} direction="wrap" align="center" density="compact">
          <${Text} kind="heading">${ext.name}<//>
          <${Chip}>${ext.version || '?'}<//>
          <${Badge} type=${on ? 'success' : 'warning'} label=${on ? C('state.on') : C('state.off')} />
          ${site && html`<${Badge} type="muted" label=${C('thisSite')} />`}
          <${Badge} type=${ext.visibility === 'public' ? 'public' : 'muted'}
            label=${ext.visibility === 'public' ? C('read.public') : C('read.private')} />
        <//>
        ${ext.description && html`<${Text} kind="lead">${ext.description}<//>`}
        <${Text} kind="mono" tone="muted">${C('detail.meta', {
          when: dt(ext.installed_at),
          who: site ? C('thisSite') : (ext.installed_by || '?'),
          space: ext.namespace || '?',
        })}<//>
      <//>

      <${Section} title=${C('detail.who')} count=${n()}>
        <${Stack} density="compact">
          ${apps > 0
            ? html`
              <${Text} kind="heading" size="small">${apps === 1 ? C('detail.loadedByOne') : C('detail.loadedBy', { n: num(apps) })}<//>
              <${Text} kind="mono">${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}
                ${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}<//>`
            : html`
              <${Text} kind="heading" size="small">${C('detail.nobody')}<//>
              <${Text}>${site ? C('detail.nobodySite') : C('detail.nobodyWhy')}<//>`}
        <//>
      <//>

      <${Section} title=${C('detail.put')} count=${n()}
        actions=${html`<${Text} kind="caption" tone="muted">${C('detail.pieceCount', { n: num(comps.length) })}<//>`}>
        <${Stack}>
          ${comps.length === 0
            ? html`<${Text} kind="caption" tone="muted">${C('detail.noPieces')}<//>`
            : html`<div>${comps.map((c, i) => html`<${ListRow} key=${i}
                mark=${html`<${Chip}>${C('kind.' + (KIND_WORD[c.type] ?? 'other'))}<//>`}
                name=${pieceName(c)} detail=${pieceDetail(c, ext.activation_artifacts)} detailKind="text" />`)}</div>`}
          <${Surface} kind="aside"><${Stack} density="compact">
            <${Text} kind="label">${C('detail.keepsLabel')}<//>
            <${Text}>${C('detail.keeps')}<//>
          <//><//>
        <//>
      <//>

      <${Section} title=${C('detail.versions')} count=${n()}
        actions=${html`<${Text} kind="caption" tone="muted">${C('detail.versionCount', { n: num(versions.length) })}<//>`}>
        <${Stack}>
          ${versions.length === 0
            ? html`<${Text} kind="caption" tone="muted">${C('detail.noVersions')}<//>`
            : html`<div>${versions.map((v) => html`<${ListRow} key=${v.version} density="compact"
                name=${v.version} detail=${v.version === ext.version ? C('detail.thisOne') : C('detail.olderOne')} detailKind="text"
                value=${html`<${Text} kind="mono">${dt(v.created_at)}<//>`} />`)}</div>`}
          <${Text} kind="caption" tone="muted">${C('detail.versionsWhy')}<//>
        <//>
      <//>

      <${Section} title=${C('detail.can')} count=${n()}>
        <${Stack}>
          <${Stack} direction="wrap" align="center">
            ${on
              ? html`<${Action} kind="primary" disabled=${busy} onClick=${onTurnOff}>${C('turnOff')}<//>`
              : html`<${Action} kind="primary" disabled=${busy} onClick=${onTurnOn}>${C('turnOn')}<//>`}
            <${Action} disabled=${busy} onClick=${onVisibility}>
              ${ext.visibility === 'public' ? C('detail.makePrivate') : C('detail.makePublic')}<//>
            <${Action} tone="danger" disabled=${busy} onClick=${onRemove}>${C('removeForGood')}<//>
          <//>
          <${Text} kind="caption" tone="muted">${C('detail.canWhy')}<//>
        <//>
      <//>
    <//>`;
}
