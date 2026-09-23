/**
 * @file public/views/design-lab/demos-shell.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's live demos for the shell parts (what theme.css held as rules until
 *   2026-09-24) and for the modules catalogued that day. A part whose props are enough is drawn by its
 *   real component; one that fetches from the node to draw (the bell, the open items, the start page
 *   setting, a link preview) is drawn as the markup it writes, with its classes, so the lab shows its
 *   look without calling the node.
 * @structure SHELL_DEMOS — { [id]: { variants: [{ name, render(ex) }], height?, emptyNote? } }
 * @usage import { SHELL_DEMOS } from './demos-shell.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation: every part catalogued, every entry drawn).
 */
import { h } from 'preact';
import htm from 'htm';
import { Card } from '/components/Card.js';
import { Alert } from '/components/Alert.js';
import { Collapsible } from '/components/Collapsible.js';
import { DataTable } from '/components/DataTable.js';
import { EmptyState } from '/components/EmptyState.js';
import { KeyValueRow } from '/components/KeyValueRow.js';
import { Pagination, LoadMore } from '/components/Pagination.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { SearchBar } from '/components/SearchBar.js';
import { Spinner } from '/components/Spinner.js';
import { StatusDot } from '/components/StatusDot.js';
import { ToggleSwitch } from '/components/ToggleSwitch.js';
import { FormField } from '/components/FormField.js';
import { CopyButton } from '/components/CopyButton.js';
import { InboxLink } from '/components/InboxLink.js';
import { JsonValue } from '/components/JsonView.js';
import { OfferBadges, OfferRequirements } from '/components/offer-card-view.js';
import { CLOSE_ICON } from '/js/dialog.js';

const html = htm.bind(h);
const noop = () => {};
const one = (name, render) => ({ variants: [{ name, render }] });
const OFFER = { kind: 'service', price: { amount: 1, currency: 'EUR' }, requirements: ['A connected agent'], tags: ['writing'] };

