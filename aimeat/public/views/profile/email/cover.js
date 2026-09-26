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
 *   v1.17.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and rail as data; FigureStrip with the address in its long tone; the change form as Fields; the uses, mailboxes, their delegations, the sent log and the letters as the List with Tick, Lead, When and Mark; Tabs in the fold tone; More; CardGrid; Roads; Note; Action): the page passes data and writes no class. Put back from main: no letter sent in 30 days is a dim tag (page group G8).
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
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Tick, Lead, Name, Desc, When, Cell, Doors, More } from '/components/List.js';
import { Card, CardGrid } from '/components/Card.js';
import { Roads, Road } from '/components/Roads.js';
import { Tabs } from '/components/Tabs.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Mark, Label } from '/components/Mark.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Space } from '/components/Layout.js';
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
  const strip = html`<${FigureStrip} items=${[
    { key: 'address', n: address || '·', tone: 'long', label: c('stripAddress'), sub: verified ? c('verifiedOn', { when: day(me.email_verified_at) }) : address ? c('notVerified') : c('noAddress') },
    { key: 'mailboxes', n: mailboxes, label: c('stripMailboxes'), sub: mailboxes ? ctx.connections.map(x => `${providerWord(ctx.providerOf(x.provider))} · ${x.accountLabel || ''}`).join(' · ') : c('stripMailboxesNone') },
    { key: 'sent', n: sent30, label: c('stripSent'), sub: ctx.outbound.length ? c('stripSentSub', { total: ctx.outboundTotal }) : c('stripSentNone') },
    lastMail
      ? { key: 'last', n: rel(lastMail.at), label: c('stripLastMail'), sub: `${kindWord(lastMail.kind)}${lastMail.subject ? ' · ' + lastMail.subject : ''}` }
      : { key: 'last', n: '·', label: c('stripLastMail'), sub: c('stripLastMailNone') },
  ]} />`;
  return html`
    <${SettingsPage} name="em"
      crumb=${crumb()}
      title=${c('title')}
      marks=${[
        verified ? { label: c('chipVerified') } : { label: c('chipUnverified'), tone: 'coral' },
        mailboxes ? { label: c('chipMailboxes', { n: mailboxes }) } : null,
        // No letter sent in 30 days counts nothing yet: main's dim tag.
        { label: c('chipSent', { n: sent30 }), tone: sent30 ? undefined : 'dim' },
      ]}
      desc=${c('desc')}
      actions=${html`
        <${Loud} onClick=${() => scrollToSection('em-mailboxes')}>${c('connectMailbox')}<//>
        <${Actions}><${Action} small onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}<//><//>`}
      strip=${strip}
      railTitle=${c('railTitle')}
      sections=${[
        { id: 'em-address', num: '01', label: c('secAddress'), count: '' },
        { id: 'em-mailboxes', num: '02', label: c('secMailboxes'), count: mailboxes },
        { id: 'em-sent', num: '03', label: c('secSent'), count: ctx.outboundTotal },
        { id: 'em-letters', num: '04', label: c('lettersTitle'), count: '' },
        { id: 'em-chat', num: '05', label: c('chatTitle'), count: '' },
      ]}
      pagesLabel=${c('pages')}
      pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${secAddress(ctx, me, verified, address)}
      ${secMailboxes(ctx)}
      ${secSent(ctx)}
      <${FoldSection} id="em-letters" num="04" title=${c('lettersTitle')} sub=${c('lettersSub')} open=${ctx.folds.letters} onToggle=${() => ctx.setFold('letters', !ctx.folds.letters)}>${lettersFold(ctx)}<//>
      <${FoldSection} id="em-chat" num="05" title=${c('chatTitle')} sub=${c('chatSub')} open=${ctx.folds.chat} onToggle=${() => ctx.setFold('chat', !ctx.folds.chat)}>${chatFold(ctx)}<//>
    <//>`;
}

