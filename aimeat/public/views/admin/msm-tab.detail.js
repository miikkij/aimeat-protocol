/**
 * @file msm-tab.detail.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One machine service manifest opened, on the admin MSM page.
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
 * @structure MsmDetail (default export) · fieldRows()
 * @usage <${MsmDetail} msm=${detail} row=${row} onBack=${...} ... />
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, facts as key-value rows,
 *     each action a list row with its fields in two columns, the shared field and actions.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose shared B1 headings and preserve spacing through view classes.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { num, dt, Badge } from './shared.js';
import { hostsOf } from './msm-tab.groups.js';
import { Section, Columns, Stack, ListRow, KeyValue, Field, Chip, Action, Surface, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

/** The address anybody can read this manifest at, which is the same one an agent is given. */
export function publicPath(name) {
    return `/v1/msm/${encodeURIComponent(name)}`;
}

/** One side of an action: the fields it takes, or the fields it gives back. */
function fieldRows(fields) {
    const entries = fields && typeof fields === 'object' ? Object.entries(fields) : [];
    if (entries.length === 0) return html`<${Text} kind="caption" tone="muted">${M('detail.noFields')}<//>`;
    return html`<div>${entries.map(([name, def]) => html`<${ListRow} key=${name} density="compact" name=${name}
      detail=${def?.required ? M('detail.required') : null}
      value=${html`<${Text} kind="mono" tone="muted">${typeof def === 'string' ? def : (def?.type || '?')}<//>`} />`)}</div>`;
}

/** One fact: the label, the value, and a quiet line under it. */
const fact = (label, value, note) => html`<${KeyValue} label=${label}><${Stack} density="compact">
  <span>${value}</span>${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}<//><//>`;
const code = (x) => html`<${Text} kind="mono">${x}<//>`;

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

    return html`<${Stack}>
      <${Stack} direction="horizontal"><${Action} onClick=${onBack}>${M('detail.back')}<//><//>

      <${Stack} density="compact">
        <${Stack} direction="wrap" align="center" density="compact">
          <${Text} kind="heading">${msm.name}<//>
          ${auth.type && auth.type !== 'none'
            ? html`<${Badge} type="watch" label=${M('auth.' + auth.type)} />`
            : html`<${Badge} type="muted" label=${M('auth.none')} />`}
          <${Badge} type="public" label=${M('detail.publicBadge')} />
          ${msm.federate && html`<${Badge} type="info" label=${M('detail.federatedBadge')} />`}
        <//>
        ${service.description && html`<${Text} kind="lead">${service.description}<//>`}
        <${Text} kind="mono" tone="muted">${M('detail.meta', {
          when: dt(msm.registered_at),
          who: msm.registered_by || '?',
          // The category is a word from a closed set, so it is said in the reader's language. tOr and
          // not t, because t answers a miss with the key itself, and a new category would then print
          // as "admin.msm.category.whatever" instead of as the word the manifest stored.
          category: msm.category ? tOr('admin.msm.category.' + msm.category, msm.category) : '?',
          version: def.version || '?',
        })}${msm.updated_at && msm.updated_at !== msm.registered_at
          ? html` ${M('detail.editedAt', { when: dt(msm.updated_at) })}`
          : html` ${M('detail.neverEdited')}`}<//>
      <//>

      <${Section} title=${M('detail.describes')} count=${n()}>
        <div>
          ${fact(M('detail.calls'), hosts.length > 0
            ? hosts.map((x, i) => html`${i > 0 ? ' · ' : ''}${code(x)}`)
            : M('detail.noHost'))}
          ${service.homepage && fact(M('detail.homepage'),
            html`<${Action} kind="text" href=${service.homepage} target="_blank">${service.homepage}<//>`)}
          ${tags.length > 0 && fact(M('detail.tags'), tags.join(' · '))}
          ${fact(M('detail.actionsK'), num(actions.length))}
        </div>
      <//>

      <${Section} title=${M('detail.canAsk')} count=${n()}>
        ${actions.length === 0
          ? html`<${Text} kind="caption" tone="muted">${M('detail.noActions')}<//>`
          : html`<div>${actions.map(a => html`<${ListRow} key=${a.id}
              mark=${html`<${Chip}>${(a.endpoint?.method || 'GET').toUpperCase()}<//>`}
              name=${a.displayName || a.id} detail=${a.id}>
              <${Stack}>
                ${a.description && html`<${Text} kind="caption" tone="muted">${a.description}<//>`}
                <${Columns} collapse=${640}>
                  <${Stack} density="compact"><${Text} kind="label">${M('detail.takes')}<//>${fieldRows(a.input)}<//>
                  <${Stack} density="compact"><${Text} kind="label">${M('detail.gives')}<//>${fieldRows(a.output)}<//>
                <//>
              <//>
            <//>`)}</div>`}
      <//>

      <${Section} title=${M('detail.before')} count=${n()}>
        <div>
          ${keyVar
            ? fact(M('detail.theKey'), html`${M('detail.keyIn')} ${code(keyVar)}`, M('detail.keyWhy'))
            : fact(M('detail.theKey'), M('detail.keyNone'), M('detail.keyNoneWhy'))}
          ${fact(M('detail.theCheck'), def.health ? M('detail.healthDeclared') : M('detail.healthNone'), M('detail.checkWhy'))}
        </div>
      <//>

      <${Section} title=${M('detail.whoSees')} count=${n()}>
        <${Stack}>
          <div>
            ${fact(M('detail.readableBy'), html`${M('detail.readableAll')} ${code(publicPath(msm.name))}`, M('detail.readableWhy'))}
            ${fact(M('detail.federation'), msm.federate ? M('detail.federateOn') : M('detail.federateOff'))}
          </div>

          ${editing
            ? html`<${Stack}>
              <${Field} label=${M('detail.descriptionLabel')} value=${draft} autoFocus=${true}
                onInput=${ev => onEditChange(ev.target.value)} />
              <${Stack} direction="wrap" align="center">
                <${Action} kind="primary" disabled=${busy} onClick=${onEditSave}>${M('detail.saveDescription')}<//>
                <${Action} kind="text" onClick=${onEditCancel}>${t('common.cancel')}<//>
              <//>
            <//>`
            : html`<${Stack} direction="wrap" align="center">
              <${Action} kind="primary" disabled=${busy} onClick=${onEditOpen}>${M('detail.editDescription')}<//>
              <${Action} disabled=${busy} onClick=${onFederate}>
                ${msm.federate ? M('detail.stopFederating') : M('detail.startFederating')}<//>
              <${Action} tone="danger" disabled=${busy} onClick=${onDelete}>${M('deleteIt')}<//>
            <//>`}

          <${Surface} kind="aside"><${Stack} density="compact">
            <${Text} kind="label">${M('detail.editLabel')}<//>
            <${Text}>${M('detail.editWhat')}<//>
          <//><//>
        <//>
      <//>
    <//>`;
}
