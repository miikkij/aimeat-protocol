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
 *   v2.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     way back is the back Action, the head the PageHead (the name, its version beside it, its
 *     status marks, its words), the facts line the typewriter meta Note, the sections Section, the
 *     pieces and the versions Lists, the box SettingBox, the three moves Loud and Action. No class.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose shared B1 headings and stylesheet-owned spacing.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h, Fragment } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, dt, Badge } from './shared.js';
import { isSiteOwn } from './cortex-tab.groups.js';
import { Section } from '/components/Section.js';
import { PageHead } from '/components/PageHead.js';
import { List, Row, Name, Cell, Desc, When } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';

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

const code = (s) => html`<${Code}>${String(s)}<//>`;

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
    <${Fragment}>
      <${Action} small tone="back" onClick=${onBack}>${C('detail.back')}<//>

      <${PageHead} title=${ext.name} sub=${ext.version || '?'} desc=${ext.description || null} marks=${[
        html`<${Badge} type=${on ? 'success' : 'warning'} label=${on ? C('state.on') : C('state.off')} />`,
        site ? html`<${Badge} type="muted" label=${C('thisSite')} />` : null,
        html`<${Badge} type=${ext.visibility === 'public' ? 'public' : 'muted'}
          label=${ext.visibility === 'public' ? C('read.public') : C('read.private')} />`,
      ]} />
      <${Note} kind="meta" mono>${C('detail.meta', {
        when: dt(ext.installed_at),
        who: site ? C('thisSite') : (ext.installed_by || '?'),
        space: ext.namespace || '?',
      })}<//>

      <${Section} first num=${n()} title=${C('detail.who')}>
        ${apps > 0
          ? html`
            <${SubHeading} level=${3}>${apps === 1 ? C('detail.loadedByOne') : C('detail.loadedBy', { n: num(apps) })}<//>
            <${Note} kind="meta" mono>${names.map((a, i) => html`${i > 0 ? ' · ' : ''}${a}`)}${apps > names.length ? html` ${C('detail.andMore', { n: num(apps - names.length) })}` : ''}<//>`
          : html`
            <${SubHeading} level=${3}>${C('detail.nobody')}<//>
            <${Note} kind="lead">${site ? C('detail.nobodySite') : C('detail.nobodyWhy')}<//>`}
      <//>

      <${Section} num=${n()} title=${C('detail.put')}
        doors=${html`<${Note} kind="meta" inline>${C('detail.pieceCount', { n: num(comps.length) })}<//>`}>
        <${List} cols="tag-name" empty=${C('detail.noPieces')}>
          ${comps.map((c, i) => html`
            <${Row} key=${i}>
              <${Cell} sign>${C('kind.' + (KIND_WORD[c.type] ?? 'other'))}<//>
              <${Name} desc=${pieceDetail(c, ext.activation_artifacts)}>${pieceName(c)}<//>
            <//>`)}
        <//>
        <${SettingBox} label=${C('detail.keepsLabel')}>${C('detail.keeps')}<//>
      <//>

      <${Section} num=${n()} title=${C('detail.versions')}
        doors=${html`<${Note} kind="meta" inline>${C('detail.versionCount', { n: num(versions.length) })}<//>`}>
        <${List} cols="name-words-when" empty=${C('detail.noVersions')}>
          ${versions.map((v) => html`
            <${Row} key=${v.version}>
              <${Name}>${v.version}<//>
              <${Desc}>${v.version === ext.version ? C('detail.thisOne') : C('detail.olderOne')}<//>
              <${When}>${dt(v.created_at)}<//>
            <//>`)}
        <//>
        <${Note} kind="lead">${C('detail.versionsWhy')}<//>
      <//>

      <${Section} num=${n()} title=${C('detail.can')}>
        <${Actions}>
          ${on
            ? html`<${Loud} disabled=${busy} onClick=${onTurnOff}>${C('turnOff')}<//>`
            : html`<${Loud} disabled=${busy} onClick=${onTurnOn}>${C('turnOn')}<//>`}
          <${Action} small soft disabled=${busy} onClick=${onVisibility}>
            ${ext.visibility === 'public' ? C('detail.makePrivate') : C('detail.makePublic')}
          <//>
          <${Action} small soft tone="danger" disabled=${busy} onClick=${onRemove}>${C('removeForGood')}<//>
        <//>
        <${Note} kind="lead">${C('detail.canWhy')}<//>
      <//>
    <//>`;
}