function secAddress(ctx, me, verified, address) {
  const doors = ctx.changing ? null : html`<${Action} small soft onClick=${() => ctx.startChange()}>${address ? c('changeAddress') : c('addAddress')}<//>`;
  const uses = ['recovery', 'magic', 'invites', 'contact', 'letters'];
  const setForm = (patch) => ctx.setForm({ ...ctx.form, ...patch });
  return html`
    <${PageSection} id="em-address" num="01" title=${c('secAddress')} count=${c('secAddressSub')} doors=${doors} first>
      ${ctx.changing ? html`
        <${Fields}>
          <${TextField} type="email" label=${c('fAddress')} value=${ctx.form.email} disabled=${ctx.busy || ctx.form.codeSent} placeholder=${t('profile.email.enterEmail')}
            onInput=${(v) => setForm({ email: v })}
            hint=${verified && address && ctx.form.email.trim() && ctx.form.email.trim() !== address ? c('changeWarning') : c('codeHint')} />
          ${ctx.form.codeSent ? html`
            <${TextField} size="short" inputMode="numeric" label=${c('fCode')} value=${ctx.form.code} placeholder="123456"
              onInput=${(v) => setForm({ code: v })} hint=${c('codeSentTo', { email: ctx.form.email.trim() })} />` : null}
        <//>
        <${FormActions}>
          ${ctx.form.codeSent
            ? html`<${Loud} control disabled=${ctx.busy || ctx.form.code.trim().length < 4} onClick=${() => ctx.confirmCode()}>${c('confirm')}<//>`
            : html`<${Loud} control disabled=${ctx.busy || !ctx.form.email.trim()} onClick=${() => ctx.sendCode()}>${c('sendCode')}<//>`}
          <${Action} small soft onClick=${() => ctx.cancelChange()}>${t('common.cancel')}<//>
        <//>`
      : html`
        <${List} cols="mark-name-mark-name" keepCols>
          ${uses.map(k => html`<${Row} key=${k}><${Tick} bare state=${verified ? 'done' : 'off'} /><${Name} desc=${c('use.' + k + 'D')}>${c('use.' + k + 'T')}<//><//>`)}
          <${Row} key="never"><${Tick} bare state="off" /><${Name} desc=${c('use.neverD')}>${c('use.neverT')}<//><//>
        <//>
        <${Hint}>${verified ? c('addressHint') : address ? c('unverifiedHint') : c('noAddressHint')}<//>`}
    <//>`;
}

/** The delegations of a mailbox: which app may act on it, what it does, and the way to stop it. */
function delegations(ctx, conn) {
  const list = ctx.delegations[conn.id] || [];
  return html`<${List} cols="name-doors" dense>
    ${list.map(d => html`
      <${Row} key=${d.id}>
        <${Name} meta=${`${d.action || ''}${d.enabled === false ? ' · ' + c('stopped') : ''}`}>${d.appId || d.app_id || d.app || '?'}<//>
        <${Doors}>${d.enabled === false ? null : html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.stopDelegation(conn, d)}>${c('stop')}<//>`}<//>
      <//>`)}
  <//>`;
}

function secMailboxes(ctx) {
  const doors = html`${ctx.providers.filter(p => !isSender(p)).map(p => html`<${Action} small key=${p.id} disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${providerWord(p)}<//>`)}`;
  const rows = ctx.providers.map(p => ({ p, conn: ctx.connections.find(x => x.provider === p.id) || null }));
  return html`
    <${PageSection} id="em-mailboxes" num="02" title=${c('secMailboxes')} count=${c('secMailboxesSub')} doors=${doors}>
      <${List} cols="mark-name-desc-doors" keepCols empty=${c('noProviders')}>
        ${rows.map(({ p, conn }) => {
          const deleg = conn && (ctx.delegations[conn.id] || []).length;
          return html`
          <${Row} key=${p.id} below=${deleg ? delegations(ctx, conn) : null}>
            <${Lead} text=${providerWord(p).slice(0, 1)} agent=${!conn} />
            <${Name} meta=${conn ? [conn.accountLabel, ctx.aliases[conn.id]?.length ? c('aliases', { list: ctx.aliases[conn.id].join(', ') }) : null].filter(Boolean).join(' · ') : c('notConnected')}>${providerWord(p)}<//>
            <${Desc} sub=${deleg ? c('delegationsN', { n: ctx.delegations[conn.id].filter(d => d.enabled !== false).length }) : null}>${c(isSender(p) ? 'sendWhat' : 'readWhat')}<//>
            <${Doors}>
              ${conn ? html`
                <${Mark} kind="status" tone=${conn.status === 'active' ? 'fine' : 'attention'}>${stateWord(conn)}<//>
                <${Action} small row soft disabled=${ctx.busy} onClick=${() => ctx.remove(conn, p)}>${c('remove')}<//>`
                : html`<${Action} small row disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${ctx.connecting === p.id ? c('connecting') : c('connect')}<//>`}
            <//>
          <//>`; })}
      <//>
      <${Hint}>${c('mailboxesHint')}<//>
    <//>`;
}

