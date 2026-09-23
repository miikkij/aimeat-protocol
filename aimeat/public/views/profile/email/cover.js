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
 *   2026-09-22 -- Composed from the shared set: Page with an index Rail, the strip is a plain
 *     NumeralBand, the uses and the letters are list rows, the sent log is a Table, the address
 *     form is KeyValue rows with Fields, the roads are the notifications page's boxes; no class of
 *     its own. The address form's buttons and the chat fold's copy are underlined words, so the
 *     mast keeps the one slab.
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces a page that verified one address and said nothing else.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Fold, Columns, Stack, Chip, Action, Field, Text, NumeralBand, KeyValue, ListRow, Table, scrollToId } from '/components/poster-parts.js';
import { road } from '/views/profile/notifications/frame.js';
import { c, rel, day, clock, providerWord, isSender, stateWord, kindWord, channelWord, statusWord, Switch, crumb, pageLinks } from './frame.js';

const PAGE = 12;

export function renderCover(ctx) {
  const me = ctx.me || {};
  const verified = !!me.email_verified_at;
  const address = me.notification_email || '';
  const since = Date.now() - 30 * 864e5;
  const sent30 = ctx.outbound.filter(m => new Date(m.createdAt).getTime() >= since).length;
  const lastMail = ctx.mailLog[0] || null;
  const mailboxes = ctx.connections.length;
  const strip = html`<${NumeralBand} tone="plain" size="small" items=${[
    { label: c('stripAddress'), value: address || '·', note: verified ? c('verifiedOn', { when: day(me.email_verified_at) }) : address ? c('notVerified') : c('noAddress') },
    { label: c('stripMailboxes'), value: mailboxes, note: mailboxes ? ctx.connections.map(x => `${providerWord(ctx.providerOf(x.provider))} · ${x.accountLabel || ''}`).join(' · ') : c('stripMailboxesNone') },
    { label: c('stripSent'), value: sent30, note: ctx.outbound.length ? c('stripSentSub', { total: ctx.outboundTotal }) : c('stripSentNone') },
    { label: c('stripLastMail'), value: lastMail ? rel(lastMail.at) : '·', note: lastMail ? `${kindWord(lastMail.kind)}${lastMail.subject ? ' · ' + lastMail.subject : ''}` : c('stripLastMailNone') },
  ]} />`;
  const entries = [['em-address', c('secAddress')], ['em-mailboxes', c('secMailboxes'), mailboxes], ['em-sent', c('secSent'), ctx.outboundTotal], ['em-letters', c('lettersTitle')], ['em-chat', c('chatTitle')]]
    .map(([id, label, count]) => ({ id, href: '#' + id, label, count }));
  return html`<${Page} title=${c('title')} crumbs=${crumb()}
    identity=${html`<${Stack} direction="wrap" density="compact">
      ${verified ? html`<${Chip}>${c('chipVerified')}<//>` : html`<${Chip} tone="coral">${c('chipUnverified')}<//>`}
      ${mailboxes ? html`<${Chip}>${c('chipMailboxes', { n: mailboxes })}<//>` : null}
      <${Chip} tone=${sent30 ? 'plain' : 'muted'}>${c('chipSent', { n: sent30 })}<//>
    <//>`}
    actions=${html`<${Action} kind="primary" onClick=${() => scrollToId('em-mailboxes')}>${c('connectMailbox')}<//>
      <${Action} onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}<//>`}
    rail=${html`<${Rail} kind="index" title=${c('railTitle')} entries=${entries}>${pageLinks()}<//>`}>
    <${Text} kind="lead" tone="muted">${c('desc')}<//>
    ${strip}
    ${secAddress(ctx, me, verified, address)}
    ${secMailboxes(ctx)}
    ${secSent(ctx)}
    <${Fold} id="em-letters" number="04" title=${c('lettersTitle')} sub=${c('lettersSub')} open=${ctx.folds.letters} onToggle=${() => ctx.setFold('letters', !ctx.folds.letters)}>${lettersFold(ctx)}<//>
    <${Fold} id="em-chat" number="05" title=${c('chatTitle')} sub=${c('chatSub')} open=${ctx.folds.chat} onToggle=${() => ctx.setFold('chat', !ctx.folds.chat)}>${chatFold(ctx)}<//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function secAddress(ctx, me, verified, address) {
  const doors = ctx.changing ? null : html`<${Action} onClick=${() => ctx.startChange()}>${address ? c('changeAddress') : c('addAddress')}<//>`;
  const uses = ['recovery', 'magic', 'invites', 'contact', 'letters'];
  // A use of the address: a success marker while the address is verified, a quiet one when not.
  const purposeRow = (k, on) => html`<${ListRow} key=${k} density="compact" marker=${on ? 'success' : 'muted'} name=${c('use.' + k + 'T')} detail=${c('use.' + k + 'D')} detailKind="text" />`;
  return html`
    <${Section} id="em-address" title=${c('secAddress')} count=${c('secAddressSub')} actions=${doors} density="compact">
      ${ctx.changing ? html`<${Stack}>
        <${KeyValue} label=${c('fAddress')} value=${html`<${Field} type="email" ariaLabel=${c('fAddress')} value=${ctx.form.email} disabled=${ctx.busy || ctx.form.codeSent}
          placeholder=${t('profile.email.enterEmail')} onInput=${e => ctx.setForm({ ...ctx.form, email: e.target.value })}
          hint=${verified && address && ctx.form.email.trim() && ctx.form.email.trim() !== address ? c('changeWarning') : c('codeHint')} />`} />
        ${ctx.form.codeSent ? html`<${KeyValue} label=${c('fCode')} value=${html`<${Field} width="narrow" inputMode="numeric" ariaLabel=${c('fCode')} value=${ctx.form.code}
          placeholder="123456" onInput=${e => ctx.setForm({ ...ctx.form, code: e.target.value })} hint=${c('codeSentTo', { email: ctx.form.email.trim() })} />`} />` : null}
        <${Stack} direction="wrap" align="center">
          ${ctx.form.codeSent
            ? html`<${Action} disabled=${ctx.busy || ctx.form.code.trim().length < 4} onClick=${() => ctx.confirmCode()}>${c('confirm')}<//>`
            : html`<${Action} disabled=${ctx.busy || !ctx.form.email.trim()} onClick=${() => ctx.sendCode()}>${c('sendCode')}<//>`}
          <${Action} kind="text" onClick=${() => ctx.cancelChange()}>${t('common.cancel')}<//>
        <//>
      <//>` : html`<${Stack}>
        <${Columns} collapse=${560} density="compact">
          ${uses.map(k => purposeRow(k, verified))}
          ${purposeRow('never', false)}
        <//>
        <${Text} kind="caption" tone="muted">${verified ? c('addressHint') : address ? c('unverifiedHint') : c('noAddressHint')}<//>
      <//>`}
    <//>`;
}

