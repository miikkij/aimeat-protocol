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
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail, the strip is a plain
 *     NumeralBand, a device and a road are boxes, quiet hours are KeyValue rows with Fields and
 *     choice tabs; no class of its own. The mast's Clear is an underlined word beside the one slab.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces a page that showed no notification and three email
 *     choices nothing read.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Columns, Stack, Chip, Action, Field, Text, NumeralBand, KeyValue, Surface } from '/components/poster-parts.js';
import { groupWord, kindWord, sourceName, titleOf } from '/js/services/notifications.js';
import { c, rel, day, Switch, inboxTable, senderRows, road, crumb, pageLinks } from './frame.js';

const PAGE = 12;
const GROUPS = ['organisms', 'messages', 'workflows', 'apps', 'account', 'other'];

export function renderCover(ctx) {
  const items = ctx.items, unread = items.filter(n => !n.read).length;
  const since = Date.now() - 30 * 864e5;
  const recent = items.filter(n => new Date(n.createdAt).getTime() >= since);
  const senderNames = (() => { const m = new Map(); for (const n of recent) { const k = sourceName(n); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); })();
  const appSenders = ctx.senders.filter(s => s.kind === 'app').length;
  const devices = ctx.devices.length;
  const chip = (n, key, tone = 'plain') => html`<${Chip} tone=${tone}>${c(key, { n })}<//>`;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripLatest'), value: items[0] ? rel(items[0].createdAt) : '·', note: items[0] ? `${sourceName(items[0])} · ${titleOf(items[0])}` : c('nothingYet') },
    { label: c('stripUnread'), value: unread, tone: unread ? 'coral' : undefined, note: unread ? [...new Set(items.filter(n => !n.read).map(n => sourceName(n)))].join(' · ') : c('stripUnreadNone') },
    { label: c('stripSenders'), value: senderNames.length, note: senderNames.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(' · ') || c('nothingYet') },
    { label: c('stripDevices'), value: devices, note: devices ? ctx.devices.map(d => (d.thisBrowser ? c('thisBrowser') : c('family.' + d.family))).join(' · ') : c('stripDevicesNone') },
  ]} />`;
  const entries = [['nt-inbox', c('secInbox'), items.length], ['nt-senders', c('secSenders'), ctx.senders.length + 1], ['nt-devices', c('secDevices'), devices], ['nt-quiet', c('quietTitle')], ['nt-how', c('howTitle')]]
    .map(([id, label, count]) => ({ id, href: '#' + id, label, count }));
  return html`<${Page} title=${c('title')} crumbs=${crumb()}
    identity=${html`<${Stack} direction="wrap" density="compact">
      ${unread ? chip(unread, 'chipUnread', 'coral') : null}${chip(recent.length, 'chipRecent')}${appSenders ? chip(appSenders, 'chipApps') : null}${devices ? chip(devices, 'chipDevices') : null}
    <//>`}
    actions=${html`<${Action} kind="primary" disabled=${ctx.busy || !unread} onClick=${() => ctx.markAllRead()}>${c('markAllRead')}<//>
      <${Action} disabled=${ctx.busy || !items.length} onClick=${() => ctx.clearAll()}>${c('clear')}<//>`}
    rail=${html`<${Rail} kind="index" title=${c('railTitle')} entries=${entries}>${pageLinks()}<//>`}>
    <${Text} kind="lead" tone="muted">${c('desc')}<//>
    ${strip}
    ${secInbox(ctx)}
    ${secSenders(ctx)}
    ${secDevices(ctx)}
    <${Fold} id="nt-quiet" number="04" title=${c('quietTitle')} sub=${quietSub(ctx)} open=${ctx.folds.quiet} onToggle=${() => ctx.setFold('quiet', !ctx.folds.quiet)}>${quietFold(ctx)}<//>
    <${Fold} id="nt-how" number="05" title=${c('howTitle')} sub=${c('howSub')} open=${ctx.folds.how} onToggle=${() => ctx.setFold('how', !ctx.folds.how)}>${howFold()}<//>
    <${ctx.ConfirmUI} />
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
  const door = (key, label) => html`<${Action} key=${key} kind="tab" selected=${f === key} onClick=${() => ctx.setFilter(key)}>${label}<//>`;
  const doors = html`${door('all', c('all'))}${door('unread', c('unreadOnes'))}${door('needs', c('needsYou'))}${kinds.length > 1 ? kinds.map(k => door(k, kindWord(k))) : null}`;
  return html`
    <${Section} id="nt-inbox" title=${c('secInbox')} count=${`${ctx.items.length} · ${c('secInboxSub')}`} actions=${doors} density="compact">
      <${Stack}>
        ${ctx.loading && !ctx.items.length ? html`<${Text} tone="muted">${t('common.loading')}<//>`
          : !shown.length ? html`<${Text} tone="muted">${ctx.items.length ? c('emptyFiltered') : c('emptyInbox')}<//>`
          : inboxTable(ctx, shown)}
        ${list.length > shown.length ? html`<${Stack} direction="wrap"><${Action} onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}<//><//>` : null}
        <${Text} kind="caption" tone="muted">${c('inboxHint')}<//>
      <//>
    <//>`;
}

