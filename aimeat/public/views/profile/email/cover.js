/**
 * @file public/views/profile/email/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Email page in the poster face (design canvas "AIMEAT Sähköpostin sivu",
 *   direction A). Three sections and two folds: your address and what it is used for (with the
 *   change and the code), your mailboxes (the mail providers, each connection's state, the
 *   addresses it may send as, who may use it), what left through the node, and behind folds what
 *   the node mails you (with the switches) and mail from a chat. Pure render over the ctx bag.
 * @structure renderCover · secAddress · secMailboxes · secSent · lettersFold · chatFold
 * @usage import { renderCover } from './email/cover.js';
 * @version-history
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- The mark of a sender that is not a person is the avatar's agent tone (.poster-box--agent, css/poster.css), a unification: the look Contacts, Notifications, Email and MCP drew alike.
 *   v1.14.0 -- 2026-09-25 -- The last emails from here are the Item grid (.item-grid, two columns), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- The mailboxes and the letters are the Listing (listing, listing-row and its name, words and doors cells, the mark in a cell of its own), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.10.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
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
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces a page that verified one address and said nothing else.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { c, rel, day, clock, providerWord, isSender, stateWord, kindWord, channelWord, statusWord, Switch, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';

const PAGE = 12;

export function renderCover(ctx) {
  const me = ctx.me || {};
  const verified = !!me.email_verified_at;
  const address = me.notification_email || '';
  const since = Date.now() - 30 * 864e5;
  const sent30 = ctx.outbound.filter(m => new Date(m.createdAt).getTime() >= since).length;
  const lastMail = ctx.mailLog[0] || null;
  const mailboxes = ctx.connections.length;
  const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
  const strip = html`
    <div class="og-strip">
      <div><b class="em-strip-addr">${address || '·'}</b><span>${c('stripAddress')}</span><small>${verified ? c('verifiedOn', { when: day(me.email_verified_at) }) : address ? c('notVerified') : c('noAddress')}</small></div>
      <div><b>${mailboxes}</b><span>${c('stripMailboxes')}</span><small>${mailboxes ? ctx.connections.map(x => `${providerWord(ctx.providerOf(x.provider))} · ${x.accountLabel || ''}`).join(' · ') : c('stripMailboxesNone')}</small></div>
      <div><b>${sent30}</b><span>${c('stripSent')}</span><small>${ctx.outbound.length ? c('stripSentSub', { total: ctx.outboundTotal }) : c('stripSentNone')}</small></div>
      <div>${lastMail ? html`<b>${rel(lastMail.at)}</b><span>${c('stripLastMail')}</span><small>${kindWord(lastMail.kind)}${lastMail.subject ? ' · ' + lastMail.subject : ''}</small>` : html`<b>·</b><span>${c('stripLastMail')}</span><small>${c('stripLastMailNone')}</small>`}</div>
    </div>`;
  return html`
    <div class="og og-em">
      ${crumb()}
      <div class="og-mast">
        <div class="og-mast-words">
          <h1 class="og-title poster-page-title">${c('title')}</h1>
          <div class="poster-chips">
            ${verified ? chip(c('chipVerified')) : chip(c('chipUnverified'), 'poster-chip--coral')}${mailboxes ? chip(c('chipMailboxes', { n: mailboxes })) : null}${chip(c('chipSent', { n: sent30 }))}
          </div>
          <p class="og-desc">${c('desc')}</p>
        </div>
        <div class="og-mast-actions">
          <button type="button" class="poster-slab" onClick=${() => scrollTo('em-mailboxes')}>${c('connectMailbox')}</button>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}</button></div>
        </div>
      </div>
      ${strip}
      <div class="og-grid">
        <div class="og-main">
          ${secAddress(ctx, me, verified, address)}
          ${secMailboxes(ctx)}
          ${secSent(ctx)}
          <${FoldSection} id="em-letters" num="04" title=${c('lettersTitle')} sub=${c('lettersSub')} open=${ctx.folds.letters} onToggle=${() => ctx.setFold('letters', !ctx.folds.letters)}>${lettersFold(ctx)}<//>
          <${FoldSection} id="em-chat" num="05" title=${c('chatTitle')} sub=${c('chatSub')} open=${ctx.folds.chat} onToggle=${() => ctx.setFold('chat', !ctx.folds.chat)}>${chatFold(ctx)}<//>
        </div>
        <nav class="og-rail" aria-label=${c('railTitle')}>
          <span class="og-rail-label">${c('railTitle')}</span>
          ${[['01', 'em-address', c('secAddress'), ''], ['02', 'em-mailboxes', c('secMailboxes'), mailboxes], ['03', 'em-sent', c('secSent'), ctx.outboundTotal], ['04', 'em-letters', c('lettersTitle'), ''], ['05', 'em-chat', c('chatTitle'), '']]
            .map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${c('pages')}</span>
          ${pageLinks()}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function secAddress(ctx, me, verified, address) {
  const doors = ctx.changing ? null : html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.startChange()}>${address ? c('changeAddress') : c('addAddress')}</button>`;
  const uses = ['recovery', 'magic', 'invites', 'contact', 'letters'];
  return html`
    <${PageSection} id="em-address" num="01" title=${c('secAddress')} count=${c('secAddressSub')} doors=${doors} first>
      ${ctx.changing ? html`
        <div class="ct-kv em-form">
          <div class="k poster-label">${c('fAddress')}</div><div class="v">
            <input class="og-input" type="email" value=${ctx.form.email} disabled=${ctx.busy || ctx.form.codeSent} placeholder=${t('profile.email.enterEmail')} onInput=${e => ctx.setForm({ ...ctx.form, email: e.target.value })} />
            <small class="poster-hint">${verified && address && ctx.form.email.trim() && ctx.form.email.trim() !== address ? c('changeWarning') : c('codeHint')}</small>
          </div>
          ${ctx.form.codeSent ? html`
            <div class="k poster-label">${c('fCode')}</div><div class="v">
              <input class="og-input em-code" inputmode="numeric" value=${ctx.form.code} placeholder="123456" onInput=${e => ctx.setForm({ ...ctx.form, code: e.target.value })} />
              <small class="poster-hint">${c('codeSentTo', { email: ctx.form.email.trim() })}</small>
            </div>` : null}
        </div>
        <div class="og-doors em-form-doors">
          ${ctx.form.codeSent
            ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy || ctx.form.code.trim().length < 4} onClick=${() => ctx.confirmCode()}>${c('confirm')}</button>`
            : html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy || !ctx.form.email.trim()} onClick=${() => ctx.sendCode()}>${c('sendCode')}</button>`}
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.cancelChange()}>${t('common.cancel')}</button>
        </div>`
      : html`
        <div class="em-uses">
          ${uses.map(k => html`<div key=${k}><i class=${verified ? '' : 'no'}>${verified ? '✓' : '·'}</i><span><b>${c('use.' + k + 'T')}</b><small>${c('use.' + k + 'D')}</small></span></div>`)}
          <div><i class="no">·</i><span><b>${c('use.neverT')}</b><small>${c('use.neverD')}</small></span></div>
        </div>
        <${Hint}>${verified ? c('addressHint') : address ? c('unverifiedHint') : c('noAddressHint')}<//>`}
    <//>`;
}

function secMailboxes(ctx) {
  const doors = html`${ctx.providers.filter(p => !isSender(p)).map(p => html`<button type="button" key=${p.id} class="poster-action poster-action--small" disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${providerWord(p)}</button>`)}`;
  const rows = ctx.providers.map(p => ({ p, conn: ctx.connections.find(x => x.provider === p.id) || null }));
  return html`
    <${PageSection} id="em-mailboxes" num="02" title=${c('secMailboxes')} count=${c('secMailboxesSub')} doors=${doors}>
      ${!ctx.providers.length ? html`<p class="poster-quiet">${c('noProviders')}</p>` : html`
        <div class="listing listing--cols listing--mark-name-desc-doors">
          ${rows.map(({ p, conn }) => html`
            <div class="listing-row" key=${p.id}>
              <div><div class=${`ct-av nt-av poster-box poster-box--avatar ${conn ? '' : 'poster-box--agent'}`} aria-hidden="true">${providerWord(p).slice(0, 1)}</div></div>
              <div class="listing-name">${providerWord(p)}<small>${conn ? [conn.accountLabel, ctx.aliases[conn.id]?.length ? c('aliases', { list: ctx.aliases[conn.id].join(', ') }) : null].filter(Boolean).join(' · ') : c('notConnected')}</small></div>
              <div class="listing-desc">${c(isSender(p) ? 'sendWhat' : 'readWhat')}${conn && (ctx.delegations[conn.id] || []).length ? html`<small>${c('delegationsN', { n: ctx.delegations[conn.id].filter(d => d.enabled !== false).length })}</small>` : null}</div>
              <div class="listing-doors">
                ${conn ? html`<span class=${`poster-status ${conn.status === 'active' ? 'poster-status--fine' : 'poster-status--attention'}`}>${stateWord(conn)}</span><button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${ctx.busy} onClick=${() => ctx.remove(conn, p)}>${c('remove')}</button>`
                  : html`<button type="button" class="poster-action poster-action--small poster-action--row" disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${ctx.connecting === p.id ? c('connecting') : c('connect')}</button>`}
              </div>
              ${conn && (ctx.delegations[conn.id] || []).length ? html`<div class="em-deleg">${ctx.delegations[conn.id].map(d => html`<div key=${d.id}><b>${d.appId || d.app_id || d.app || '?'}</b><small>${d.action || ''}${d.enabled === false ? ' · ' + c('stopped') : ''}</small>${d.enabled === false ? null : html`<button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy} onClick=${() => ctx.stopDelegation(conn, d)}>${c('stop')}</button>`}</div>`)}</div>` : null}
            </div>`)}
        </div>`}
      <${Hint}>${c('mailboxesHint')}<//>
    <//>`;
}

function secSent(ctx) {
  const f = ctx.sentFilter;
  let list = ctx.outbound;
  if (f === 'email') list = list.filter(m => m.channel !== 'inbox');
  if (f === 'inbox') list = list.filter(m => m.channel === 'inbox');
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const door = (key, label) => html`<button type="button" key=${key} class=${`poster-tab poster-tab--fold ${f === key ? 'is-on' : ''}`} onClick=${() => ctx.setSentFilter(key)}>${label}</button>`;
  const doors = html`${door('all', c('all'))}${door('email', c('via.email'))}${door('inbox', c('via.inbox'))}`;
  return html`
    <${PageSection} id="em-sent" num="03" title=${c('secSent')} count=${`${ctx.outboundTotal} · ${c('secSentSub')}`} doors=${doors}>
      ${!shown.length ? html`<p class="poster-quiet">${ctx.outbound.length ? c('emptyFiltered') : c('emptySent')}</p>` : html`
        <div class="em-log em-log--head"><div class="poster-label">${c('colWhen')}</div><div class="poster-label">${c('colWhat')}</div><div class="poster-label">${c('colVia')}</div><div class="poster-label"></div></div>
        <div class="em-log">
          ${shown.map(m => html`
            <div class="em-m poster-time" key=${'w' + m.id}><b>${rel(m.createdAt)}</b>${clock(m.createdAt)}</div>
            <div class="em-what" key=${'t' + m.id}><b>${m.subject || c('noSubject')}</b><small>${ctx.contactName(m.contactId)} · ${c('kind.' + (m.kind || 'transactional'))} · ${statusWord(m.status)}</small></div>
            <div class="em-m" key=${'v' + m.id}>${channelWord(m)}${m.organismId ? html`<br />${c('asOrganism')}` : null}</div>
            <div class="og-tbl-door" key=${'d' + m.id}>${m.contactId ? html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.openContact(m.contactId)}>${c('openContact')}</button>` : null}</div>`)}
        </div>`}
      ${list.length > shown.length ? html`<div class="og-doors em-more"><button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}</button></div>` : null}
      <${Hint}>${c('sentHint')}<//>
    <//>`;
}

function lettersFold(ctx) {
  const s = ctx.settings || {};
  const em = s.email || { workflowEnd: true };
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const verified = !!ctx.me?.email_verified_at;
  const row = (key, on, ctl) => html`
    <div class="listing-row" key=${key}>
      <div><div class="ct-av nt-av poster-box poster-box--avatar" aria-hidden="true">A</div></div>
      <div class="listing-name">${c('letter.' + key + 'T')}<small>${c('letter.' + key + 'S')}</small></div>
      <div class="listing-desc">${c('letter.' + key + 'D')}</div>
      <div class="listing-doors">${ctl}</div>
    </div>`;
  return html`
    <div class="listing listing--cols listing--mark-name-desc-doors em-letters">
      ${row('security', true, html`<${Switch} on locked label=${c('always')} />`)}
      ${row('invites', true, html`<${Switch} on locked label=${c('always')} />`)}
      ${row('workflow', em.workflowEnd !== false, html`<${Switch} on=${em.workflowEnd !== false} label=${c('emailWord')} disabled=${ctx.busy || !verified} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, workflowEnd: em.workflowEnd === false } })} />`)}
      ${row('digest', digest.enabled, html`${digest.enabled ? html`<select class="select-field em-select" value=${String(digest.afterHours)} onChange=${e => ctx.saveSettings({ ...s, emailDigest: { ...digest, afterHours: Number(e.target.value) } })}>${[2, 4, 8, 24, 72].map(h => html`<option key=${h} value=${String(h)}>${c('afterHours', { h })}</option>`)}</select>` : null}<${Switch} on=${digest.enabled} label=${c('emailWord')} disabled=${ctx.busy || !verified} onToggle=${() => ctx.saveSettings({ ...s, emailDigest: { ...digest, enabled: !digest.enabled } })} />`)}
      ${row('nudge', em.nudge === true, html`<${Switch} on=${em.nudge === true} label=${c('emailWord')} disabled=${ctx.busy || !verified} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, nudge: em.nudge !== true } })} />`)}
    </div>
    <${Hint}>${verified ? c('lettersHint') : c('lettersNeedVerified')}<//>
    ${ctx.mailLog.length ? html`
      <div class="poster-label em-label">${c('lastLetters')}</div>
      <div class="item-grid item-grid--2">${ctx.mailLog.slice(0, 8).map((e, i) => html`<div key=${i}><b>${kindWord(e.kind)}</b><small>${rel(e.at)}${e.subject ? ' · ' + e.subject : ''}</small></div>`)}</div>` : null}`;
}

function chatFold(ctx) {
  const road = (k, code) => html`
    <div class="nt-road poster-box" key=${k}><span class="nt-road-k">${c('road.' + k + 'K')}</span><b>${c('road.' + k + 'T')}</b><p>${c('road.' + k + 'D')}</p><code class="code-inline">${code}</code></div>`;
  return html`
    <div class="nt-roads">
      ${road('read', 'aimeat_mail_search · aimeat_mail_read')}
      ${road('send', 'aimeat_mail_send · aimeat_mail_aliases')}
      ${road('app', 'POST /v1/connections/:id/delegations')}
    </div>
    <div class="og-doors em-more"><button type="button" class="poster-slab" onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}</button></div>
    <${Hint}>${c('chatHint')}<//>`;
}
