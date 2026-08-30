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
 *   v1.0.0 — 2026-08-30 — Initial. Replaces a page that showed no notification and three email
 *     choices nothing read.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { groupWord, kindWord, sourceName, titleOf } from '/js/services/notifications.js';
import { c, rel, day, firstLine, Switch, inboxRows, inboxHead, senderRows, crumb, pageLinks } from './frame.js';

const PAGE = 12;
const GROUPS = ['organisms', 'messages', 'workflows', 'apps', 'account', 'other'];

export function renderCover(ctx) {
  const items = ctx.items, unread = items.filter(n => !n.read).length;
  const since = Date.now() - 30 * 864e5;
  const recent = items.filter(n => new Date(n.createdAt).getTime() >= since);
  const senderNames = (() => { const m = new Map(); for (const n of recent) { const k = sourceName(n); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); })();
  const appSenders = ctx.senders.filter(s => s.kind === 'app').length;
  const devices = ctx.devices.length;
  const chip = (n, key, cls = '') => html`<span class=${`og-chip ${cls}`}>${c(key, { n })}</span>`;
  const strip = html`
    <div class="og-strip">
      <div>${items[0] ? html`<b>${rel(items[0].createdAt)}</b><span>${c('stripLatest')}</span><small>${sourceName(items[0])} · ${titleOf(items[0])}</small>` : html`<b>·</b><span>${c('stripLatest')}</span><small>${c('nothingYet')}</small>`}</div>
      <div><b class=${unread ? 'og-strip-coral' : ''}>${unread}</b><span>${c('stripUnread')}</span><small>${unread ? [...new Set(items.filter(n => !n.read).map(n => sourceName(n)))].join(' · ') : c('stripUnreadNone')}</small></div>
      <div><b>${senderNames.length}</b><span>${c('stripSenders')}</span><small>${senderNames.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(' · ') || c('nothingYet')}</small></div>
      <div><b>${devices}</b><span>${c('stripDevices')}</span><small>${devices ? ctx.devices.map(d => (d.thisBrowser ? c('thisBrowser') : c('family.' + d.family))).join(' · ') : c('stripDevicesNone')}</small></div>
    </div>`;
  return html`
    <div class="og og-nt">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title">${c('title')}</h1>
          <div class="og-chips">
            ${unread ? chip(unread, 'chipUnread', 'og-chip--coral') : null}${chip(recent.length, 'chipRecent')}${appSenders ? chip(appSenders, 'chipApps') : null}${devices ? chip(devices, 'chipDevices') : null}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="og-slab" disabled=${ctx.busy || !unread} onClick=${() => ctx.markAllRead()}>${c('markAllRead')}</button>
          <div class="og-doors"><button type="button" class="og-door og-door--quiet" disabled=${ctx.busy || !items.length} onClick=${() => ctx.clearAll()}>${c('clear')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secInbox(ctx)}
          ${secSenders(ctx)}
          ${secDevices(ctx)}
          <${Fold} id="nt-quiet" num="04" title=${c('quietTitle')} sub=${quietSub(ctx)} open=${ctx.folds.quiet} onToggle=${() => ctx.setFold('quiet', !ctx.folds.quiet)}>${quietFold(ctx)}<//>
          <${Fold} id="nt-how" num="05" title=${c('howTitle')} sub=${c('howSub')} open=${ctx.folds.how} onToggle=${() => ctx.setFold('how', !ctx.folds.how)}>${howFold()}<//>
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'nt-inbox', c('secInbox'), items.length], ['02', 'nt-senders', c('secSenders'), ctx.senders.length + 1], ['03', 'nt-devices', c('secDevices'), devices], ['04', 'nt-quiet', c('quietTitle'), ''], ['05', 'nt-how', c('howTitle'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secInbox(ctx) {
  const f = ctx.filter;
  const kinds = [...new Set(ctx.items.map(n => n.source?.kind || 'aimeat'))];
  let list = ctx.items;
  if (f === 'unread') list = list.filter(n => !n.read);
  else if (f === 'needs') list = list.filter(n => Array.isArray(n.actions) && n.actions.length);
  else if (f !== 'all') list = list.filter(n => (n.source?.kind || 'aimeat') === f);
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const door = (key, label) => html`<button type="button" key=${key} class=${`og-door og-door--quiet ${f === key ? 'on' : ''}`} onClick=${() => ctx.setFilter(key)}>${label}</button>`;
  const doors = html`${door('all', c('all'))}${door('unread', c('unreadOnes'))}${door('needs', c('needsYou'))}${kinds.length > 1 ? kinds.map(k => door(k, kindWord(k))) : null}`;
  return html`
    <${Section} id="nt-inbox" num="01" title=${c('secInbox')} count=${`${ctx.items.length} · ${c('secInboxSub')}`} doors=${doors} first>
      ${ctx.loading && !ctx.items.length ? html`<p class="og-empty nt-loading">${t('common.loading')}</p>`
        : !shown.length ? html`<p class="og-empty">${ctx.items.length ? c('emptyFiltered') : c('emptyInbox')}</p>`
        : html`${inboxHead()}${inboxRows(ctx, shown)}`}
      ${list.length > shown.length ? html`<div class="og-doors nt-more"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}</button></div>` : null}
      <p class="nt-hint">${c('inboxHint')}</p>
    <//>`;
}

