/**
 * @file public/views/profile/storage/browser-access.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a browser may send files straight to one S3 or Azure store, and the CORS rule to
 *   add when it may not, shared by the page "Your own storage" (store-sections.js) and the admin page
 *   "File storage" (views/admin/file-stores-tab.named.js). The server checks it when a store is
 *   connected or tested and answers it as the store's `browser_access` (services/file-store/
 *   browser-access.ts): `cors` allowed, partial, missing, unknown or not_checked; `signs` false for an
 *   Azure store connected with a SAS; `rule` while it is not ready. browserAccessRow is one Facts row;
 *   CorsRule is the rule itself, with where to add it, each value to type, and for S3 the JSON to paste.
 *   Every part is a library component; nothing here writes a class.
 * @structure browserAccessRow · CorsHint · CorsRule
 * @usage html`<${Facts} rows=${[..., browserAccessRow(s.browser_access)]} />
 *        <${CorsRule} access=${s.browser_access} kind=${s.kind} />`
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial: the CORS guidance when a person or an operator connects a store
 *     (Jouni, 2026-10-31).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dateTime } from '/js/format.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Code } from '/components/Mark.js';
import { FormActions } from '/components/Field.js';
import { HelpLabel } from '/components/HelpTip.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const B = (key, params) => t('fileStore.browser.' + key, params);

/** The value and the grey line of the row, from the server's answer. */
function words(a) {
  const cors = a ? a.cors : 'not_checked';
  const value = cors === 'allowed' && a.signs === false ? B('needsKey') : B('state.' + cors);
  const sub = [
    cors === 'partial' ? B('notCovered', { origins: a.origins.filter((o) => !o.ok).map((o) => o.origin).join(', ') }) : '',
    cors !== 'allowed' && cors !== 'not_checked' ? B('throughService') : '',
    a && a.signs === false && cors !== 'allowed' ? B('needsKey') : '',
    a && a.checked_at ? B('checkedAt', { when: dateTime(a.checked_at) }) : '',
  ].filter(Boolean).join(' ');
  return { value, sub, warn: (cors !== 'allowed' && cors !== 'not_checked') || !!(a && a.signs === false) };
}

/** One Facts row: whether a browser may send files straight to the store. */
export function browserAccessRow(access) {
  const w = words(access);
  return {
    key: 'browser',
    k: html`<${HelpLabel} term="fileStore.cors" label=${B('label')}>${B('label')}<//>`,
    v: w.value, sub: w.sub || undefined, warn: w.warn,
  };
}

/** The line a connect form shows before anything is sent: the test says whether the rule is missing. */
export function CorsHint() {
  return html`<${Note} kind="hint">${B('connectHint')}<//>`;
}

/** The CORS rule the store needs, where to add it, and (S3) the JSON to paste. Nothing once it is in place. */
export function CorsRule({ access, kind }) {
  const rule = access && access.rule;
  if (!rule) return null;
  const list = (xs) => xs.join(', ');
  return html`
    <${Stack} gap="small">
      <${Note} kind="caption">${B('rule.title')}<//>
      <${Note} kind="hint">${kind === 'azure' ? B('rule.whereAzure') : B('rule.whereS3')}<//>
      <${Facts} rows=${[
        { key: 'origins', k: B('rule.origins'), v: list(rule.allowed_origins), mono: true, sub: B('rule.whyAny') },
        { key: 'methods', k: B('rule.methods'), v: list(rule.allowed_methods), mono: true },
        { key: 'headers', k: B('rule.headers'), v: list(rule.allowed_headers), mono: true },
        { key: 'exposed', k: B('rule.exposed'), v: list(rule.exposed_headers), mono: true },
        { key: 'age', k: B('rule.maxAge'), v: String(rule.max_age_seconds), mono: true },
      ]} />
      ${rule.json ? html`
        <${Note} kind="hint">${B('rule.jsonLead')}<//>
        <${Code} block scroll="medium">${rule.json}<//>
        <${FormActions}>
          <${Action} small control copy=${rule.json} copiedLabel=${B('rule.copied')}>${B('rule.copy')}<//>
        <//>` : null}
      <${Note} kind="hint">${B('rule.after')}<//>
    <//>`;
}
