/**
 * @file public/views/profile/access/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Access page in the poster face: the mast says what a key is and offers the one
 *   loud action (a passkey while there is none, a new token after that); the strip says how many
 *   apps act in the person's name, how many tokens, whether two-step is on and how many sessions are
 *   open; 01 how you sign in (password, passkeys, two-step, the open sessions grouped, the servers
 *   allowed to verify you, the recovery key); 02 who acts in your name (the apps' keys and the
 *   tokens in one list, in words, with the base package said once, and the token form as a fold);
 *   03 your accounts at other services; 04 sharing groups; 05 your addresses for an AI; 06 how your
 *   AI reads this page. Pure render over the ctx bag; the rows are rows.js.
 * @structure renderPage · mast · strip · secSignIn · secKeys · tokenFold · secAccounts · secGroups ·
 *   secAddresses · secRoads
 * @usage import { renderPage } from './access/page.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (design canvas "AIMEAT Pääsy-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Section, Fold, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { TwoFactorSection } from '../security-tab/two-factor.js';
import { PasskeysSection } from '../security-tab/passkeys.js';
import { ConnectionsSection } from '../access-tab/connections.js';
import { SharingGroupsSection } from '../access-tab/sharing-groups.js';
import { SharesIncomingSection } from '../access-tab/shares-incoming.js';
import { x, n, dateWord, crumb, pageLinks, FILTERS, filterRows, scopeSentence } from './frame.js';
import { keyRow, sessionsBlock, federationBlock } from './rows.js';

const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`ac-msg ${m.error ? 'is-err' : ''}`}>${m.text}</small>` : null);

export function renderPage(ctx) {
  const ov = ctx.ov;
  const rail = [
    ['01', 'ac-signin', x('rail.signIn'), ov ? (ov.sign_in.two_factor.enabled ? x('twoStep.onShort') : x('twoStep.offShort')) : ''],
    ['02', 'ac-keys', x('rail.keys'), ov ? String(ctx.rows.length) : ''],
    ['03', 'ac-accounts', x('rail.elsewhere'), ov ? String(ov.connections?.connections?.length || 0) : ''],
    ['04', 'ac-groups', x('rail.groups'), ov ? String(ov.groups?.groups?.length || 0) : ''],
    ['05', 'ac-addresses', x('rail.addresses'), ''],
    ['06', 'ac-roads', x('rail.ai'), ''],
  ];
  return html`
    <div class="og og-ac">
      ${crumb()}
      ${mast(ctx)}
      ${strip(ctx)}
      <div class="og-grid">
        <div class="og-main">
          ${!ov ? html`<p class="ac-empty">${ctx.failed ? x('loadFailed') : x('loading')}</p>` : html`
            ${secSignIn(ctx)}
            ${secKeys(ctx)}
            ${secAccounts(ctx)}
            ${secGroups(ctx)}
            ${secAddresses(ctx)}
            ${secRoads()}`}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${rail.map(([num, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${num}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks(ctx.isOperator)}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function mast(ctx) {
  const ov = ctx.ov;
  const s = ov?.sign_in;
  const chips = !ov ? [] : [
    chip(x('chipApps', { n: ov.appGrants.total }), 'og-chip--sun'),
    s.two_factor.enabled ? chip(x('chipTwoStepOn')) : chip(x('chipTwoStepOff'), 'og-chip--coral'),
    chip(x('chipTokensAccounts', { tokens: ov.accessTokens.total, accounts: ov.connections?.connections?.length || 0 })),
    chip(x('chipSessions', { n: s.sessions.mine.total }), 'og-chip--dim'),
  ];
  const wantPasskey = ov && s.passkeys.available && s.passkeys.count === 0 && ctx.passkeysSupported && !s.managed_by;
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title">${t('profile.tabs.access')}<small>${x('titleSub')}</small></h1>
        <div class="og-chips">${chips}</div>
        <p class="og-desc">${x('desc')}</p>
      </div>
      <div class="og-mast-actions">
        ${wantPasskey
          ? html`<button type="button" class="og-slab" disabled=${ctx.busy === 'passkey'} onClick=${() => ctx.addPasskeyNow()}>${ctx.busy === 'passkey' ? x('working') : x('slabPasskey')}</button><small class="ac-slab-hint">${x('slabPasskeyHint')}</small>`
          : html`<button type="button" class="og-slab" onClick=${() => ctx.toggleForm(true)}>${x('slabToken')}</button><small class="ac-slab-hint">${x('slabTokenHint')}</small>`}
        <div class="og-doors">
          ${wantPasskey ? html`<button type="button" class="og-door" onClick=${() => ctx.toggleForm(true)}>${x('doorNewToken')}</button>` : null}
          <button type="button" class="og-door og-door--quiet" onClick=${() => scrollTo('ac-roads')}>${x('doorToAi')}</button>
        </div>
      </div>
    </div>`;
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<div class="og-strip"><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div></div>`;
  const s = ov.sign_in;
  const apps = ctx.rows.filter((r) => r.kind === 'app');
  const tokens = ctx.rows.filter((r) => r.kind === 'token');
  const day = apps.filter((r) => r.last && Date.now() - new Date(r.last).getTime() < 86400000).length;
  const unused = apps.filter((r) => r.lastLow).length;
  const tokenSub = tokens.length
    ? [tokens.filter((r) => r.token.grant_operator).length ? x('stripTokensOperator', { n: tokens.filter((r) => r.token.grant_operator).length }) : '', tokens.filter((r) => r.token.grant_owner).length ? x('stripTokensOwner', { n: tokens.filter((r) => r.token.grant_owner).length }) : '', tokens.filter((r) => !r.token.expires_at).length ? x('stripTokensNoExpiry', { n: tokens.filter((r) => !r.token.expires_at).length }) : x('stripTokensAllExpire')].filter(Boolean).join(' · ')
    : x('stripTokensNone');
  return html`
    <div class="og-strip">
      <div><b>${n(ov.appGrants.total)}</b><span>${x('stripApps')}</span><small>${ov.appGrants.total ? x('stripAppsSub', { day, unused: x('unusedN', { n: unused, days: 30 }), base: ctx.baseHolders }) : x('stripAppsNone')}</small></div>
      <div><b>${n(ov.accessTokens.total)}</b><span>${x('stripTokens')}</span><small>${tokenSub}</small></div>
      <div>${s.two_factor.enabled ? html`<b class="is-good">${x('twoStep.onWord')}</b>` : html`<b class="is-low">${x('twoStep.offWord')}</b>`}<span>${x('stripTwoStep')}</span><small>${x('stripTwoStepSub', { passkeys: s.passkeys.count, password: s.has_password ? x('passwordSet') : x('passwordNone') })}</small></div>
      <div><b>${n(s.sessions.mine.total)}</b><span>${x('stripSessions')}</span><small>${x('stripSessionsSub', { devices: s.sessions.mine.by_device.length, agents: s.sessions.agents.total })}</small></div>
    </div>`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secSignIn(ctx) {
  const ov = ctx.ov;
  const s = ov.sign_in;
  const tf = s.two_factor;
  const sub = [s.has_password ? x('passwordSet') : x('passwordNone'), tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort'), x('passkeysN', { n: s.passkeys.count })].join(' · ');
  const row = (name, subText, right, extra = '') => html`
    <div class=${`ac-row ${extra}`}><div class="ac-nm"><b>${name}</b><small>${subText}</small></div><div class="ac-r">${right}</div></div>`;
  return html`
    <${Section} id="ac-signin" num="01" title=${x('secSignIn')} count=${sub} first=${true}>
      <p class="ac-para">${tf.enabled || s.passkeys.count ? x('signInIntroOn') : x('signInIntro')}</p>
      ${s.managed_by ? html`<div class="ac-why"><b>${t('profile.security.managedTitle')}</b> ${t('profile.security.managedDesc').replace('{name}', s.managed_by.name)}</div>` : null}
      <div class="ac-rows">
        ${row(x('row.password'), s.has_password ? x('row.passwordSet') : x('row.passwordNone'), html`<span class=${`og-chip ${s.has_password ? '' : 'og-chip--coral'}`}>${s.has_password ? x('inUse') : x('none')}</span>`)}
        ${!s.managed_by && s.passkeys.available ? html`
          ${row(x('row.passkeys'), s.passkeys.count ? x('row.passkeysN', { n: s.passkeys.count }) : x('row.passkeysNone'), html`<span class=${`og-chip ${s.passkeys.count ? '' : 'og-chip--coral'}`}>${x('devicesN', { n: s.passkeys.count })}</span>`, 'is-last')}
          <div class="ac-panel"><${PasskeysSection} showToast=${ctx.showToast} /></div>` : null}
        ${!s.managed_by && tf.available ? html`
          ${row(x('row.twoStep'), tf.enabled ? x('row.twoStepOn', { n: tf.backup_codes_left }) : tf.pending ? x('row.twoStepPending') : x('row.twoStepOff'), html`<span class=${`og-chip ${tf.enabled ? '' : 'og-chip--coral'}`}>${tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort')}</span>`, 'is-last')}
          <div class="ac-panel"><${TwoFactorSection} twoFactor=${tf} managed=${!!s.managed_by} showToast=${ctx.showToast} onChanged=${() => ctx.load()} /></div>` : null}
        ${row(x('row.sessions'), x('row.sessionsSub', { mine: s.sessions.mine.total, agents: s.sessions.agents.total }), html`<span class="ac-n">${n(s.sessions.mine.total)}</span>${s.sessions.mine.total > 1 ? html`<button type="button" class="og-door" disabled=${ctx.busy === 'sessions'} onClick=${() => ctx.signOutOthers()}>${x('doorSignOutOthers')}</button>` : null}`, 'is-last')}
        ${s.sessions.mine.total ? sessionsBlock(ctx) : null}
        ${row(x('row.federation'), ctx.fed.all ? x('row.federationAll') : ctx.fed.nodes.length ? x('row.federationList', { n: ctx.fed.nodes.length }) : x('row.federationNone'), html`<span class="og-chip">${ctx.fed.all ? x('fed.allChip') : x('fed.listChip', { n: ctx.fed.nodes.length })}</span><button type="button" class="og-door" disabled=${ctx.busy === 'fed'} onClick=${() => ctx.toggleFedAll()}>${ctx.fed.all ? x('fed.restrict') : x('fed.allowAll')}</button>`, 'is-last')}
        ${federationBlock(ctx)}
        ${row(x('row.recovery'), ctx.ownerKey ? x('row.recoveryHere') : x('row.recoveryNotHere'), ctx.ownerKey ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setKeyShown(!ctx.keyShown)}>${ctx.keyShown ? x('hide') : x('show')}</button><${CopyButton} className="og-door" text=${ctx.ownerKey} label=${x('copy')} onCopied=${() => ctx.showToast(x('keyCopied'))} />` : html`<span class="og-chip og-chip--dim">${x('notHere')}</span>`, ctx.ownerKey ? 'is-last' : '')}
        ${ctx.ownerKey ? html`<div class="ac-keybox"><div><b>${x('recovery.title')}</b> ${x('recovery.body')}<br /><code class=${ctx.keyShown ? 'is-shown' : ''}>${ctx.ownerKey}</code></div></div>` : null}
      </div>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secKeys(ctx) {
  const ov = ctx.ov;
  const all = ctx.rows;
  const list = filterRows(all, ctx.filter);
  const shown = list.slice(0, ctx.shownKeys);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, filterRows(all, f).length]));
  const unused = counts.unused;
  return html`
    <${Section} id="ac-keys" num="02" title=${x('secKeys')} count=${x('secKeysSub', { apps: ov.appGrants.total, tokens: ov.accessTokens.total })}>
      <p class="ac-para">${x('keysIntro')}</p>
      ${all.length ? html`
        <div class="ac-filters">
          ${FILTERS.map((f) => html`<button type="button" key=${f} class=${`og-chip ${ctx.filter === f ? 'og-chip--sun' : f === 'unused' && counts[f] ? 'og-chip--coral' : ''}`} onClick=${() => ctx.setFilter(f)}>${x('filter.' + f, { days: 30 })} · ${counts[f]}</button>`)}
        </div>
        <div class="ac-keys">
          <div class="ac-key ac-key--head"><div>${x('col.who')}</div><div>${x('col.may')}</div><div>${x('col.last')}</div><div></div></div>
          ${shown.map((r) => keyRow(ctx, r))}
        </div>
        ${list.length > shown.length || unused ? html`<div class="ac-more">
          ${list.length > shown.length ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.showMoreKeys()}>${x('moreKeys', { n: list.length - shown.length })}</button>` : null}
          ${unused ? html`<button type="button" class="og-door og-door--quiet og-door--danger" disabled=${ctx.busy === 'unused'} onClick=${() => ctx.revokeUnused()}>${x('revokeUnused', { n: unused, days: 30 })}</button>` : null}
        </div>` : null}
        ${ctx.baseHolders ? html`<div class="ac-why"><b>${x('whyBaseTitle')}</b> ${x('whyBase', { n: ctx.baseHolders, total: ov.appGrants.total })} ${ov.base_package.map(scopeSentence).join('; ')}.</div>` : null}`
      : html`<p class="ac-empty"><b>${x('keysEmptyTitle')}</b> ${x('keysEmptyBody')}</p>`}
      ${tokenFold(ctx)}
    <//>`;
}

function opt(ctx, field, value, label, cls = '') {
  return html`<button type="button" class=${`ac-opt ${ctx.form[field] === value ? 'is-on' : ''} ${cls}`} onClick=${() => ctx.setForm({ [field]: value })}>${label}</button>`;
}

function tokenFold(ctx) {
  const f = ctx.form;
  const scoped = f.level === 'scoped';
  const chosen = Object.keys(f.scopes).filter((s) => f.scopes[s]);
  const ready = !!f.label.trim() && (!scoped || chosen.length > 0);
  const created = ctx.created;
  return html`
    <div style="margin-top: 1.2rem;">
    <${Fold} id="ac-token" num="" title=${x('form.title')} sub=${created ? x('form.subCreated') : ''} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      ${created ? html`
        <div class="ac-open" style="margin: 0 0 1rem;">
          <span class="og-box-label">${x('created.title')}</span>
          <p class="ac-lead">${x('created.once')}</p>
          <div class="ac-token"><code>${created.token}</code><${CopyButton} className="og-door" text=${created.token} label=${x('copy')} onCopied=${() => ctx.showToast(x('created.copied'))} /></div>
          <div class="ac-row is-last"><div class="ac-nm"><b>${x('created.prompt')}</b><small>${x('created.promptSub')}</small></div><div class="ac-r"><${CopyButton} className="og-door" text=${created.prompt} label=${x('created.copyPrompt')} onCopied=${() => ctx.showToast(x('created.promptCopied'))} /></div></div>
          <div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.clearCreated()}>${x('created.done')}</button></div>
        </div>` : null}
      <p class="ac-para">${x('form.intro')}</p>
      <div class="ac-form">
        <span class="og-label">${x('form.name')}</span>
        <div><input class="og-input" type="text" maxlength="120" value=${f.label} placeholder=${x('form.namePlaceholder')} onInput=${(e) => ctx.setForm({ label: e.target.value })} /><p class="ac-hint">${x('form.nameHint')}</p></div>
        <span class="og-label">${x('form.level')}</span>
        <div>
          <div class="ac-opts">${opt(ctx, 'level', 'scoped', x('level.scopedOpt'))}${opt(ctx, 'level', 'owner', x('level.ownerOpt'), 'is-coral')}${ctx.isOperator ? opt(ctx, 'level', 'operator', x('level.operatorOpt'), 'is-coral') : null}</div>
          ${scoped ? html`<div class="ac-opts">${ctx.tokenScopes.map((s) => html`<button type="button" key=${s} class=${`ac-opt ${f.scopes[s] ? 'is-on' : ''}`} onClick=${() => ctx.toggleScope(s)}>${scopeSentence(s)}</button>`)}</div>` : null}
          <p class="ac-hint">${scoped ? x('form.levelHintScoped') : f.level === 'owner' ? x('level.ownerText') : x('level.operatorText')}</p>
        </div>
        <span class="og-label">${x('form.expiry')}</span>
        <div>
          <div class="ac-opts">${opt(ctx, 'expiry', '86400', x('expiry.day'))}${opt(ctx, 'expiry', '604800', x('expiry.week'))}${opt(ctx, 'expiry', '2592000', x('expiry.month'))}${opt(ctx, 'expiry', '', x('expiry.never'), 'is-coral')}</div>
          <p class="ac-hint">${x('form.expiryHint')}</p>
        </div>
        <span></span>
        <div class="ac-submit">
          <button type="button" class="og-slab" disabled=${!ready || ctx.busy === 'token'} onClick=${() => ctx.createToken()}>${ctx.busy === 'token' ? x('form.making') : x('form.make')}</button>
          <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleForm(false)}>${x('cancel')}</button>
          ${msg(ctx.formMsg)}
        </div>
      </div>
    <//>
    </div>`;
}

/* ── 03 and 04: the sections that keep their components ─────────────────────────────────────── */

