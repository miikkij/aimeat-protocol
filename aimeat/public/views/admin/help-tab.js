/**
 * @file public/views/admin/help-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin › Ask someone who knows ("Kysy osaajalta"): its settings, the report about what
 *   people asked, and the month so far, as three views. The settings are the help.* config rows; the
 *   report is written by the operator's own AI by default (Jouni, 2026-11-14), and this page hands over
 *   its prompt. The design canvas boards "Asetukset-apu" and "Raportti" (2026-11-14) are the model.
 * @structure HelpAdminTab (default)
 * @usage Registered in views/admin.js NAV_GROUPS as the `help` page.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useToast, Toast } from './shared.js';
import { Tabs } from '/components/Tabs.js';
import { HelpSettings } from './help-tab.settings.js';
import { HelpReport, HelpStatus } from './help-tab.report.js';

const html = htm.bind(h);
const x = (key) => t(`admin.help.${key}`);

export default function HelpAdminTab() {
  const [view, setView] = useState(() => (new URLSearchParams(location.search).get('report') ? 'report' : 'settings'));
  const [toast, showErr, showOk, clearToast] = useToast();
  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${Tabs} bar kind="view" value=${view} onSelect=${setView} items=${[
      { value: 'settings', label: x('tabSettings') },
      { value: 'report', label: x('tabReport') },
      { value: 'status', label: x('tabStatus') },
    ]} />
    ${view === 'settings' ? html`<${HelpSettings} showOk=${showOk} showErr=${showErr} />` : null}
    ${view === 'report' ? html`<${HelpReport} showOk=${showOk} showErr=${showErr} />` : null}
    ${view === 'status' ? html`<${HelpStatus} />` : null}`;
}