function secMailboxes(ctx) {
  const doors = html`${ctx.providers.filter(p => !isSender(p)).map(p => html`<${Action} key=${p.id} disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${providerWord(p)}<//>`)}`;
  const rows = ctx.providers.map(p => ({ p, conn: ctx.connections.find(x => x.provider === p.id) || null }));
  return html`
    <${Section} id="em-mailboxes" title=${c('secMailboxes')} count=${c('secMailboxesSub')} actions=${doors} density="compact">
      <${Stack}>
        ${!ctx.providers.length ? html`<${Text} tone="muted">${c('noProviders')}<//>` : html`<${Stack} density="compact">
          ${rows.map(({ p, conn }) => { const dels = conn ? (ctx.delegations[conn.id] || []) : []; return html`
            <${ListRow} key=${p.id} density="compact"
              mark=${html`<${Chip} tone=${conn ? 'plain' : 'muted'}>${providerWord(p).slice(0, 1)}<//>`}
              name=${providerWord(p)}
              detail=${conn ? [conn.accountLabel, ctx.aliases[conn.id]?.length ? c('aliases', { list: ctx.aliases[conn.id].join(', ') }) : null].filter(Boolean).join(' · ') : c('notConnected')}
              actions=${conn ? html`<${Chip} tone=${conn.status === 'active' ? 'plain' : 'coral'}>${stateWord(conn)}<//><${Action} kind="text" tone="danger" disabled=${ctx.busy} onClick=${() => ctx.remove(conn, p)}>${c('remove')}<//>`
                : html`<${Action} disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${ctx.connecting === p.id ? c('connecting') : c('connect')}<//>`}>
              <${Stack} density="compact">
                <${Text} kind="caption" tone="muted">${c(isSender(p) ? 'sendWhat' : 'readWhat')}<//>
                ${dels.length ? html`<${Text} kind="mono" tone="muted">${c('delegationsN', { n: dels.filter(d => d.enabled !== false).length })}<//>` : null}
                ${dels.map(d => html`<${ListRow} key=${d.id} density="compact" name=${d.appId || d.app_id || d.app || '?'}
                  detail=${`${d.action || ''}${d.enabled === false ? ' · ' + c('stopped') : ''}`} muted=${d.enabled === false}
                  actions=${d.enabled === false ? null : html`<${Action} kind="text" disabled=${ctx.busy} onClick=${() => ctx.stopDelegation(conn, d)}>${c('stop')}<//>`} />`)}
              <//>
            <//>`; })}
        <//>`}
        <${Text} kind="caption" tone="muted">${c('mailboxesHint')}<//>
      <//>
    <//>`;
}

function secSent(ctx) {
  const f = ctx.sentFilter;
  let list = ctx.outbound;
  if (f === 'email') list = list.filter(m => m.channel !== 'inbox');
  if (f === 'inbox') list = list.filter(m => m.channel === 'inbox');
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const door = (key, label) => html`<${Action} key=${key} kind="tab" selected=${f === key} onClick=${() => ctx.setSentFilter(key)}>${label}<//>`;
  const doors = html`${door('all', c('all'))}${door('email', c('via.email'))}${door('inbox', c('via.inbox'))}`;
  return html`
    <${Section} id="em-sent" title=${c('secSent')} count=${`${ctx.outboundTotal} · ${c('secSentSub')}`} actions=${doors} density="compact">
      <${Stack}>
        ${!shown.length ? html`<${Text} tone="muted">${ctx.outbound.length ? c('emptyFiltered') : c('emptySent')}<//>` : html`
          <${Table} collapse=${600} density="compact" label=${c('secSent')} headers=${[c('colWhen'), c('colWhat'), c('colVia'), '']}
            rows=${shown.map(m => [
              // One span per plain cell, so a stacked row on a phone keeps its lines together.
              html`<span>${rel(m.createdAt)}<br />${clock(m.createdAt)}</span>`,
              html`<${Stack} density="compact"><${Text}><strong>${m.subject || c('noSubject')}</strong><//>
                <${Text} kind="caption" tone="muted">${ctx.contactName(m.contactId)} · ${c('kind.' + (m.kind || 'transactional'))} · ${statusWord(m.status)}<//><//>`,
              html`<span>${channelWord(m)}${m.organismId ? html`<br />${c('asOrganism')}` : null}</span>`,
              m.contactId ? html`<${Action} kind="text" onClick=${() => ctx.openContact(m.contactId)}>${c('openContact')}<//>` : '',
            ])} />`}
        ${list.length > shown.length ? html`<${Stack} direction="wrap"><${Action} onClick=${() => ctx.setShowAll(true)}>${c('showRest', { n: list.length - shown.length })}<//><//>` : null}
        <${Text} kind="caption" tone="muted">${c('sentHint')}<//>
      <//>
    <//>`;
}

function lettersFold(ctx) {
  const s = ctx.settings || {};
  const em = s.email || { workflowEnd: true };
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const verified = !!ctx.me?.email_verified_at;
  const row = (key, ctl) => html`<${ListRow} key=${key} density="compact" mark=${html`<${Chip}>A<//>`}
    name=${c('letter.' + key + 'T')} detail=${c('letter.' + key + 'S')} actions=${ctl}>
    <${Text} kind="caption" tone="muted">${c('letter.' + key + 'D')}<//>
  <//>`;
  return html`
    <${Stack} density="compact">
      ${row('security', html`<${Switch} on locked label=${c('always')} />`)}
      ${row('invites', html`<${Switch} on locked label=${c('always')} />`)}
      ${row('workflow', html`<${Switch} on=${em.workflowEnd !== false} label=${c('emailWord')} disabled=${ctx.busy || !verified} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, workflowEnd: em.workflowEnd === false } })} />`)}
      ${row('digest', html`${digest.enabled ? html`<${Field} type="select" width="narrow" ariaLabel=${c('letter.digestT')} value=${String(digest.afterHours)}
          options=${[2, 4, 8, 24, 72].map(h => ({ value: String(h), label: c('afterHours', { h }) }))}
          onChange=${e => ctx.saveSettings({ ...s, emailDigest: { ...digest, afterHours: Number(e.target.value) } })} />` : null}
        <${Switch} on=${digest.enabled} label=${c('emailWord')} disabled=${ctx.busy || !verified} onToggle=${() => ctx.saveSettings({ ...s, emailDigest: { ...digest, enabled: !digest.enabled } })} />`)}
      ${row('nudge', html`<${Switch} on=${em.nudge === true} label=${c('emailWord')} disabled=${ctx.busy || !verified} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, nudge: em.nudge !== true } })} />`)}
    <//>
    <${Text} kind="caption" tone="muted">${verified ? c('lettersHint') : c('lettersNeedVerified')}<//>
    ${ctx.mailLog.length ? html`
      <${Text} kind="label">${c('lastLetters')}<//>
      <${Columns} collapse=${560} density="compact">${ctx.mailLog.slice(0, 8).map((e, i) => html`<${ListRow} key=${i} density="compact"
        name=${kindWord(e.kind)} detail=${`${rel(e.at)}${e.subject ? ' · ' + e.subject : ''}`} />`)}<//>` : null}`;
}

function chatFold(ctx) {
  const r = (k, code) => road(k, c('road.' + k + 'K'), c('road.' + k + 'T'), c('road.' + k + 'D'), code);
  return html`
    <${Columns} layout="thirds" collapse=${560}>
      ${r('read', 'aimeat_mail_search · aimeat_mail_read')}
      ${r('send', 'aimeat_mail_send · aimeat_mail_aliases')}
      ${r('app', 'POST /v1/connections/:id/delegations')}
    <//>
    <${Stack} direction="wrap"><${Action} onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}<//><//>
    <${Text} kind="caption" tone="muted">${c('chatHint')}<//>`;
}
