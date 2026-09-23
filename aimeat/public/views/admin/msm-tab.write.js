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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the ready-made ones and
 *     the three steps as list rows, the manifest and the federate choice as shared fields.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 — 2026-09-13 — Compose shared B1 headings; keep existing layout in the view sheet.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, ErrorBox } from './shared.js';
import { Section, Columns, Stack, ListRow, Field, Action, Text } from '/components/poster-parts.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

export default function MsmWrite({ templates, picked, yaml, federate, busy, err, onPick, onYaml, onFederate, onSave, onCancel }) {
    const list = Array.isArray(templates) ? templates : [];
    const half = Math.ceil(list.length / 2);
    const columns = [list.slice(0, half), list.slice(half)];

    const tpl = (ft) => html`<${ListRow} key=${ft.type} name=${ft.name} detail=${ft.description} detailKind="text"
      actions=${html`<${Action} disabled=${busy} onClick=${() => onPick(ft.type)}>${M('write.start')}<//>`} />`;

    const step = (i, key) => html`<${ListRow} number=${String(i).padStart(2, '0')}
      name=${M('write.' + key)} detail=${M('write.' + key + 'Why')} detailKind="text" />`;

    return html`<${Stack}>
      <${Stack} direction="horizontal"><${Action} onClick=${onCancel}>${M('detail.back')}<//><//>

      <${Stack} density="compact">
        <${Text} kind="heading">${M('write.title')}<//>
        <${Text} kind="lead">${M('write.lead')}<//>
      <//>

      <${Section} title=${M('write.startFrom')} count="01" description=${list.length ? M('write.startFromWhy') : null}
        actions=${html`<${Text} kind="caption" tone="muted">${M('write.templateCount', { n: num(list.length) })}<//>`}>
        ${list.length === 0
          ? html`<${Text} kind="caption" tone="muted">${M('write.noTemplates')}<//>`
          : html`<${Columns} collapse=${900}>
              ${columns.map((col, i) => html`<div key=${i}>${col.map(tpl)}</div>`)}
            <//>`}
      <//>

      <${Section} title=${M('write.theManifest')} count="02"
        actions=${picked ? html`<${Text} kind="caption" tone="muted">${M('write.from', { name: picked })}<//>` : null}>
        <${Stack}>
          <${Field} type="textarea" rows=${20} label=${M('write.yamlLabel')} placeholder=${M('write.yamlPlaceholder')}
            value=${yaml} spellCheck=${false} onInput=${ev => onYaml(ev.target.value)} />
          <${Field} type="checkbox" label=${M('write.federate')} value=${federate}
            onChange=${ev => onFederate(ev.target.checked)} />
          ${err && html`<${ErrorBox} message=${err} />`}
        <//>
      <//>

      <${Section} title=${M('write.whenYouSave')} count="03">
        <${Stack}>
          <div>
            ${step(1, 'shapeChecked')}
            ${step(2, 'serviceNot')}
            ${step(3, 'goesPublic')}
          </div>
          <${Stack} direction="wrap" align="center">
            <${Action} kind="primary" disabled=${busy || !yaml.trim()} onClick=${onSave}>
              ${busy ? M('write.saving') : M('write.save')}<//>
            <${Action} kind="text" onClick=${onCancel}>${t('common.cancel')}<//>
          <//>
        <//>
      <//>
    <//>`;
}
