/**
 * @file msm-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One machine service manifest opened, on the admin MSM page.
 *   Drawn only from library components: the page passes data and writes no class.
 *
 *   THE ACTIONS ARE THE MANIFEST. The old screen printed the whole definition as raw JSON in a
 *   scroll box, so the one thing a person wants to know, what an AI can ask this service to do and
 *   what it has to hand over, was in there somewhere. Each action is a block here: the verb, the
 *   name, what it takes and what it gives back, with the required fields marked.
 *
 *   TWO LINES NOTHING SAID BEFORE. The key is the NAME of an environment variable on the machine
 *   this site runs on, never a value kept here, so a complete manifest can be completely unusable.
 *   And nothing on this site calls the address, checks the key or runs the health block a manifest
 *   is allowed to declare: it is a claim about somebody else's service, made on the day it was
 *   written.
 * @structure MsmDetail (default export) · fieldRows() · ActionBlock
 * @usage <${MsmDetail} msm=${detail} row=${row} onBack=${...} ... />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the head PageHead with the badges as its marks
 *     and the meta line a mono meta Note, the key rows Facts (codes as Code, the homepage a link
 *     Action), each action under the heavy rule (Split heavy) with its verb a coral Mark and its id
 *     a Code, what it takes and gives two dense Lists in Columns, the description field a
 *     TextField, the doors Loud and Action, the edit note a SettingBox.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose shared B1 headings and preserve spacing through view classes.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h, Fragment } from 'preact';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { num, dt, Badge } from './shared.js';
import { hostsOf } from './msm-tab.groups.js';
import { Section } from '/components/Section.js';
import { PageHead } from '/components/PageHead.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Mark, Code, Label } from '/components/Mark.js';
import { List, Row, Name, Cell } from '/components/List.js';
import { SubHeading } from '/components/SubHeading.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { SettingBox } from '/components/Box.js';
import { Row as Line, Stack, Split, Space, Columns } from '/components/Layout.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

/** The address anybody can read this manifest at, which is the same one an agent is given. */
export function publicPath(name) {
    return `/v1/msm/${encodeURIComponent(name)}`;
}

/** One side of an action: the fields it takes, or the fields it gives back. */
function fieldRows(fields) {
    const entries = fields && typeof fields === 'object' ? Object.entries(fields) : [];
    if (entries.length === 0) return html`<${Note} kind="quiet">${M('detail.noFields')}<//>`;
    return html`
      <${List} cols="name-what" keepCols dense>
        ${entries.map(([name, def]) => html`
          <${Row} key=${name}>
            <${Name} code tag=${def?.required ? html`<${Mark} tone="coral">${M('detail.required')}<//>` : null}>${name}<//>
            <${Cell} meta>${typeof def === 'string' ? def : (def?.type || '?')}<//>
          <//>`)}
      <//>`;
}

/** One action: the verb, the name and id, what it does, and what it takes and gives back. */
function ActionBlock({ a }) {
    return html`
      <${Split} heavy>
        <${Stack}>
          <${Line} wrap align="baseline" justify="between">
            <${Line} wrap align="baseline">
              <${Mark} tone="coral">${(a.endpoint?.method || 'GET').toUpperCase()}<//>
              <${SubHeading} inline>${a.displayName || a.id}<//>
            <//>
            <${Code}>${a.id}<//>
          <//>
          ${a.description && html`<${Note}>${a.description}<//>`}
          <${Columns}>
            <${Stack} gap="tight"><${Label} block>${M('detail.takes')}<//>${fieldRows(a.input)}<//>
            <${Stack} gap="tight"><${Label} block>${M('detail.gives')}<//>${fieldRows(a.output)}<//>
          <//>
        <//>
      <//>`;
}

