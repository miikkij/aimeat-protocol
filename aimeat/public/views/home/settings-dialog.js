/**
 * @file public/views/home/settings-dialog.js
 * @description The home's settings dialog: everything a person actually adjusts, in four tabs,
 *   reached from one button in the home header.
 *
 *   **It imports the profile's sections; it does not copy them.** Every panel here is an existing
 *   component mounted in a new place, so a fix lands in both surfaces at once — the same rule
 *   AgentConsent was extracted under. Nothing in public/views/profile/ is modified.
 *
 *   Two things make that work and are easy to lose:
 *
 *   1. **The `pf` wrapper.** Most profile CSS is descendant-scoped under `.pf`. Without that class
 *      on the dialog body, three of the four tabs render unstyled and the wrong conclusion is
 *      "these need rewriting".
 *   2. **Module-level component identity.** Defined here rather than inside HomeView, because
 *      HomeView re-renders on every `aimeat-live-update` and a component whose identity is
 *      recreated per render makes Preact unmount and remount the OPEN dialog — the documented
 *      strobe in components/Modal.js.
 * @structure HomeSettingsDialog({ open, onClose, session, showToast, onSwitch })
 * @usage
 *   import { HomeSettingsDialog } from '/views/home/settings-dialog.js';
 *   html`<${HomeSettingsDialog} open=${open} onClose=${close} session=${session} ... />`
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { OpenRouterSettings } from '/views/profile/openrouter-settings.js';
import { ConnectedAppsSection } from '/views/profile/access-tab/connected-apps.js';
import { ConnectionsSection } from '/views/profile/access-tab/connections.js';
import { AccessTokensSection } from '/views/profile/access-tab/access-tokens.js';
import { SharingGroupsSection } from '/views/profile/access-tab/sharing-groups.js';
import { AgentDefaultsSection } from '/views/profile/access-tab/agent-defaults.js';
import NotificationsTab from '/views/profile/notifications-tab.js';
import WalletTab from '/views/profile/wallet-tab.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The tabs, in the order they are worth opening. */
const TABS = [
  { id: 'general', key: 'home.settings.tabGeneral', fallback: 'General' },
  { id: 'openrouter', key: 'home.settings.tabOpenRouter', fallback: 'OpenRouter' },
  { id: 'access', key: 'home.settings.tabAccess', fallback: 'Access' },
  { id: 'wallet', key: 'home.settings.tabWallet', fallback: 'Wallet' },
];

/** The switch back to the old profile, which belongs with the settings rather than in the page. */
function SwitchRow({ onSwitch, busy }) {
  return html`
    <div class="koti-settings-switch">
      <span>${tr('home.switch.here', 'You are using the new home view.')}</span>
      <button type="button" class="btn-ghost" disabled=${busy} onClick=${onSwitch}>
        ${tr('home.switch.toProfile', 'Go back to the old profile')}
      </button>
    </div>`;
}

export function HomeSettingsDialog({ open, onClose, session, showToast, onSwitch, switching }) {
  const [tab, setTab] = useState('general');

  return html`
    <${Modal} open=${open} onClose=${onClose}
      title=${tr('home.settings.title', 'Settings')}
      className="koti-settings-modal">
      ${/* .pf is what the imported profile sections are styled under. */''}
      <div class="pf koti-settings">
        <div class="seg koti-settings-tabs" role="tablist">
          ${TABS.map(x => html`
            <button type="button" key=${x.id} role="tab" aria-selected=${tab === x.id}
              class="seg-btn ${tab === x.id ? 'active' : ''}"
              onClick=${() => setTab(x.id)}>
              ${tr(x.key, x.fallback)}
            </button>`)}
        </div>

        <div class="koti-settings-panel">
          ${tab === 'general' && html`
            <${NotificationsTab} session=${session} showToast=${showToast} />
            <${SwitchRow} onSwitch=${onSwitch} busy=${switching} />`}

          ${/* startOpen: inside a tab there is nothing to collapse into. */''}
          ${tab === 'openrouter' && html`
            <${OpenRouterSettings} startOpen=${true} />`}

          ${tab === 'access' && html`
            <${ConnectedAppsSection} showToast=${showToast} />
            <${ConnectionsSection} showToast=${showToast} />
            <${AccessTokensSection} session=${session} showToast=${showToast} />
            <${SharingGroupsSection} showToast=${showToast} />
            <${AgentDefaultsSection} showToast=${showToast} />`}

          ${/* onStats is the profile header's counter, which does not exist here. */''}
          ${tab === 'wallet' && html`
            <${WalletTab} session=${session} showToast=${showToast} onStats=${() => {}} />`}
        </div>
      </div>
    <//>`;
}