function secSenders(ctx) {
  const s = ctx.settings || {};
  const groupRows = GROUPS.map(g => {
    const st = ctx.groups.find(x => x.group === g) || { count: 0, last_at: null, prefs: {} };
    return { key: 'group:' + g, kind: 'aimeat', group: g, name: groupWord(g), sub: c('group.' + g + 'Sub'), what: st.count ? c('sentN', { n: st.count, when: rel(st.last_at) }) : c('sentNone'), prefs: (s.groups || {})[g] || {}, door: null };
  });
  const aimeatRow = { key: 'aimeat', kind: 'aimeat', name: c('aimeatItself'), sub: GROUPS.map(g => groupWord(g)).join(' · '), what: c('aimeatWhat'), prefs: {}, door: html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setGroupsOpen(!ctx.groupsOpen)}>${ctx.groupsOpen ? c('byGroupClose') : c('byGroup')}</button>` };
  const others = ctx.senders.map(r => ({
    ...r,
    sub: [kindWord(r.kind), r.granted_at ? c('grantedOn', { when: day(r.granted_at) }) : null, r.count ? c('sentN', { n: r.count, when: rel(r.last_at) }) : c('sentNone')].filter(Boolean).join(' · '),
    what: r.kind === 'app' ? c('appWhat') : r.kind === 'extension' ? c('extensionWhat') : c('agentWhat'),
    door: r.kind === 'app' && r.grant_id ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.revokeApp(r)}>${c('revokeGrant')}</button>`
      : r.kind === 'agent' ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.openTab('agents')}>${t('profile.tabs.agents')}</button>` : null,
  }));
  return html`
    <${Section} id="nt-senders" num="02" title=${c('secSenders')} count=${c('secSendersSub')}>
      ${senderRows({ ...ctx, setPref: (r, patch) => ctx.setPref(r, patch) }, [aimeatRow])}
      ${ctx.groupsOpen ? html`<div class="nt-groups">${senderRows(ctx, groupRows)}</div>` : null}
      ${others.length ? senderRows(ctx, others) : html`<p class="og-empty nt-empty-senders">${c('noOtherSenders')}</p>`}
      <p class="nt-hint">${c('sendersHint')}</p>
    <//>`;
}

