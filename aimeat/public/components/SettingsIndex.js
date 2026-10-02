/**
 * @file public/components/SettingsIndex.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A long list of settings a person searches and edits, as one component: a row of tools
 *   pinned under the page's bar (the search with its magnifier, the filters, and while something is
 *   unsaved the words and actions that say so), the index of the groups beside the settings that
 *   stays in sight while the settings scroll, one line per setting, and the list of unsaved changes
 *   as old → new. A page passes data, handlers and its parts; it never writes a class. The index is
 *   the library's contents rail in its light tone (components/Rail.js); the look of the rest is
 *   css/components/settings-index.css (main's admin Config page: .adm-cfg-tools, .adm-cfg-searchwrap,
 *   .adm-cfg-pending-mini, .adm-cfg-listbox, .adm-cfg-body, .adm-cfg-rail, .adm-cfg-frow and its
 *   cells in views/admin.css).
 *
 *   SettingsIndex({ search, filters, status, before, index, indexLabel, empty, children })
 *   - search: { value, onInput(value), placeholder, label }: the search field, pinned.
 *   - filters: the filters beside it (a Tabs row). status: what stands after them while something
 *     is unsaved (the count, save, cancel, the way to the list); a screen reader hears it as a status.
 *   - before: what stands under the pinned row and over the settings (the change list, a banner,
 *     the message after a save).
 *   - index: the groups for the index, [{ key, label, items: [{ key, label, count, onClick }] }];
 *     indexLabel names it for a screen reader. With no group the settings are not drawn and
 *     `empty` says why (nothing matches).
 *   - children: the settings, grouped by the page (Section, SubHeading).
 *   SettingLine({ id, name, flag, flagTitle, code, desc, source, editor, end }): one setting: its name
 *   (with the flag after it, a mark that it is edited and not saved, and `flagTitle` its tooltip),
 *   its key in mono, what it does, where its value comes from (a status mark), the editor, and what
 *   stands at the end (a reset). On a phone the cells stand under each other.
 *   ChangeList({ items }): the unsaved changes, [{ key, code, was, now }], each as key, the old value
 *   struck through, →, the new value; a screen reader hears it as a status.
 * @structure SettingsIndex(props) · SettingLine(props) · ChangeList({ items })
 * @usage html`<${SettingsIndex} search=${{ value: q, onInput: setQ, placeholder: x('search') }} filters=${tabs}
 *          status=${dirty ? pending : null} index=${groups} indexLabel=${x('toc')} empty=${x('noMatch')}>
 *          <${Section} id="cfg-ai" title=${x('ai')} count=${n}>
 *            <${SettingLine} name=${x('model')} code="ai.model" desc=${x('modelDesc')} source=${mark} editor=${field} />
 *          <//>
 *        <//>`
 * @version-history
 *   v1.2.0 — 2026-10-02 — SettingLine `help`: the question mark after a setting's name; additive.
 *   v1.1.0 — 2026-09-27 — The index is the rail's light tone, as main drew it (Jouni: the dark look
 *     belongs only to the operator menu).
 *   v1.0.0 — 2026-09-27 — Initial: the admin Config page's pinned tools, left index, field rows and
 *     old → new list (views/admin/config-tab.js) as a component; the index is now the contents rail
 *     (admin group G1).
 */
import { h } from 'preact';
import htm from 'htm';
import { TextField } from '/components/TextField.js';
import { Rail } from '/components/Rail.js';
import { Note } from '/components/Note.js';
import { HelpLabel } from '/components/HelpTip.js';

const html = htm.bind(h);
const has = (x) => x !== undefined && x !== null && x !== false && x !== '';

/** The magnifier before the search field; it says nothing to a screen reader. */
function Magnifier() {
  return html`<svg class="settings-index-magnifier" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>`;
}

/**
 * @param {{ search?: { value: string, onInput: (v: string) => void, placeholder?: string, label?: string },
 *   filters?: any, status?: any, before?: any, index?: Array<{ key?: any, label: any, items: Array<object> }>,
 *   indexLabel?: string, empty?: any, children?: any }} props
 */
export function SettingsIndex({ search, filters, status, before, index = [], indexLabel, empty, children }) {
  const groups = (index || []).filter(Boolean);
  return html`
    <div class="settings-index">
      <div class="settings-index-tools">
        ${search ? html`<div class="settings-index-search"><${Magnifier} />
          <${TextField} search value=${search.value} placeholder=${search.placeholder} ariaLabel=${search.label || search.placeholder}
            onInput=${search.onInput} /></div>` : null}
        ${filters}
        ${has(status) ? html`<span class="settings-index-status" role="status">${status}</span>` : null}
      </div>
      ${before}
      ${groups.length === 0
        ? (has(empty) ? html`<${Note} kind="quiet">${empty}<//>` : null)
        : html`
          <div class="settings-index-body">
            <div class="settings-index-side">
              <${Rail} tone="light" title=${indexLabel} groups=${groups.map((g) => ({ label: g.label, rule: false, items: g.items }))} />
            </div>
            <div class="settings-index-main">${children}</div>
          </div>`}
    </div>`;
}

/**
 * @param {{ id?: string, name: any, help?: string, flag?: any, flagTitle?: string, code?: any, desc?: any, source?: any, editor?: any, end?: any }} props
 *   `help`: a term whose question mark (components/HelpTip.js) stands after the name.
 */
export function SettingLine({ id, name, help, flag, flagTitle, code, desc, source, editor, end }) {
  return html`
    <div class="setting-line" id=${id}>
      <span class="setting-line-name">
        ${help ? html`<${HelpLabel} term=${help} label=${typeof name === 'string' ? name : undefined}>${name}<//>` : name}
        ${has(flag) ? html` <span class="setting-line-flag" title=${flagTitle}>${flag}</span>` : null}
        ${has(code) ? html`<code class="setting-line-code">${code}</code>` : null}
        ${has(desc) ? html`<span class="setting-line-desc">${desc}</span>` : null}
      </span>
      <span class="setting-line-source">${source}</span>
      <span class="setting-line-edit">${editor}</span>
      <span>${end}</span>
    </div>`;
}

/** @param {{ items: Array<{ key?: any, code: any, was: any, now: any }> }} props */
export function ChangeList({ items = [] }) {
  return html`
    <div class="poster-aside setting-changes" role="status">
      <ul>
        ${(items || []).map((it, i) => html`
          <li key=${it.key ?? i}>
            <code>${it.code}</code>
            <span class="setting-changes-was">${it.was}</span>
            <span aria-hidden="true">→</span>
            <strong>${it.now}</strong>
          </li>`)}
      </ul>
    </div>`;
}

export default SettingsIndex;
