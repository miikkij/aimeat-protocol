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
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { num, dt, Badge } from './shared.js';
import { hostsOf } from './msm-tab.groups.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

/** The address anybody can read this manifest at, which is the same one an agent is given. */
export function publicPath(name) {
    return `/v1/msm/${encodeURIComponent(name)}`;
}

/** One side of an action: the fields it takes, or the fields it gives back. */
function fieldRows(fields) {
    const entries = fields && typeof fields === 'object' ? Object.entries(fields) : [];
    if (entries.length === 0) return html`<p class="adm-msm-note">${M('detail.noFields')}</p>`;
    return entries.map(([name, def], i) => html`
      <div class=${'adm-msm-f' + (i === entries.length - 1 ? ' adm-msm-f--last' : '')} key=${name}>
        <span><em>${name}</em>${def?.required ? html` <span class="adm-msm-req">${M('detail.required')}</span>` : ''}</span>
        <span class="adm-msm-type">${typeof def === 'string' ? def : (def?.type || '?')}</span>
      </div>`);
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
    <div class="adm-msm">
      <button type="button" class="og-door og-door--quiet" onClick=${onBack}>${M('detail.back')}</button>

      <div class="adm-msm-head">
        <h2>${msm.name}</h2>
        ${auth.type && auth.type !== 'none'
          ? html`<${Badge} type="watch" label=${M('auth.' + auth.type)} />`
          : html`<${Badge} type="muted" label=${M('auth.none')} />`}
        <${Badge} type="public" label=${M('detail.publicBadge')} />
        ${msm.federate && html`<${Badge} type="info" label=${M('detail.federatedBadge')} />`}
      </div>
      ${service.description && html`<p class="adm-msm-desc">${service.description}</p>`}
      <p class="adm-msm-meta">${M('detail.meta', {
        when: dt(msm.registered_at),
        who: msm.registered_by || '?',
        // The category is a word from a closed set, so it is said in the reader's language. tOr and
        // not t, because t answers a miss with the key itself, and a new category would then print
        // as "admin.msm.category.whatever" instead of as the word the manifest stored.
        category: msm.category ? tOr('admin.msm.category.' + msm.category, msm.category) : '?',
        version: def.version || '?',
      })}${msm.updated_at && msm.updated_at !== msm.registered_at
        ? html` ${M('detail.editedAt', { when: dt(msm.updated_at) })}`
        : html` ${M('detail.neverEdited')}`}</p>

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${M('detail.describes')}<small>${n()}</small></h2></div>
        <div class="adm-msm-krow">
          <span class="adm-msm-k">${M('detail.calls')}</span>
          <span>${hosts.length > 0
            ? hosts.map((x, i) => html`${i > 0 ? ' · ' : ''}<span class="adm-msm-code">${x}</span>`)
            : M('detail.noHost')}</span>
        </div>
        ${service.homepage && html`
          <div class="adm-msm-krow">
            <span class="adm-msm-k">${M('detail.homepage')}</span>
            <span><a href=${service.homepage} target="_blank" rel="noopener noreferrer">${service.homepage}</a></span>
          </div>`}
        ${tags.length > 0 && html`
          <div class="adm-msm-krow">
            <span class="adm-msm-k">${M('detail.tags')}</span>
            <span class="adm-msm-sub" style="margin-top: 0">${tags.join(' · ')}</span>
          </div>`}
        <div class="adm-msm-krow adm-msm-krow--last">
          <span class="adm-msm-k">${M('detail.actionsK')}</span>
          <span>${num(actions.length)}</span>
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('detail.canAsk')}<small>${n()}</small></h2></div>
        ${actions.length === 0
          ? html`<p class="adm-msm-note">${M('detail.noActions')}</p>`
          : actions.map(a => html`
            <div class="adm-msm-act" key=${a.id}>
              <div class="adm-msm-acth">
                <span class="adm-msm-verb">${(a.endpoint?.method || 'GET').toUpperCase()}</span>
                <b>${a.displayName || a.id}</b>
                <span class="adm-msm-actid">${a.id}</span>
              </div>
              ${a.description && html`<span class="adm-why">${a.description}</span>`}
              <div class="adm-msm-fields">
                <div>
                  <p class="adm-msm-flab">${M('detail.takes')}</p>
                  ${fieldRows(a.input)}
                </div>
                <div>
                  <p class="adm-msm-flab">${M('detail.gives')}</p>
                  ${fieldRows(a.output)}
                </div>
              </div>
            </div>`)}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('detail.before')}<small>${n()}</small></h2></div>
        <div class="adm-msm-krow">
          <span class="adm-msm-k">${M('detail.theKey')}</span>
          <span>${keyVar
            ? html`${M('detail.keyIn')} <span class="adm-msm-code">${keyVar}</span>
                <span class="adm-why">${M('detail.keyWhy')}</span>`
            : html`${M('detail.keyNone')}<span class="adm-why">${M('detail.keyNoneWhy')}</span>`}</span>
        </div>
        <div class="adm-msm-krow adm-msm-krow--last">
          <span class="adm-msm-k">${M('detail.theCheck')}</span>
          <span>${def.health ? M('detail.healthDeclared') : M('detail.healthNone')}
            <span class="adm-why">${M('detail.checkWhy')}</span></span>
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('detail.whoSees')}<small>${n()}</small></h2></div>
        <div class="adm-msm-krow">
          <span class="adm-msm-k">${M('detail.readableBy')}</span>
          <span>${M('detail.readableAll')} <span class="adm-msm-code">${publicPath(msm.name)}</span>
            <span class="adm-why">${M('detail.readableWhy')}</span></span>
        </div>
        <div class="adm-msm-krow adm-msm-krow--last">
          <span class="adm-msm-k">${M('detail.federation')}</span>
          <span>${msm.federate ? M('detail.federateOn') : M('detail.federateOff')}</span>
        </div>

        ${editing
          ? html`
            <label class="adm-msm-field">
              <span>${M('detail.descriptionLabel')}</span>
              <input class="adm-input" type="text" value=${draft}
                onInput=${ev => onEditChange(ev.target.value)} />
            </label>
            <div class="adm-msm-dialog-acts">
              <button type="button" class="adm-btn" disabled=${busy} onClick=${onEditSave}>${M('detail.saveDescription')}</button>
              <button type="button" class="og-door og-door--quiet" onClick=${onEditCancel}>${t('common.cancel')}</button>
            </div>`
          : html`
            <div class="adm-msm-doers">
              <button type="button" class="og-slab" disabled=${busy} onClick=${onEditOpen}>${M('detail.editDescription')}</button>
              <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${onFederate}>
                ${msm.federate ? M('detail.stopFederating') : M('detail.startFederating')}
              </button>
              <button type="button" class="og-door og-door--quiet og-door--danger" disabled=${busy} onClick=${onDelete}>
                ${M('deleteIt')}
              </button>
            </div>`}

        <div class="og-box" style="margin-top: 14px">
          <span class="og-box-label">${M('detail.editLabel')}</span>
          ${M('detail.editWhat')}
        </div>
      </section>
    </div>`;
}
