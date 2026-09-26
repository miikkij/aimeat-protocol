/**
 * @file public/components/Switch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A setting that is on or off: a button with its word on the left and a small framed
 *   box on the right, on the sun when it is on. Its look is css/components/switch.css; the catalogue
 *   entry is `switch`. A switch without a word names itself to a screen reader with `ariaLabel`
 *   (role switch); a switch with its word says its state with aria-pressed.
 * @structure Switch({ on, label, disabled, locked, onToggle, ariaLabel })
 * @usage html`<${Switch} on=${enabled} label=${t('notifpage.push')} onToggle=${flip} />`
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial, from the three copies in Settings & Controls (notifications/frame.js,
 *     email/frame.js, inbox-tab/organize-page.js), with the markup they drew (UI consolidation phase 5,
 *     a unification).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ on?: boolean, label?: any, disabled?: boolean, locked?: boolean, onToggle?: () => void, ariaLabel?: string }} props
 *   locked: on, and it cannot be switched off. ariaLabel: the name of a switch that shows no word.
 */
export function Switch({ on = false, label, disabled = false, locked = false, onToggle, ariaLabel }) {
  const cls = `switch${locked ? ' switch--on switch--locked' : on ? ' switch--on' : ''}`;
  if (ariaLabel) {
    return html`<button type="button" class=${cls} role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${ariaLabel} disabled=${disabled || locked} onClick=${onToggle}>${label}<i></i></button>`;
  }
  return html`<button type="button" class=${cls} disabled=${disabled || locked} aria-pressed=${on ? 'true' : 'false'} onClick=${onToggle}>${label}<i></i></button>`;
}

export default Switch;
