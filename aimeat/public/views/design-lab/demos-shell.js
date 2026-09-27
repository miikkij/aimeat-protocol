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
 *   v1.3.0 — 2026-09-27 — The start page setting's dialog and footer drawn by the component (live: they
 *     read this account's choice), beside its markup; the toast drawn by ToastBox, with hold and role.
 *   v1.2.2 — 2026-09-27 — The contact card's, the link preview's and the Mermaid fallback's frames
 *     write their components' own names (.contact-card, .link-preview, .mermaid-fallback).
 *   v1.2.1 — 2026-09-27 — The display preferences and the agent consent are drawn by their
 *     components (their props are enough; the consent with one sample request).
 *   v1.2.0 — 2026-09-27 — The card's demo moves to demos-kit.js, drawn by the Card component's tones.
 *   v1.1.0 — 2026-09-24 — The dialog's footer wears the action link and the loud action (decision 22).
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation: every part catalogued, every entry drawn).
 */
import { h } from 'preact';
import htm from 'htm';
import { Alert } from '/components/Alert.js';
import { Collapsible } from '/components/Collapsible.js';
import { DataTable } from '/components/DataTable.js';
import { Check } from '/components/Check.js';
import { Mark } from '/components/Mark.js';
import { Select } from '/components/Select.js';
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
import { AgentConsent } from '/components/AgentConsent.js';
import { DisplayPrefsFields } from '/components/DisplayPrefsFields.js';
import { InboxLink } from '/components/InboxLink.js';
import { JsonValue } from '/components/JsonView.js';
import { OfferBadges, OfferRequirements } from '/components/offer-card-view.js';
import { StartPageSetting } from '/components/StartPageSetting.js';
import { SettingsStack } from '/components/SettingsStack.js';
import { ToastBox } from '/components/Toast.js';
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
  badge: one('tints', () => html`<span><span class="badge badge-success">active</span> <span class="badge badge-warn">paused</span> <span class="badge badge-muted">off</span></span>`),
  pill: one('default', () => html`<span class="pill">pill</span>`),
  seg: one('default', () => html`<div class="seg"><button type="button" class="seg-btn active">Home</button><button type="button" class="seg-btn">Settings</button></div>`),
  'start-page': { variants: [
    { name: 'default (its markup, without the node)', render: () => html`<div class="start-page"><div class="start-page-words"><span class="start-page-title">Start page</span><span class="start-page-hint">Where you land when you sign in.</span></div><div class="seg start-page-seg"><button type="button" class="seg-btn active">Home</button><button type="button" class="seg-btn">Settings & controls</button></div></div>` },
    { name: 'dialog: in a settings dialog (live, this account\'s choice)', render: () => html`<${SettingsStack}><${StartPageSetting} dialog /><//>` },
    { name: 'footer: at a page foot (live, this account\'s choice)', render: () => html`<${StartPageSetting} footer />` },
  ] },
  'status-dot': one('states', () => html`<span><${StatusDot} status="ok" title="Running" /> <${StatusDot} status="warn" title="Slow" /> <${StatusDot} status="error" title="Down" /></span>`),
  'presence-dot': one('online', () => html`<${PresenceDot} status="online" label=${true} />`),
  'key-value-row': one('default', () => html`<${KeyValueRow} label="Node" value="aimeat-local-001-dev" mono=${true} />`),
  pagination: { variants: [
    { name: 'pages', render: () => html`<${Pagination} page=${2} totalPages=${5} onPage=${noop} />` },
    { name: 'load more', render: () => html`<${LoadMore} onMore=${noop} label="Load more" />` },
  ] },
  collapsible: one('open', () => html`<${Collapsible} title="Details" open=${true} onToggle=${noop}><p>What opens.</p><//>`),
  'data-table': { variants: [
    { name: 'default', render: () => html`<${DataTable} headers=${['Name', 'State']} rows=${[['alpha', 'on'], ['beta', 'off']]} />` },
    { name: 'compact: rows to choose from in a dialog', render: () => html`<${DataTable} compact headers=${['', 'App', 'Versions', 'Status']} rows=${[
      [html`<${Check} checked=${true} onChange=${noop} ariaLabel="Harbour Studio" />`, 'Harbour Studio', '3', html`<${Mark} kind="status" tone="fine">new<//>`],
      [html`<${Check} checked=${false} onChange=${noop} ariaLabel="Lumo Bakery" />`, 'Lumo Bakery', '1',
        html`<${Mark} kind="status" tone="attention">exists<//><br /><${Select} fit ariaLabel="Status" value="skip" onChange=${noop} options=${[['skip', 'Skip'], ['replace', 'Replace'], ['new', 'Import as new']]} />`],
    ]} />` },
  ] },
  'usage-chart': one('frame', () => html`<div class="usage-chart"><p>The chart's canvas sits here; its data comes from the node.</p></div>`),
  divider: one('default', () => html`<div class="section-divider">or</div>`),
  'form-field': one('default', () => html`<${FormField} label="Name" hint="Lower-case letters and dashes."><input class="input-field" value="claude" /><//>`),
  'search-bar': one('default', () => html`<${SearchBar} value="" onInput=${noop} placeholder="Search" />`),
  spinner: one('default', () => html`<${Spinner} text="Loading…" />`),
  'empty-state': { variants: [
    { name: 'default', render: () => html`<${EmptyState} title="Nothing here yet" text="Your records appear here." />` },
    { name: 'start, with an aside', render: () => html`<${EmptyState} start icon="🚀" title="No apps yet" text="Drop an HTML file here, or ask your AI to build one for Lumo Bakery." aside="Supports: HTML files and ZIP packages" />` },
    { name: 'start, nothing matches', render: () => html`<${EmptyState} start icon="🔍" title="Nothing matches" text="No app of Harbour Studio has that word in its name or its description." />` },
    { name: 'start, loading', render: () => html`<${EmptyState} start loading title="Loading apps…" text="Reading the catalogue from the node." />` },
    { name: 'line, ruled, with a hint', render: () => html`<${EmptyState} line ruled text="No community apps yet" hint="Apps that other people on this node publish appear here." />` },
    { name: 'line, ruled, loading', render: () => html`<${EmptyState} line ruled loading text="Loading apps…" hint="Reading the catalogue from the node." />` },
    { name: 'line, with a hint', render: () => html`<${EmptyState} line text="No favourites yet" hint="Press the star beside an app to keep it here." />` },
    { name: 'long', render: () => html`<${EmptyState} start icon="🚀" title=${'No apps yet for Nordic Ferries and the other harbour companies you work with'} text=${'Drop an HTML file here, or ask your AI to build one. A long sentence wraps under the title on a narrow phone screen.'} />` },
  ] },
  'text-utility': one('default', () => html`<span class="text-muted">updated 2 hours ago</span>`),
  'toggle-switch': one('on', () => html`<${ToggleSwitch} checked=${true} onChange=${noop} label="Notifications" />`),
  'site-footer': one('default', () => html`<footer class="site-footer"><div class="site-footer-row"><a href="#">Glossary</a><a href="#">Site map</a></div><div class="site-footer-row site-footer-machine"><a href="#">llms.txt</a><a href="#">API contract</a></div></footer>`),
  alert: { variants: [
    { name: 'success', render: () => html`<${Alert} type="success" message="Saved." />` },
    { name: 'error', render: () => html`<${Alert} type="error" message="It did not save." />` },
  ] },
  toast: { variants: [
    { name: 'success', render: () => html`<${ToastBox} toast=${{ msg: 'Saved.', type: 'success' }} />` },
    { name: 'error', render: () => html`<${ToastBox} toast=${{ msg: 'It did not save: the name is taken.', type: 'error' }} role="alert" />` },
    { name: 'warn', render: () => html`<${ToastBox} toast=${{ msg: 'Saved, but bot has not read it yet.', type: 'warning' }} />` },
    { name: 'hold: it stays six seconds', render: () => html`<${ToastBox} hold role="status" toast=${{ msg: 'The welcome mat could not be published. Try again in a minute.', type: 'error' }} />` },
  ] },
  'section-header': one('default', () => html`<div><h2 class="section-title">Storage</h2><p class="section-desc">What this node keeps, and for how long.</p></div>`),
  dialog: one('default', () => html`<dialog class="dlg" open><header class="dlg-head"><h2 class="dlg-title">Settings</h2><button type="button" class="dlg-close" aria-label="Close" dangerouslySetInnerHTML=${{ __html: CLOSE_ICON }}></button></header><div class="dlg-body"><p>The body scrolls; the header and footer stay.</p></div><footer class="dlg-foot"><button type="button" class="poster-action">Cancel</button><button type="button" class="poster-slab poster-slab--control">Save</button></footer></dialog>`),
  'margin-pattern': one('default', () => html`<p>The pattern sits in the page margins of the home, the chat and the settings (set in the home's settings).</p>`),
  'notification-bell': one('with a count', () => html`<div class="notif-bell"><button type="button" class="notif-bell-btn">🔔<span class="poster-count poster-count--waiting poster-count--small notif-badge">7</span></button></div>`),
  'open-items-button': one('default', () => html`<button type="button" class="open-items-btn"><span class="open-items-btn-mark">○</span><span class="open-items-btn-count">3</span></button>`),
  'agent-consent': one('frame', () => html`<${AgentConsent} requests=${[{ user_code: 'WDJB-MJHT', agent_name: 'claude', expires_in: 540 }]} onApprove=${noop} onDeny=${noop} />`),
  'contact-card': one('frame', () => html`<aside class="contact-card poster-aside poster-aside--large"><p class="contact-card-title">Who runs this node</p><p>Its people come from the node's settings.</p></aside>`),
  'display-prefs-fields': one('frame', () => html`<${DisplayPrefsFields} region="fi-FI" timezone="Europe/Helsinki" onChange=${noop} />`),
  'inbox-link': one('default', () => html`<${InboxLink} to="support@operators" subject="A question">Write to the operators<//>`),
  'json-view': one('default', () => html`<div class="json-view-block"><${JsonValue} value=${{ title: 'A note', done: false, count: 3 }} /></div>`),
  'link-preview': one('frame', () => html`<div class="link-preview"><div class="link-preview-main"><div class="link-preview-text"><span class="link-preview-site">aimeat.io</span><span class="link-preview-title">A linked page</span></div></div></div>`),
  'memory-embed': one('frame', () => html`<div class="md-mem-value">The record's value appears here.</div>`),
  mermaid: one('frame', () => html`<pre class="mermaid-fallback">graph LR; A-->B</pre>`),
  'offer-card-view': one('default', () => html`<div><${OfferBadges} offer=${OFFER} /><${OfferRequirements} offer=${OFFER} /></div>`),
};