function secAccounts(ctx) {
  const c = ctx.ov.connections;
  const count = c?.connections?.length || 0;
  return html`
    <${Section} id="ac-accounts" num="03" title=${x('secAccounts')} count=${c?.enabled ? x('secAccountsSub', { n: count, providers: c.providers.length }) : x('secAccountsOff')}>
      <p class="ac-para">${x('accountsIntro')}</p>
      ${c?.enabled ? html`<div class="ac-kept"><${ConnectionsSection} showToast=${ctx.showToast} /></div>` : html`<p class="ac-empty">${x('accountsOffBody')}</p>`}
    <//>`;
}

function secGroups(ctx) {
  const groups = ctx.ov.groups?.groups || [];
  return html`
    <${Section} id="ac-groups" num="04" title=${x('secGroups')} count=${x('secGroupsSub', { n: groups.length })}>
      <p class="ac-para">${x('groupsIntro')}</p>
      <div class="ac-kept">
        <${SharingGroupsSection} showToast=${ctx.showToast} initial=${ctx.ov.groups} />
        <${SharesIncomingSection} />
      </div>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secAddresses(ctx) {
  const ov = ctx.ov;
  const cur = ov.sign_in.sessions.mine.current;
  const days = cur ? Math.round((new Date(cur.expires_at).getTime() - new Date(cur.issued_at).getTime()) / 86400000) : null;
  const rows = [
    ['ghii', ctx.ghii, x('addr.ghiiSub', { node: ctx.nodeId })],
    ['node', ctx.nodeUrl, x('addr.nodeSub')],
    ['mcp', ctx.nodeUrl + '/v1/mcp', x('addr.mcpSub')],
    ['key', ov.publicKey || '', ov.publicKey ? x('addr.keySub', { n: ov.publicKey.length }) : x('addr.keyNone')],
  ];
  return html`
    <${Section} id="ac-addresses" num="05" title=${x('secAddresses')} count=${x('secAddressesSub')}>
      <p class="ac-para">${x('addressesIntro')}</p>
      <div class="ac-kv">
        ${rows.map(([k, v, sub]) => html`
          <div class="ac-k" key=${'k' + k}>${x('addr.' + k)}</div>
          <div class="ac-v" key=${'v' + k}>${v ? html`<code>${v}</code>` : null}<small>${sub}</small></div>
          <div class="ac-go" key=${'g' + k}>${v ? html`<${CopyButton} className="og-door" text=${v} label=${x('copy')} onCopied=${() => ctx.showToast(x('copied'))} />` : null}</div>`)}
        <div class="ac-k">${x('addr.session')}</div>
        <div class="ac-v">${cur ? x('addr.sessionValue', { date: dateWord(cur.expires_at), days: days ?? '' }) : x('addr.sessionNone')}<small>${x('addr.sessionSub')}</small></div>
        <div class="ac-go"></div>
      </div>
    <//>`;
}

/* ── 06 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${Section} id="ac-roads" num="06" title=${x('secRoads')}>
      <div class="ac-roads">
        <div class="ac-road is-lead">
          <span class="og-box-label">${x('roadAskTitle')}</span>
          <p>${x('roadAskBody')}</p>
          <pre>${ask}</pre>
          <div class="og-doors"><${CopyButton} className="og-door og-door--quiet" text=${ask} label=${x('copyPrompt')} /></div>
        </div>
        <div class="ac-road">
          <span class="og-box-label">${x('roadAgentTitle')}</span>
          <p>${x('roadAgentBody')}</p>
          <small>aimeat_access_list · aimeat_connection_list · aimeat_group_list · aimeat_consent_list · ${x('roadAgentScope')}</small>
        </div>
      </div>
    <//>`;
}