function secSent(ctx) {
  const f = ctx.sentFilter;
  let list = ctx.outbound;
  if (f === 'email') list = list.filter(m => m.channel !== 'inbox');
  if (f === 'inbox') list = list.filter(m => m.channel === 'inbox');
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const doors = html`<${Tabs} tone="fold" value=${f} onSelect=${(v) => ctx.setSentFilter(v)}
    items=${[{ value: 'all', label: c('all') }, { value: 'email', label: c('via.email') }, { value: 'inbox', label: c('via.inbox') }]} />`;
  return html`
    <${PageSection} id="em-sent" num="03" title=${c('secSent')} count=${`${ctx.outboundTotal} · ${c('secSentSub')}`} doors=${doors}>
      <${List} cols="when-name-via-doors" keepCols empty=${ctx.outbound.length ? c('emptyFiltered') : c('emptySent')}
        head=${shown.length ? [c('colWhen'), c('colWhat'), c('colVia'), ''] : null}>
        ${shown.map(m => html`
          <${Row} key=${m.id}>
            <${When} at=${clock(m.createdAt)}>${rel(m.createdAt)}<//>
            <${Name} meta=${`${ctx.contactName(m.contactId)} · ${c('kind.' + (m.kind || 'transactional'))} · ${statusWord(m.status)}`}>${m.subject || c('noSubject')}<//>
            <${Cell} meta>${channelWord(m)}${m.organismId ? html`<br />${c('asOrganism')}` : null}<//>
            <${Doors}>${m.contactId ? html`<${Action} small row soft onClick=${() => ctx.openContact(m.contactId)}>${c('openContact')}<//>` : null}<//>
          <//>`)}
      <//>
      ${list.length > shown.length ? html`<${More} onMore=${() => ctx.setShowAll(true)} label=${c('showRest', { n: list.length - shown.length })} />` : null}
      <${Hint}>${c('sentHint')}<//>
    <//>`;
}

function lettersFold(ctx) {
  const s = ctx.settings || {};
  const em = s.email || { workflowEnd: true };
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const verified = !!ctx.me?.email_verified_at;
  const off = ctx.busy || !verified;
  const row = (key, ctl) => html`
    <${Row} key=${key}>
      <${Lead} text="A" />
      <${Name} meta=${c('letter.' + key + 'S')}>${c('letter.' + key + 'T')}<//>
      <${Desc}>${c('letter.' + key + 'D')}<//>
      <${Doors}>${ctl}<//>
    <//>`;
  const setDigest = (patch) => ctx.saveSettings({ ...s, emailDigest: { ...digest, ...patch } });
  return html`
    <${List} cols="mark-name-desc-doors" keepCols>
      ${row('security', html`<${Switch} on locked label=${c('always')} />`)}
      ${row('invites', html`<${Switch} on locked label=${c('always')} />`)}
      ${row('workflow', html`<${Switch} on=${em.workflowEnd !== false} label=${c('emailWord')} disabled=${off} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, workflowEnd: em.workflowEnd === false } })} />`)}
      ${row('digest', html`
        ${digest.enabled ? html`<${Select} fit ariaLabel=${c('letter.digestT')} value=${String(digest.afterHours)} onChange=${(v) => setDigest({ afterHours: Number(v) })}
          options=${[2, 4, 8, 24, 72].map(h => [String(h), c('afterHours', { h })])} />` : null}
        <${Switch} on=${digest.enabled} label=${c('emailWord')} disabled=${off} onToggle=${() => setDigest({ enabled: !digest.enabled })} />`)}
      ${row('nudge', html`<${Switch} on=${em.nudge === true} label=${c('emailWord')} disabled=${off} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, nudge: em.nudge !== true } })} />`)}
    <//>
    <${Hint}>${verified ? c('lettersHint') : c('lettersNeedVerified')}<//>
    ${ctx.mailLog.length ? html`
      <${Space} above="large"><${Label} block>${c('lastLetters')}<//><//>
      <${CardGrid} cols="two">${ctx.mailLog.slice(0, 8).map((e, i) => html`<${Card} key=${i} name=${kindWord(e.kind)} meta=${`${rel(e.at)}${e.subject ? ' · ' + e.subject : ''}`} />`)}<//>` : null}`;
}

function chatFold(ctx) {
  const road = (k, code) => html`<${Road} key=${k} kicker=${c('road.' + k + 'K')} name=${c('road.' + k + 'T')} text=${c('road.' + k + 'D')} codeLine=${code} />`;
  return html`
    <${Roads} cols="three">
      ${road('read', 'aimeat_mail_search · aimeat_mail_read')}
      ${road('send', 'aimeat_mail_send · aimeat_mail_aliases')}
      ${road('app', 'POST /v1/connections/:id/delegations')}
    <//>
    <${Space} above="medium"><${Actions}><${Loud} onClick=${() => ctx.copyPrompt()}>${c('copyPrompt')}<//><//><//>
    <${Hint}>${c('chatHint')}<//>`;
}
