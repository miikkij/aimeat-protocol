/**
 * @file msm-tab.write.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The screen for writing a new machine service manifest, and the ready-made ones as a
 *   list (TemplateList), which the page's own section 04 shows too.
 *   Drawn only from library components: the page passes data and writes no class.
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
 * @structure MsmWrite (default export) · TemplateList
 * @usage <${MsmWrite} templates=${...} yaml=${...} onSave=${...} ... />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only: the head PageHead, the sections Section, the
 *     ready-made ones two Lists in Columns (TemplateList, shared with the page's section 04), the
 *     YAML a code TextArea, the federate choice a Check, the three steps a List with the step
 *     figure (Figure), the doors Loud and Action.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.1.0 — 2026-09-13 — Compose shared B1 headings; keep existing layout in the view sheet.
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import { h, Fragment } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { num, ErrorBox } from './shared.js';
import { Section } from '/components/Section.js';
import { PageHead } from '/components/PageHead.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Figure } from '/components/Figure.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { TextArea } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Columns, Space } from '/components/Layout.js';

const html = htm.bind(h);
const M = (key, params) => t('admin.msm.' + key, params);

/** The ready-made manifests in two columns, each with its way to start from it. */
export function TemplateList({ list, busy, onPick }) {
    const half = Math.ceil(list.length / 2);
    const column = (part) => html`
      <${List} cols="name-doors">
        ${part.map((ft) => html`
          <${Row} key=${ft.type}>
            <${Name} desc=${ft.description}>${ft.name}<//>
            <${Doors}><${Action} small soft disabled=${busy} onClick=${() => onPick(ft.type)}>${M('write.start')}<//><//>
          <//>`)}
      <//>`;
    return html`<${Columns}>${column(list.slice(0, half))}${column(list.slice(half))}<//>`;
}

export default function MsmWrite({ templates, picked, yaml, federate, busy, err, onPick, onYaml, onFederate, onSave, onCancel }) {
    const list = Array.isArray(templates) ? templates : [];

    const step = (i, key) => html`
      <${Row} key=${key}>
        <${Cell}><${Figure} small step n=${String(i).padStart(2, '0')} /><//>
        <${Name} desc=${M('write.' + key + 'Why')}>${M('write.' + key)}<//>
        <${Doors} />
      <//>`;

    return html`
    <${Fragment}>
      <${Actions}><${Action} small soft onClick=${onCancel}>${M('detail.back')}<//><//>

      <${PageHead} title=${M('write.title')} desc=${M('write.lead')} />

      <${Section} num="01" title=${M('write.startFrom')}
        doors=${html`<${Note} kind="meta" inline>${M('write.templateCount', { n: num(list.length) })}<//>`}>
        ${list.length === 0
          ? html`<${Note} kind="quiet">${M('write.noTemplates')}<//>`
          : html`
            <${Note} kind="lead">${M('write.startFromWhy')}<//>
            <${TemplateList} list=${list} busy=${busy} onPick=${onPick} />`}
      <//>

      <${Section} num="02" title=${M('write.theManifest')}
        doors=${picked ? html`<${Note} kind="meta" inline>${M('write.from', { name: picked })}<//>` : null}>
        <${TextArea} code rows=${20} label=${M('write.yamlLabel')} placeholder=${M('write.yamlPlaceholder')}
          value=${yaml} onInput=${onYaml} />
        <${Check} checked=${federate} onChange=${onFederate}>${M('write.federate')}<//>
        ${err && html`<${Space} above="medium"><${ErrorBox} message=${err} /><//>`}
      <//>

      <${Section} num="03" title=${M('write.whenYouSave')}>
        <${List} cols="n-name-doors" keepCols>
          ${step(1, 'shapeChecked')}
          ${step(2, 'serviceNot')}
          ${step(3, 'goesPublic')}
        <//>
        <${Space} above="large">
          <${Actions}>
            <${Loud} control disabled=${busy || !yaml.trim()} onClick=${onSave}>
              ${busy ? M('write.saving') : M('write.save')}
            <//>
            <${Action} small soft onClick=${onCancel}>${t('common.cancel')}<//>
          <//>
        <//>
      <//>
    <//>`;
}