function secSenders(ctx) {
  const s = ctx.settings || {};
  const groupRows = GROUPS.map(g => {
    const st = ctx.groups.find(x => x.group === g) || { count: 0, last_at: null, prefs: {} };
    return { key: 'group:' + g, kind: 'aimeat', group: g, name: groupWord(g), sub: c('group.' + g + 'Sub'), what: st.count ? c('sentN', { n: st.count, when: rel(st.last_at) }) : c('sentNone'), prefs: (s.groups || {})[g] || {}, door: null };
  });
  const aimeatRow = { key: 'aimeat', kind: 'aimeat', name: c('aimeatItself'), sub: GROUPS.map(g => groupWord(g)).join(' · '), what: c('aimeatWhat'), prefs: {}, door: html`<${Action} expanded=${ctx.groupsOpen} onClick=${() => ctx.setGroupsOpen(!ctx.groupsOpen)}>${ctx.groupsOpen ? c('byGroupClose') : c('byGroup')}<//>` };
  const others = ctx.senders.map(r => ({
    ...r,
    sub: [kindWord(r.kind), r.granted_at ? c('grantedOn', { when: day(r.granted_at) }) : null, r.count ? c('sentN', { n: r.count, when: rel(r.last_at) }) : c('sentNone')].filter(Boolean).join(' · '),
    what: r.kind === 'app' ? c('appWhat') : r.kind === 'extension' ? c('extensionWhat') : c('agentWhat'),
    door: r.kind === 'app' && r.grant_id ? html`<${Action} tone="danger" disabled=${ctx.busy} onClick=${() => ctx.revokeApp(r)}>${c('revokeGrant')}<//>`
      : r.kind === 'agent' ? html`<${Action} onClick=${() => ctx.openTab('agents')}>${t('profile.tabs.agents')}<//>` : null,
  }));
  return html`
    <${Section} id="nt-senders" title=${c('secSenders')} count=${c('secSendersSub')} density="compact">
      <${Stack}>
        ${senderRows(ctx, [aimeatRow])}
        ${ctx.groupsOpen ? html`<${Surface} kind="panel">${senderRows(ctx, groupRows)}<//>` : null}
        ${others.length ? senderRows(ctx, others) : html`<${Text} tone="muted">${c('noOtherSenders')}<//>`}
        <${Text} kind="caption" tone="muted">${c('sendersHint')}<//>
      <//>
    <//>`;
}

/** A device, or the email digest: a box with its name, its state and its doors. */
const deviceBox = (key, title, state, doors, tone) => html`
  <${Surface} key=${key} kind="box" density="compact" tone=${tone}>
    <${Stack} density="compact">
      <${Text}><strong>${title}</strong><//>
      <${Text} kind="mono" tone="muted">${state}<//>
      <${Stack} direction="wrap" density="compact">${doors}<//>
    <//>
  <//>`;

