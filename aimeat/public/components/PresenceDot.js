/**
 * @file PresenceDot.js
 * @description Canonical presence/availability indicator — a small colored dot
 *   (optionally with a text label) showing whether a person is reachable. Drop it
 *   next to any avatar/name across views (inbox, organism members, directory).
 *   Pass `ghii` and it self-fetches via the shared /js/presence-store.js (batched
 *   + live-refreshing), so a list of dots makes ONE request. Pass `status`
 *   directly for a controlled dot (e.g. the owner's own status in the Koti
 *   control). Colors come from theme tokens (`.presence-dot--*` in theme.css) so
 *   the dot flips correctly in dark mode.
 * @structure PresenceDot({ ghii?, status?, size?='sm', label?=false, title? })
 *   - statuses: available (success) | busy (danger) | away (warn) |
 *     offline (muted) | unknown (faded; hidden in compact mode)
 * @usage
 *   import { PresenceDot } from '/components/PresenceDot.js';
 *   html`<${PresenceDot} ghii=${peerGhii} />`            // list dot (self-fetch)
 *   html`<${PresenceDot} status="available" label />`    // controlled + label
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial presence indicator (shared store, label option).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { usePresence } from '/js/presence-store.js';

const LABEL_KEYS = {
  available: 'presence.status.available',
  busy: 'presence.status.busy',
  away: 'presence.status.away',
  offline: 'presence.status.offline',
  unknown: 'presence.status.unknown',
};

export function PresenceDot({ ghii, status, size = 'sm', label = false, title }) {
  // Controlled mode (explicit status) skips the store entirely.
  const fetched = usePresence(status ? null : ghii);
  const st = status || fetched?.status || 'unknown';

  // In compact (dot-only) mode, an unknown/hidden status renders nothing — no
  // gray smudge next to every name. With a label we still show "unknown".
  if (st === 'unknown' && !label) return null;

  const labelText = t(LABEL_KEYS[st] || LABEL_KEYS.unknown);
  const ttl = title || labelText;

  return html`
    <span class="presence presence--${size}" title=${ttl}>
      <span class="presence-dot presence-dot--${st}" aria-label=${ttl}></span>
      ${label ? html`<span class="presence-label">${labelText}</span>` : null}
    </span>
  `;
}