export const SHELL_DEMOS = {
  'page-base': one('default', () => html`<div class="page-content"><p>The view sits in the page's one scroll region.</p><span class="visually-hidden">Hidden from sight, read by a screen reader.</span></div>`),
  'top-bar': one('default', () => html`<nav class="topnav"><a class="topnav-brand" href="#">AIME<span class="heart">♥</span><span class="brand-at">AT</span></a><div class="topnav-right"><a href="#" class="active">Home</a><a href="#">Chat</a><button type="button" class="lang-btn active">EN</button><button type="button" class="lang-btn">FI</button></div></nav>`),
  button: { variants: [
    { name: 'primary', render: () => html`<button type="button" class="btn-primary">Save</button>` },
    { name: 'outline', render: () => html`<button type="button" class="btn-outline">Cancel</button>` },
    { name: 'ghost', render: () => html`<button type="button" class="btn-ghost">Not now</button>` },
    { name: 'small', render: () => html`<button type="button" class="btn-outline btn-sm">Edit</button>` },
  ] },
  'copy-button': one('default', () => html`<${CopyButton} text="Hello" label="Copy" copiedLabel="Copied" />`),
  card: one('default', () => html`<${Card} title="Storage" subtitle="What this node keeps"><p>Two files.</p><//>`),
  badge: one('tints', () => html`<span><span class="badge badge-success">active</span> <span class="badge badge-warn">paused</span> <span class="badge badge-muted">off</span></span>`),
  pill: one('default', () => html`<span class="pill">pill</span>`),
  seg: one('default', () => html`<div class="seg"><button type="button" class="seg-btn active">Home</button><button type="button" class="seg-btn">Settings</button></div>`),
  'start-page': one('default', () => html`<div class="start-page"><div class="start-page-words"><span class="start-page-title">Start page</span><span class="start-page-hint">Where you land when you sign in.</span></div><div class="seg start-page-seg"><button type="button" class="seg-btn active">Home</button><button type="button" class="seg-btn">Settings & controls</button></div></div>`),
  'status-dot': one('states', () => html`<span><${StatusDot} status="ok" title="Running" /> <${StatusDot} status="warn" title="Slow" /> <${StatusDot} status="error" title="Down" /></span>`),
  'presence-dot': one('online', () => html`<${PresenceDot} status="online" label=${true} />`),
  'key-value-row': one('default', () => html`<${KeyValueRow} label="Node" value="aimeat-local-001-dev" mono=${true} />`),
  pagination: { variants: [
    { name: 'pages', render: () => html`<${Pagination} page=${2} totalPages=${5} onPage=${noop} />` },
    { name: 'load more', render: () => html`<${LoadMore} onMore=${noop} label="Load more" />` },
  ] },
  collapsible: one('open', () => html`<${Collapsible} title="Details" open=${true} onToggle=${noop}><p>What opens.</p><//>`),
  'data-table': one('default', () => html`<${DataTable} headers=${['Name', 'State']} rows=${[['alpha', 'on'], ['beta', 'off']]} />`),
  'usage-chart': one('frame', () => html`<div class="usage-chart"><p>The chart's canvas sits here; its data comes from the node.</p></div>`),
  divider: one('default', () => html`<div class="section-divider">or</div>`),
  'form-field': one('default', () => html`<${FormField} label="Name" hint="Lower-case letters and dashes."><input class="input-field" value="claude" /><//>`),
  'search-bar': one('default', () => html`<${SearchBar} value="" onInput=${noop} placeholder="Search" />`),
  spinner: one('default', () => html`<${Spinner} text="Loading…" />`),
  'empty-state': one('default', () => html`<${EmptyState} title="Nothing here yet" text="Your records appear here." />`),
  'text-utility': one('default', () => html`<span class="text-muted">updated 2 hours ago</span>`),
  'toggle-switch': one('on', () => html`<${ToggleSwitch} checked=${true} onChange=${noop} label="Notifications" />`),
  'site-footer': one('default', () => html`<footer class="site-footer"><div class="site-footer-row"><a href="#">Glossary</a><a href="#">Site map</a></div><div class="site-footer-row site-footer-machine"><a href="#">llms.txt</a><a href="#">API contract</a></div></footer>`),
  alert: { variants: [
    { name: 'success', render: () => html`<${Alert} type="success" message="Saved." />` },
    { name: 'error', render: () => html`<${Alert} type="error" message="It did not save." />` },
  ] },
  toast: one('default', () => html`<div class="toast toast-success">Saved.</div>`),
  'section-header': one('default', () => html`<div><h2 class="section-title">Storage</h2><p class="section-desc">What this node keeps, and for how long.</p></div>`),
  dialog: one('default', () => html`<dialog class="dlg" open><header class="dlg-head"><h2 class="dlg-title">Settings</h2><button type="button" class="dlg-close" aria-label="Close" dangerouslySetInnerHTML=${{ __html: CLOSE_ICON }}></button></header><div class="dlg-body"><p>The body scrolls; the header and footer stay.</p></div><footer class="dlg-foot"><button type="button" class="btn-ghost">Cancel</button><button type="button" class="btn-primary poster-slab">Save</button></footer></dialog>`),
  'margin-pattern': one('default', () => html`<p>The pattern sits in the page margins of the home, the chat and the settings (set in the home's settings).</p>`),
  'notification-bell': one('with a count', () => html`<div class="notif-bell"><button type="button" class="notif-bell-btn">🔔<span class="poster-count poster-count--waiting poster-count--small notif-badge">7</span></button></div>`),
  'open-items-button': one('default', () => html`<button type="button" class="open-items-btn"><span class="open-items-btn-mark">○</span><span class="open-items-btn-count">3</span></button>`),
  'agent-consent': one('frame', () => html`<div class="card agc-card"><p>An agent asks to connect. Its request comes from the node.</p></div>`),
  'contact-card': one('frame', () => html`<aside class="ld-contact poster-aside poster-aside--large"><p class="ld-contact-title">Who runs this node</p><p>Its people come from the node's settings.</p></aside>`),
  'display-prefs-fields': one('frame', () => html`<label class="pf-edit-label">Region<select class="pf-edit-select"><option>Finland</option></select></label>`),
  'inbox-link': one('default', () => html`<${InboxLink} to="support@operators" subject="A question">Write to the operators<//>`),
  'json-view': one('default', () => html`<div class="pf-agd-json-block"><${JsonValue} value=${{ title: 'A note', done: false, count: 3 }} /></div>`),
  'link-preview': one('frame', () => html`<div class="inbox-linkcard"><div class="inbox-linkcard-main"><div class="inbox-linkcard-text"><span class="inbox-linkcard-site">aimeat.io</span><span class="inbox-linkcard-title">A linked page</span></div></div></div>`),
  'memory-embed': one('frame', () => html`<div class="md-mem-value">The record's value appears here.</div>`),
  mermaid: one('frame', () => html`<pre class="mmd-fallback">graph LR; A-->B</pre>`),
  'offer-card-view': one('default', () => html`<div><${OfferBadges} offer=${OFFER} /><${OfferRequirements} offer=${OFFER} /></div>`),
};