function secDevices(ctx) {
  const s = ctx.settings || {};
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const mine = ctx.devices.find(d => d.thisBrowser);
  const doors = html`<${Action} disabled=${ctx.busy || !mine} onClick=${() => ctx.testPush()}>${c('sendTest')}<//>`;
  return html`
    <${Section} id="nt-devices" title=${c('secDevices')} count=${c('secDevicesSub')} actions=${doors} density="compact">
      <${Stack}>
        <${Columns} layout="thirds" collapse=${560}>
          ${deviceBox('this', c('thisBrowser'),
            ctx.pushSupport === false ? c('noBrowserSupport') : ctx.vapid === false ? c('notConfigured') : mine ? c('pushOn') : c('pushOff'),
            mine ? html`<${Action} kind="text" disabled=${ctx.busy} onClick=${() => ctx.unsubscribe()}>${c('turnOff')}<//>`
              : html`<${Action} disabled=${ctx.busy || ctx.pushSupport === false || ctx.vapid === false} onClick=${() => ctx.subscribe()}>${c('turnOn')}<//>`)}
          ${ctx.devices.filter(d => !d.thisBrowser).map(d => deviceBox(d.endpoint, c('family.' + d.family),
            c('deviceSince', { added: day(d.created_at), used: rel(d.last_used_at) }),
            html`<${Action} kind="text" tone="danger" disabled=${ctx.busy} onClick=${() => ctx.removeDevice(d)}>${c('remove')}<//>`))}
          ${deviceBox('digest', c('emailDigest'),
            ctx.emailVerified === false ? c('emailNotVerified') : digest.enabled ? c('digestOn', { h: digest.afterHours }) : c('digestOff'),
            html`${digest.enabled ? html`<${Field} type="select" width="narrow" ariaLabel=${c('emailDigest')} value=${String(digest.afterHours)}
                options=${[2, 4, 8, 24, 72].map(h => ({ value: String(h), label: c('afterHours', { h }) }))}
                onChange=${e => ctx.saveSettings({ ...s, emailDigest: { ...digest, afterHours: Number(e.target.value) } })} />` : null}
              <${Switch} on=${digest.enabled} label=${c('digestSwitch')} disabled=${ctx.busy || ctx.emailVerified === false} onToggle=${() => ctx.saveSettings({ ...s, emailDigest: { ...digest, enabled: !digest.enabled } })} />`,
            digest.enabled ? undefined : 'muted')}
        <//>
        <${Text} kind="caption" tone="muted">${c('devicesHint')}<//>
      <//>
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
  const toggleGroup = (g) => set({ breakthrough: f.breakthrough.includes(g) ? f.breakthrough.filter(x => x !== g) : [...f.breakthrough, g] });
  return html`
    <${KeyValue} label=${c('quietWhen')} value=${html`<${Stack} density="compact">
      <${Stack} direction="wrap" align="center" density="compact">
        <${Switch} on=${f.enabled} label=${f.enabled ? c('quietOnWord') : c('quietOffWord')} onToggle=${() => set({ enabled: !f.enabled })} />
        <${Field} type="time" width="narrow" ariaLabel=${c('quietWhen')} value=${f.start} disabled=${!f.enabled} onInput=${e => set({ start: e.target.value })} />
        <${Text} tone="muted">–<//>
        <${Field} type="time" width="narrow" ariaLabel=${c('quietWhen')} value=${f.end} disabled=${!f.enabled} onInput=${e => set({ end: e.target.value })} />
        <${Field} width="narrow" ariaLabel=${c('quietWhen')} value=${f.tz} disabled=${!f.enabled} placeholder="Europe/Helsinki" onInput=${e => set({ tz: e.target.value })} />
      <//>
      <${Text} kind="caption" tone="muted">${c('quietHint')}<//>
    <//>`} />
    <${KeyValue} label=${c('breakthrough')} value=${html`<${Stack} density="compact">
      <${Stack} direction="wrap" density="compact">${GROUPS.map(g => html`<${Action} key=${g} kind="tab" selected=${f.breakthrough.includes(g)} disabled=${!f.enabled} onClick=${() => toggleGroup(g)}>${groupWord(g)}<//>`)}<//>
      <${Text} kind="caption" tone="muted">${c('breakthroughHint')}<//>
    <//>`} />
    <${KeyValue} label=${c('throttle')} value=${html`<${Stack} density="compact">
      <${Stack} direction="wrap" density="compact">${[0, 5, 10, 30].map(m => html`<${Action} key=${m} kind="tab" semantics="radio" selected=${f.throttleMinutes === m} onClick=${() => set({ throttleMinutes: m })}>${m ? c('throttleN', { n: m }) : c('throttleOff')}<//>`)}<//>
      <${Text} kind="caption" tone="muted">${c('throttleHint')}<//>
    <//>`} />
    <${Stack} direction="wrap">
      <${Action} disabled=${ctx.busy} onClick=${() => ctx.saveSettings({ ...s, quiet: f.enabled ? { start: f.start, end: f.end, tz: f.tz.trim() || 'UTC', breakthrough: f.breakthrough } : null, throttleMinutes: f.throttleMinutes })}>${c('save')}<//>
    <//>`;
}

function howFold() {
  return html`
    <${Columns} layout="thirds" collapse=${560}>
      ${road('app', c('how.appK'), c('how.appTitle'), c('how.appBody'), "await session.notify('Report ready', { body: 'Q2 numbers are in.' })")}
      ${road('ext', c('how.extK'), c('how.extTitle'), c('how.extBody'), "await ctx.notify(message, { title, link })")}
      ${road('agent', c('how.agentK'), c('how.agentTitle'), c('how.agentBody'), 'aimeat_notify { title, body, link }')}
    <//>
    <${Text} kind="caption" tone="muted">${c('how.hint')}<//>`;
}