function secDevices(ctx) {
  const s = ctx.settings || {};
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const mine = ctx.devices.find(d => d.thisBrowser);
  const doors = html`<button type="button" class="og-door" disabled=${ctx.busy || !mine} onClick=${() => ctx.testPush()}>${c('sendTest')}</button>`;
  return html`
    <${Section} id="nt-devices" num="03" title=${c('secDevices')} count=${c('secDevicesSub')} doors=${doors}>
      <div class="nt-dev">
        <div class=${`nt-dev-card ${mine ? 'this' : ''}`}>
          <b>${c('thisBrowser')}</b><small>${ctx.pushSupport === false ? c('noBrowserSupport') : ctx.vapid === false ? c('notConfigured') : mine ? c('pushOn') : c('pushOff')}</small>
          <div class="og-doors">${mine
            ? html`<button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.unsubscribe()}>${c('turnOff')}</button>`
            : html`<button type="button" class="og-door" disabled=${ctx.busy || ctx.pushSupport === false || ctx.vapid === false} onClick=${() => ctx.subscribe()}>${c('turnOn')}</button>`}</div>
        </div>
        ${ctx.devices.filter(d => !d.thisBrowser).map(d => html`
          <div class="nt-dev-card" key=${d.endpoint}>
            <b>${c('family.' + d.family)}</b><small>${c('deviceSince', { added: day(d.created_at), used: rel(d.last_used_at) })}</small>
            <div class="og-doors"><button type="button" class="og-door og-door--quiet" disabled=${ctx.busy} onClick=${() => ctx.removeDevice(d)}>${c('remove')}</button></div>
          </div>`)}
        <div class=${`nt-dev-card ${digest.enabled ? '' : 'dim'}`}>
          <b>${c('emailDigest')}</b><small>${ctx.emailVerified === false ? c('emailNotVerified') : digest.enabled ? c('digestOn', { h: digest.afterHours }) : c('digestOff')}</small>
          <div class="og-doors nt-digest-doors">
            ${digest.enabled ? html`<select class="og-input nt-select" value=${String(digest.afterHours)} onChange=${e => ctx.saveSettings({ ...s, emailDigest: { ...digest, afterHours: Number(e.target.value) } })}>${[2, 4, 8, 24, 72].map(h => html`<option key=${h} value=${String(h)}>${c('afterHours', { h })}</option>`)}</select>` : null}
            <${Switch} on=${digest.enabled} label=${c('digestSwitch')} disabled=${ctx.busy || ctx.emailVerified === false} onToggle=${() => ctx.saveSettings({ ...s, emailDigest: { ...digest, enabled: !digest.enabled } })} />
          </div>
        </div>
      </div>
      <p class="nt-hint">${c('devicesHint')}</p>
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
    <div class="ct-kv nt-kv">
      <div class="k">${c('quietWhen')}</div><div class="v">
        <div class="nt-quiet-row">
          <${Switch} on=${f.enabled} label=${f.enabled ? c('quietOnWord') : c('quietOffWord')} onToggle=${() => set({ enabled: !f.enabled })} />
          <input class="og-input nt-time" type="time" value=${f.start} disabled=${!f.enabled} onInput=${e => set({ start: e.target.value })} />
          <span class="nt-dash">–</span>
          <input class="og-input nt-time" type="time" value=${f.end} disabled=${!f.enabled} onInput=${e => set({ end: e.target.value })} />
          <input class="og-input nt-tz" value=${f.tz} disabled=${!f.enabled} placeholder="Europe/Helsinki" onInput=${e => set({ tz: e.target.value })} />
        </div>
        <small class="nt-hint">${c('quietHint')}</small>
      </div>
      <div class="k">${c('breakthrough')}</div><div class="v">
        <div class="og-choice nt-choice">${GROUPS.map(g => html`<button type="button" key=${g} class=${`og-choice-btn ${f.breakthrough.includes(g) ? 'on' : ''}`} disabled=${!f.enabled} onClick=${() => toggleGroup(g)}>${groupWord(g)}</button>`)}</div>
        <small class="nt-hint">${c('breakthroughHint')}</small>
      </div>
      <div class="k">${c('throttle')}</div><div class="v">
        <div class="og-choice nt-choice">${[0, 5, 10, 30].map(m => html`<button type="button" key=${m} class=${`og-choice-btn ${f.throttleMinutes === m ? 'on' : ''}`} onClick=${() => set({ throttleMinutes: m })}>${m ? c('throttleN', { n: m }) : c('throttleOff')}</button>`)}</div>
        <small class="nt-hint">${c('throttleHint')}</small>
      </div>
    </div>
    <div class="og-doors nt-form-doors">
      <button type="button" class="og-slab" disabled=${ctx.busy} onClick=${() => ctx.saveSettings({ ...s, quiet: f.enabled ? { start: f.start, end: f.end, tz: f.tz.trim() || 'UTC', breakthrough: f.breakthrough } : null, throttleMinutes: f.throttleMinutes })}>${c('save')}</button>
    </div>`;
}

function howFold() {
  const road = (k, title, body, code) => html`
    <div class="nt-road" key=${k}><span class="nt-road-k">${c('how.' + k + 'K')}</span><b>${title}</b><p>${body}</p><code>${code}</code></div>`;
  return html`
    <div class="nt-roads">
      ${road('app', c('how.appTitle'), c('how.appBody'), "await session.notify('Report ready', { body: 'Q2 numbers are in.' })")}
      ${road('ext', c('how.extTitle'), c('how.extBody'), "await ctx.notify(message, { title, link })")}
      ${road('agent', c('how.agentTitle'), c('how.agentBody'), 'aimeat_notify { title, body, link }')}
    </div>
    <p class="nt-hint">${c('how.hint')}</p>`;
}

export { firstLine };