export default function MsmDetail({ msm, row, busy, editing, draft, onBack, onEditOpen, onEditChange, onEditSave, onEditCancel, onFederate, onDelete }) {
    const def = msm.definition || {};
    const service = def.service || {};
    const auth = def.auth || {};
    const actions = Array.isArray(def.actions) ? def.actions : [];
    const hosts = hostsOf(row).length > 0 ? hostsOf(row) : [];
    const tags = Array.isArray(service.tags) ? service.tags : [];
    const keyVar = auth.envVar || auth.envVarSecret || '';

    let counter = 0;
    const n = () => String(++counter).padStart(2, '0');

    return html`
    <${Fragment}>
      <${Actions}><${Action} small soft onClick=${onBack}>${M('detail.back')}<//><//>

      <${PageHead} title=${msm.name} desc=${service.description || null} marks=${[
        auth.type && auth.type !== 'none'
          ? html`<${Badge} type="watch" label=${M('auth.' + auth.type)} />`
          : html`<${Badge} type="muted" label=${M('auth.none')} />`,
        html`<${Badge} type="public" label=${M('detail.publicBadge')} />`,
        msm.federate ? html`<${Badge} type="info" label=${M('detail.federatedBadge')} />` : null,
      ]} />
      <${Space} below="section">
        <${Note} kind="meta" mono>${M('detail.meta', {
          when: dt(msm.registered_at),
          who: msm.registered_by || '?',
          // The category is a word from a closed set, so it is said in the reader's language. tOr and
          // not t, because t answers a miss with the key itself, and a new category would then print
          // as "admin.msm.category.whatever" instead of as the word the manifest stored.
          category: msm.category ? tOr('admin.msm.category.' + msm.category, msm.category) : '?',
          version: def.version || '?',
        })}${msm.updated_at && msm.updated_at !== msm.registered_at
          ? ` ${M('detail.editedAt', { when: dt(msm.updated_at) })}`
          : ` ${M('detail.neverEdited')}`}<//>
      <//>

      <${Section} first num=${n()} title=${M('detail.describes')}>
        <${Facts} rows=${[
          { k: M('detail.calls'), v: hosts.length > 0 ? hosts.map((x, i) => html`${i > 0 ? ' · ' : ''}<${Code}>${x}<//>`) : M('detail.noHost') },
          service.homepage && { k: M('detail.homepage'), v: html`<${Action} tone="link" href=${service.homepage} newTab noReferrer>${service.homepage}<//>` },
          tags.length > 0 && { k: M('detail.tags'), v: tags.join(' · '), mono: true },
          { k: M('detail.actionsK'), v: num(actions.length) },
        ]} />
      <//>

      <${Section} num=${n()} title=${M('detail.canAsk')}>
        ${actions.length === 0
          ? html`<${Note} kind="quiet">${M('detail.noActions')}<//>`
          : actions.map((a) => html`<${ActionBlock} key=${a.id} a=${a} />`)}
      <//>

      <${Section} num=${n()} title=${M('detail.before')}>
        <${Facts} rows=${[
          keyVar
            ? { k: M('detail.theKey'), v: html`${M('detail.keyIn')} <${Code}>${keyVar}<//>`, sub: M('detail.keyWhy') }
            : { k: M('detail.theKey'), v: M('detail.keyNone'), sub: M('detail.keyNoneWhy') },
          { k: M('detail.theCheck'), v: def.health ? M('detail.healthDeclared') : M('detail.healthNone'), sub: M('detail.checkWhy') },
        ]} />
      <//>

      <${Section} num=${n()} title=${M('detail.whoSees')}>
        <${Facts} rows=${[
          { k: M('detail.readableBy'), v: html`${M('detail.readableAll')} <${Code}>${publicPath(msm.name)}<//>`, sub: M('detail.readableWhy') },
          { k: M('detail.federation'), v: msm.federate ? M('detail.federateOn') : M('detail.federateOff') },
        ]} />

        <${Space} above="large">
          ${editing
            ? html`
              <${TextField} label=${M('detail.descriptionLabel')} value=${draft} onInput=${onEditChange} />
              <${Actions}>
                <${Loud} control disabled=${busy} onClick=${onEditSave}>${M('detail.saveDescription')}<//>
                <${Action} small soft onClick=${onEditCancel}>${t('common.cancel')}<//>
              <//>`
            : html`
              <${Actions}>
                <${Loud} control disabled=${busy} onClick=${onEditOpen}>${M('detail.editDescription')}<//>
                <${Action} small soft disabled=${busy} onClick=${onFederate}>
                  ${msm.federate ? M('detail.stopFederating') : M('detail.startFederating')}
                <//>
                <${Action} small soft tone="danger" disabled=${busy} onClick=${onDelete}>${M('deleteIt')}<//>
              <//>`}
        <//>

        <${Space} above="large">
          <${SettingBox} label=${M('detail.editLabel')}>${M('detail.editWhat')}<//>
        <//>
      <//>
    <//>`;
}
