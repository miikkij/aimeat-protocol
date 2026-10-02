/**
 * @file public/views/profile/notifications/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Notifications page in the poster face (design canvas "AIMEAT Ilmoitusten sivu",
 *   direction A). Three sections and two folds: what happened (the bell's list with the sender
 *   shown, filters, the actions), who may notify you (the node's groups, the apps with the grant,
 *   the extensions and agents, each with the owner's decision), where notifications arrive (this
 *   browser, the other devices, the email digest), quiet hours, and how a notification is born.
 *   Pure render functions over the ctx bag.
 * @structure renderCover · secInbox · secSenders · secDevices · quietFold · howFold
 * @usage import { renderCover } from './notifications/cover.js';
 * @version-history
 *   v1.16.0 -- 2026-10-02 -- The question marks that explain the quiet hours: notify.throttle, notify.breakthrough (components/HelpTip.js).
 *   v1.15.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and rail as data; FigureStrip; Tabs in the fold tone; List via frame.js; More; the groups under the AIMEAT row on the sun edge Box; the devices as framed Cards, the one you are on current, a switched-off digest off; the quiet hours as Fields with Switch, TextField, Choice; Roads; Note; Action): the page passes data and writes no class (page group G8).
 *   v1.14.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- The groups under AIMEAT's sender row are the Panel (.poster-panel, its sun edge), a unification: the look the library carries for a part set apart by the sun.
 *   v1.11.0 -- 2026-09-25 -- The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.10.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces a page that showed no notification and three email
 *     choices nothing read.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { More } from '/components/List.js';
import { Box } from '/components/Box.js';
import { Card, CardGrid } from '/components/Card.js';
import { Roads, Road } from '/components/Roads.js';
import { Tabs } from '/components/Tabs.js';
import { Fields, Field, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Choice } from '/components/Choice.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Row as Line } from '/components/Layout.js';
import { groupWord, kindWord, sourceName, titleOf } from '/js/services/notifications.js';
import { c, rel, day, firstLine, Switch, inboxRows, senderRows, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';

const PAGE = 12;
const GROUPS = ['organisms', 'messages', 'workflows', 'apps', 'account', 'other'];

export function renderCover(ctx) {
  const items = ctx.items, unread = items.filter(n => !n.read).length;
  const since = Date.now() - 30 * 864e5;
  const recent = items.filter(n => new Date(n.createdAt).getTime() >= since);
  const senderNames = (() => { const m = new Map(); for (const n of recent) { const k = sourceName(n); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); })();
  const appSenders = ctx.senders.filter(s => s.kind === 'app').length;
  const devices = ctx.devices.length;
  const mark = (n, key, tone) => ({ label: c(key, { n }), tone });
  const strip = html`<${FigureStrip} items=${[
    items[0]
      ? { key: 'latest', n: rel(items[0].createdAt), label: c('stripLatest'), sub: `${sourceName(items[0])} · ${titleOf(items[0])}` }
      : { key: 'latest', n: '·', label: c('stripLatest'), sub: c('nothingYet') },
    { key: 'unread', n: unread, tone: unread ? 'coral' : undefined, label: c('stripUnread'),
      sub: unread ? [...new Set(items.filter(n => !n.read).map(n => sourceName(n)))].join(' · ') : c('stripUnreadNone') },
    { key: 'senders', n: senderNames.length, label: c('stripSenders'), sub: senderNames.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(' · ') || c('nothingYet') },
    { key: 'devices', n: devices, label: c('stripDevices'), sub: devices ? ctx.devices.map(d => (d.thisBrowser ? c('thisBrowser') : c('family.' + d.family))).join(' · ') : c('stripDevicesNone') },
  ]} />`;
  return html`
    <${SettingsPage} name="nt"
      crumb=${crumb()}
      title=${c('title')}
      marks=${[
        unread ? mark(unread, 'chipUnread', 'coral') : null,
        mark(recent.length, 'chipRecent'),
        appSenders ? mark(appSenders, 'chipApps') : null,
        devices ? mark(devices, 'chipDevices') : null,
      ]}
      desc=${c('desc')}
      actions=${html`
        <${Loud} control disabled=${ctx.busy || !unread} onClick=${() => ctx.markAllRead()}>${c('markAllRead')}<//>
        <${Actions}><${Action} small soft disabled=${ctx.busy || !items.length} onClick=${() => ctx.clearAll()}>${c('clear')}<//><//>`}
      strip=${strip}
      railTitle=${c('railTitle')}
      sections=${[
        { id: 'nt-inbox', num: '01', label: c('secInbox'), count: items.length },
        { id: 'nt-senders', num: '02', label: c('secSenders'), count: ctx.senders.length + 1 },
        { id: 'nt-devices', num: '03', label: c('secDevices'), count: devices },
        { id: 'nt-quiet', num: '04', label: c('quietTitle'), count: '' },
        { id: 'nt-how', num: '05', label: c('howTitle'), count: '' },
      ]}
      pagesLabel=${c('pages')}
      pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secInbox(ctx)}
      ${secSenders(ctx)}
      ${secDevices(ctx)}
      <${FoldSection} id="nt-quiet" num="04" title=${c('quietTitle')} sub=${quietSub(ctx)} open=${ctx.folds.quiet} onToggle=${() => ctx.setFold('quiet', !ctx.folds.quiet)}>${quietFold(ctx)}<//>
      <${FoldSection} id="nt-how" num="05" title=${c('howTitle')} sub=${c('howSub')} open=${ctx.folds.how} onToggle=${() => ctx.setFold('how', !ctx.folds.how)}>${howFold()}<//>
    <//>`;
}

function secInbox(ctx) {
  const f = ctx.filter;
  const kinds = [...new Set(ctx.items.map(n => n.source?.kind || 'aimeat'))];
  let list = ctx.items;
  if (f === 'unread') list = list.filter(n => !n.read);
  else if (f === 'needs') list = list.filter(n => Array.isArray(n.actions) && n.actions.length);
  else if (f !== 'all') list = list.filter(n => (n.source?.kind || 'aimeat') === f);
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const doors = html`<${Tabs} tone="fold" value=${f} onSelect=${(v) => ctx.setFilter(v)} items=${[
    { value: 'all', label: c('all') }, { value: 'unread', label: c('unreadOnes') }, { value: 'needs', label: c('needsYou') },
    ...(kinds.length > 1 ? kinds.map(k => ({ value: k, label: kindWord(k) })) : []),
  ]} />`;
  return html`
    <${PageSection} id="nt-inbox" num="01" title=${c('secInbox')} count=${`${ctx.items.length} · ${c('secInboxSub')}`} doors=${doors} first>
      ${ctx.loading && !ctx.items.length ? html`<${Note} kind="loading">${t('common.loading')}<//>`
        : !shown.length ? html`<${Note} kind="quiet">${ctx.items.length ? c('emptyFiltered') : c('emptyInbox')}<//>`
        : inboxRows(ctx, shown)}
      ${list.length > shown.length ? html`<${More} onMore=${() => ctx.setShowAll(true)} label=${c('showRest', { n: list.length - shown.length })} />` : null}
      <${Hint}>${c('inboxHint')}<//>
    <//>`;
}

function secSenders(ctx) {
  const s = ctx.settings || {};
  const groupRows = GROUPS.map(g => {
    const st = ctx.groups.find(x => x.group === g) || { count: 0, last_at: null, prefs: {} };
    return { key: 'group:' + g, kind: 'aimeat', group: g, name: groupWord(g), sub: c('group.' + g + 'Sub'), what: st.count ? c('sentN', { n: st.count, when: rel(st.last_at) }) : c('sentNone'), prefs: (s.groups || {})[g] || {}, door: null };
  });
  const aimeatRow = { key: 'aimeat', kind: 'aimeat', name: c('aimeatItself'), sub: GROUPS.map(g => groupWord(g)).join(' · '), what: c('aimeatWhat'), prefs: {},
    door: html`<${Action} small soft expanded=${!!ctx.groupsOpen} onClick=${() => ctx.setGroupsOpen(!ctx.groupsOpen)}>${ctx.groupsOpen ? c('byGroupClose') : c('byGroup')}<//>` };
  const others = ctx.senders.map(r => ({
    ...r,
    sub: [kindWord(r.kind), r.granted_at ? c('grantedOn', { when: day(r.granted_at) }) : null, r.count ? c('sentN', { n: r.count, when: rel(r.last_at) }) : c('sentNone')].filter(Boolean).join(' · '),
    what: r.kind === 'app' ? c('appWhat') : r.kind === 'extension' ? c('extensionWhat') : c('agentWhat'),
    door: r.kind === 'app' && r.grant_id ? html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.revokeApp(r)}>${c('revokeGrant')}<//>`
      : r.kind === 'agent' ? html`<${Action} small soft onClick=${() => ctx.openTab('agents')}>${t('profile.tabs.agents')}<//>` : null,
  }));
  return html`
    <${PageSection} id="nt-senders" num="02" title=${c('secSenders')} count=${c('secSendersSub')}>
      ${senderRows({ ...ctx, setPref: (r, patch) => ctx.setPref(r, patch) }, [aimeatRow])}
      ${ctx.groupsOpen ? html`<${Box} tone="edge">${senderRows(ctx, groupRows, { under: true })}<//>` : null}
      ${others.length ? senderRows(ctx, others) : html`<${Note} kind="quiet">${c('noOtherSenders')}<//>`}
      <${Hint}>${c('sendersHint')}<//>
    <//>`;
}

function secDevices(ctx) {
  const s = ctx.settings || {};
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const mine = ctx.devices.find(d => d.thisBrowser);
  const doors = html`<${Action} small disabled=${ctx.busy || !mine} onClick=${() => ctx.testPush()}>${c('sendTest')}<//>`;
  const setDigest = (patch) => ctx.saveSettings({ ...s, emailDigest: { ...digest, ...patch } });
  return html`
    <${PageSection} id="nt-devices" num="03" title=${c('secDevices')} count=${c('secDevicesSub')} doors=${doors}>
      <${CardGrid}>
        <${Card} tone="framed" state=${mine ? 'current' : undefined} name=${c('thisBrowser')}
          meta=${ctx.pushSupport === false ? c('noBrowserSupport') : ctx.vapid === false ? c('notConfigured') : mine ? c('pushOn') : c('pushOff')}
          doors=${mine
            ? html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.unsubscribe()}>${c('turnOff')}<//>`
            : html`<${Action} small disabled=${ctx.busy || ctx.pushSupport === false || ctx.vapid === false} onClick=${() => ctx.subscribe()}>${c('turnOn')}<//>`} />
        ${ctx.devices.filter(d => !d.thisBrowser).map(d => html`
          <${Card} tone="framed" key=${d.endpoint} name=${c('family.' + d.family)} meta=${c('deviceSince', { added: day(d.created_at), used: rel(d.last_used_at) })}
            doors=${html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.removeDevice(d)}>${c('remove')}<//>`} />`)}
        <${Card} tone="framed" state=${digest.enabled ? undefined : 'off'} name=${c('emailDigest')}
          meta=${ctx.emailVerified === false ? c('emailNotVerified') : digest.enabled ? c('digestOn', { h: digest.afterHours }) : c('digestOff')}
          doors=${html`
            ${digest.enabled ? html`<${Select} fit ariaLabel=${c('emailDigest')} value=${String(digest.afterHours)} onChange=${(v) => setDigest({ afterHours: Number(v) })}
              options=${[2, 4, 8, 24, 72].map(h => [String(h), c('afterHours', { h })])} />` : null}
            <${Switch} on=${digest.enabled} label=${c('digestSwitch')} disabled=${ctx.busy || ctx.emailVerified === false} onToggle=${() => setDigest({ enabled: !digest.enabled })} />`} />
      <//>
      <${Hint}>${c('devicesHint')}<//>
    <//>`;
}

function quietSub(ctx) {
  const q = ctx.settings?.quiet;
  return q ? c('quietSubOn', { start: q.start, end: q.end, tz: q.tz.split('/').pop() }) : c('quietSubOff');
}

function quietFold(ctx) {
  const s = ctx.settings || {};
  const f = ctx.quietForm;
  const set = (patch) => ctx.setQuietForm({ ...f, ...patch });
  const save = () => ctx.saveSettings({ ...s, quiet: f.enabled ? { start: f.start, end: f.end, tz: f.tz.trim() || 'UTC', breakthrough: f.breakthrough } : null, throttleMinutes: f.throttleMinutes });
  return html`
    <${Fields}>
      <${Field} label=${c('quietWhen')} hint=${c('quietHint')} group>
        <${Line} gap="medium" wrap>
          <${Switch} on=${f.enabled} label=${f.enabled ? c('quietOnWord') : c('quietOffWord')} onToggle=${() => set({ enabled: !f.enabled })} />
          <${TextField} type="time" size="short" ariaLabel=${c('quietWhen')} value=${f.start} disabled=${!f.enabled} onInput=${(v) => set({ start: v })} />
          –
          <${TextField} type="time" size="short" ariaLabel=${c('quietWhen')} value=${f.end} disabled=${!f.enabled} onInput=${(v) => set({ end: v })} />
          <${TextField} size="medium" ariaLabel=${c('quietWhen')} value=${f.tz} disabled=${!f.enabled} placeholder="Europe/Helsinki" onInput=${(v) => set({ tz: v })} />
        <//>
      <//>
      <${Choice} multi label=${c('breakthrough')} help="notify.breakthrough" disabled=${!f.enabled}
        value=${f.breakthrough} options=${GROUPS.map(g => [g, groupWord(g)])} onChange=${(list) => set({ breakthrough: list })} />
      <${Choice} label=${c('throttle')} help="notify.throttle" value=${f.throttleMinutes}
        options=${[0, 5, 10, 30].map(m => [m, m ? c('throttleN', { n: m }) : c('throttleOff')])} onChange=${(m) => set({ throttleMinutes: m })} />
    <//>
    <${FormActions}>
      <${Loud} control disabled=${ctx.busy} onClick=${save}>${c('save')}<//>
    <//>`;
}

function howFold() {
  const road = (k, title, body, code) => html`<${Road} key=${k} kicker=${c('how.' + k + 'K')} name=${title} text=${body} codeLine=${code} />`;
  return html`
    <${Roads} cols="three">
      ${road('app', c('how.appTitle'), c('how.appBody'), "await session.notify('Report ready', { body: 'Q2 numbers are in.' })")}
      ${road('ext', c('how.extTitle'), c('how.extBody'), "await ctx.notify(message, { title, link })")}
      ${road('agent', c('how.agentTitle'), c('how.agentBody'), 'aimeat_notify { title, body, link }')}
    <//>
    <${Hint}>${c('how.hint')}<//>`;
}

export { firstLine };
