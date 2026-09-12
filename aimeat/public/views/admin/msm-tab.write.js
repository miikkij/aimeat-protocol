/**
 * @file msm-tab.write.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The screen for writing a new machine service manifest.
 *
 *   THE TEN READY-MADE ONES COME FIRST. They ship with the software, every one of them complete
 *   (auth, actions, what each takes and gives back, a health block), and not one has ever been used
 *   on aimeat.io. They were behind a dropdown inside an empty YAML box, which is a hard place to
 *   find something you do not know exists. Here they are the first thing on the screen and the box
 *   is under them.
 *
 *   AND THE SCREEN SAYS WHAT SAVING DOES. The shape is checked and the service is not: nothing
 *   calls the address, nothing looks for the key, nothing runs the health block. A manifest for a
 *   service switched off last year saves exactly as cleanly as one for a service that works.
 * @structure MsmWrite (default export)
 * @usage <${MsmWrite} templates=${...} yaml=${...} onSave=${...} ... />
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, ErrorBox } from './shared.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

export default function MsmWrite({ templates, picked, yaml, federate, busy, err, onPick, onYaml, onFederate, onSave, onCancel }) {
    const list = Array.isArray(templates) ? templates : [];
    const half = Math.ceil(list.length / 2);
    const columns = [list.slice(0, half), list.slice(half)];

    const tpl = (ft, last) => html`
      <div class=${'adm-msm-tpl' + (last ? ' adm-msm-tpl--last' : '')} key=${ft.type}>
        <span><b>${ft.name}</b><span class="adm-why">${ft.description}</span></span>
        <span><button type="button" class="og-door og-door--quiet" disabled=${busy}
          onClick=${() => onPick(ft.type)}>${M('write.start')}</button></span>
      </div>`;

    const step = (i, key, last) => html`
      <div class=${'adm-msm-step' + (last ? ' adm-msm-step--last' : '')}>
        <span class="adm-msm-stepn">${String(i).padStart(2, '0')}</span>
        <span><b>${M('write.' + key)}</b><span class="adm-why">${M('write.' + key + 'Why')}</span></span>
      </div>`;

    return html`
    <div class="adm-msm">
      <button type="button" class="og-door og-door--quiet" onClick=${onCancel}>${M('detail.back')}</button>

      <div class="adm-msm-head">
        <h2>${M('write.title')}</h2>
      </div>
      <p class="adm-msm-intro" style="margin-top: 12px">${M('write.lead')}</p>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('write.startFrom')}<small>01</small></h2>
          <div class="og-doors"><span class="adm-msm-note">${M('write.templateCount', { n: num(list.length) })}</span></div></div>
        ${list.length === 0
          ? html`<p class="adm-msm-note">${M('write.noTemplates')}</p>`
          : html`
            <p class="adm-msm-lead">${M('write.startFromWhy')}</p>
            <div class="adm-msm-tpls">
              ${columns.map(col => html`<div>${col.map((ft, i) => tpl(ft, i === col.length - 1))}</div>`)}
            </div>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('write.theManifest')}<small>02</small></h2>
          ${picked && html`<div class="og-doors"><span class="adm-msm-note">${M('write.from', { name: picked })}</span></div>`}</div>
        <label class="adm-msm-field" style="margin-top: 0">
          <span>${M('write.yamlLabel')}</span>
          <textarea class="adm-msm-yaml" rows="20" placeholder=${M('write.yamlPlaceholder')}
            value=${yaml} onInput=${ev => onYaml(ev.target.value)}></textarea>
        </label>
        <label class="adm-msm-pick">
          <input type="checkbox" checked=${federate} onChange=${ev => onFederate(ev.target.checked)} />
          <span>${M('write.federate')}</span>
        </label>
        ${err && html`<div style="margin-top: 12px"><${ErrorBox} message=${err} /></div>`}
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('write.whenYouSave')}<small>03</small></h2></div>
        ${step(1, 'shapeChecked')}
        ${step(2, 'serviceNot')}
        ${step(3, 'goesPublic', true)}
        <div class="adm-msm-dialog-acts" style="margin-top: 20px">
          <button type="button" class="og-slab" disabled=${busy || !yaml.trim()} onClick=${onSave}>
            ${busy ? M('write.saving') : M('write.save')}
          </button>
          <button type="button" class="og-door og-door--quiet" onClick=${onCancel}>${t('common.cancel')}</button>
        </div>
      </section>
    </div>`;
}
