/**
 * @file decide-key-test.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's "does the node's TypeSafe key work?" button, shown under the decision
 *   model's settings in the admin Config tab (TARGET-080). One tiny real call on fixed text; the answer
 *   is the model that replied and TypeSafe's request id, or the reason in words.
 *
 *   It tests the key the node is RUNNING with, so a key typed into the field above and not yet saved
 *   is not what it tests; the note under the button says so.
 * @structure DecideKeyTest — a button and its result line
 * @usage html`<${DecideKeyTest} />` (config-tab.js SECTION_ACTIONS.decide)
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared component set (an action, a caption, the
 *     result in the success or danger tone), so the Config page's own classes can go.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import { Stack, Action, Text } from '/components/poster-parts.js';

export function DecideKeyTest() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await apiPost('/v1/admin/decide/test', {});
      const d = r?.data ?? {};
      setResult(d.ok
        ? { ok: true, text: t('dashboard.decideKeyTestOk', { model: d.model || '', request: d.request_id || '' }) }
        : { ok: false, text: d.message || t('dashboard.decideKeyTestFailed') });
    } catch (err) {
      setResult({ ok: false, text: err?.message || t('dashboard.decideKeyTestFailed') });
    } finally {
      setBusy(false);
    }
  };

  return html`<${Stack} density="compact" align="start">
    <${Action} onClick=${run} disabled=${busy}>${busy ? t('dashboard.decideKeyTesting') : t('dashboard.decideKeyTest')}<//>
    <${Text} kind="caption" tone="muted">${t('dashboard.decideKeyTestNote')}<//>
    ${result && html`<${Stack} role="status"><${Text} tone=${result.ok ? 'success' : 'danger'}>${result.text}<//><//>`}
  <//>`;
}

export default DecideKeyTest;
