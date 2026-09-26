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
 *   03 your accounts at other services; 04 the secrets an extension may use without seeing them;
 *   05 sharing groups; 06 your addresses for an AI; 07 how your AI reads this page. Pure render
 *   over the ctx bag; the rows are rows.js.
 *
 *   SECRETS SIT WITH THE ACCOUNTS, not with the keys. Both sections answer the same question — a
 *   credential of the person's that something else uses without ever holding it — while section 02
 *   answers the opposite one, which is what a key of THIS account may do.
 * @structure renderPage · mast · strip · secSignIn · secKeys · tokenFold · secAccounts · secSecrets ·
 *   secretFold · secGroups · secAddresses · secRoads
 * @usage import { renderPage } from './access/page.js';
 * @version-history
 *   v1.26.0 -- 2026-09-26 -- The ready-made request and the new token are the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.25.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.24.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.23.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.22.0 -- 2026-09-25 -- Picking a key's level, rights and expiry is the Tab in its tile tone, a risky choice in its attention tone (a unification: Jouni's decision "Choice").
 *   v1.21.0 -- 2026-09-25 -- The addresses are the Facts (css/components/facts.css), a unification: the look most tabs use. A copy door sits at the end of its value.
 *   v1.20.0 -- 2026-09-25 -- The sign-in rows, the keys and the secrets are the Listing (css/components/listing.css), a unification: the look most tabs use. Each sign-in row is a listing of its own, with its panel or block between the listings.
 *   v1.19.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.18.0 -- 2026-09-25 -- The paragraph that opens a section is the og-lead, as in most tabs, not the Hint (UI consolidation phase 5, a unification).
 *   v1.17.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.16.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.15.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.14.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.13.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.12.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.11.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.10.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's
 *     danger tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.9.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.8.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- The filter "unused" is coral again while unused keys exist, as the tab's attention tone.
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.7.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.6.0 -- 2026-09-16 -- MCP servers get section 04 of their own, with a title, a count and an
 *     intro, and the sections after it move one number down (05 secrets to 08 your AI). They had sat
 *     under "Your accounts at other services", where on a server without outside accounts they
 *     appeared directly under "not enabled on this server". An MCP server is tools, not an account.
 *   v1.5.0 -- 2026-09-16 -- Section 03 says the MCP servers list's own title and explanation. The
 *     .ac-kept rule hid them, so the servers showed unlabelled under "not enabled on this server".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.4.0 -- 2026-09-13 -- Compose the recovery frame from poster.css.
 *   v1.3.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-06 — Section 04, the secrets: the list with what names each one, the add form
 *     as a fold with a write-only value field, a replace on the row and a delete behind the
 *     confirm. The strip counts them, the rail carries them, and 05 to 07 moved down by one.
 *   v1.0.0 — 2026-09-05 — Initial (design canvas "AIMEAT Pääsy-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { TwoFactorSection } from '../security-tab/two-factor.js';
import { PasskeysSection } from '../security-tab/passkeys.js';
import { ConnectionsSection } from '../access-tab/connections.js';
import { McpServersSection } from '../access-tab/mcp-servers.js';
import { SharingGroupsSection } from '../access-tab/sharing-groups.js';
import { SharesIncomingSection } from '../access-tab/shares-incoming.js';
import { x, n, dateWord, crumb, pageLinks, FILTERS, filterRows, scopeSentence } from './frame.js';
import { keyRow, secretRow, sessionsBlock, federationBlock } from './rows.js';
import { Hint } from '/components/Hint.js';

const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`form-message ${m.error ? 'form-message--error' : ''}`}>${m.text}</small>` : null);

export function renderPage(ctx) {
  const ov = ctx.ov;
  const rail = [
    ['01', 'ac-signin', x('rail.signIn'), ov ? (ov.sign_in.two_factor.enabled ? x('twoStep.onShort') : x('twoStep.offShort')) : ''],
    ['02', 'ac-keys', x('rail.keys'), ov ? String(ctx.rows.length) : ''],
    ['03', 'ac-accounts', x('rail.elsewhere'), ov ? String(ov.connections?.connections?.length || 0) : ''],
    ['04', 'ac-mcp', x('rail.mcp'), ctx.mcpCount == null ? '' : String(ctx.mcpCount)],
    ['05', 'ac-secrets', x('rail.secrets'), ctx.secrets ? String(ctx.secrets.length) : ''],
    ['06', 'ac-groups', x('rail.groups'), ov ? String(ov.groups?.groups?.length || 0) : ''],
    ['07', 'ac-addresses', x('rail.addresses'), ''],
    ['08', 'ac-roads', x('rail.ai'), ''],
  ];
  return html`
    <div class="og og-ac">
      ${crumb()}
      ${mast(ctx)}
      ${strip(ctx)}
      <div class="og-grid">
        <div class="og-main">
          ${!ov ? html`<p class=${`poster-quiet ac-empty${ctx.failed ? '' : ' loading-mark'}`}>${ctx.failed ? x('loadFailed') : x('loading')}</p>` : html`
            ${secSignIn(ctx)}
            ${secKeys(ctx)}
            ${secAccounts(ctx)}
            ${secMcp(ctx)}
            ${secSecrets(ctx)}
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
    chip(x('chipApps', { n: ov.appGrants.total }), 'poster-chip--sun'),
    s.two_factor.enabled ? chip(x('chipTwoStepOn')) : chip(x('chipTwoStepOff'), 'poster-chip--coral'),
    chip(x('chipTokensAccounts', { tokens: ov.accessTokens.total, accounts: ov.connections?.connections?.length || 0 })),
    chip(x('chipSessions', { n: s.sessions.mine.total })),
  ];
  const wantPasskey = ov && s.passkeys.available && s.passkeys.count === 0 && ctx.passkeysSupported && !s.managed_by;
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title poster-page-title">${t('profile.tabs.access')}<small>${x('titleSub')}</small></h1>
        <div class="poster-chips">${chips}</div>
        <p class="og-desc">${x('desc')}</p>
      </div>
      <div class="og-mast-actions">
        ${wantPasskey
          ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'passkey'} onClick=${() => ctx.addPasskeyNow()}>${ctx.busy === 'passkey' ? x('working') : x('slabPasskey')}</button><small class="poster-hint poster-hint--slab">${x('slabPasskeyHint')}</small>`
          : html`<button type="button" class="poster-slab" onClick=${() => ctx.toggleForm(true)}>${x('slabToken')}</button><small class="poster-hint poster-hint--slab">${x('slabTokenHint')}</small>`}
        <div class="og-doors">
          ${wantPasskey ? html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.toggleForm(true)}>${x('doorNewToken')}</button>` : null}
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => scrollTo('ac-roads')}>${x('doorToAi')}</button>
        </div>
      </div>
    </div>`;
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<div class="og-strip"><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div></div>`;
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
      ${secretTile(ctx)}
      <div>${s.two_factor.enabled ? html`<b class="is-good">${x('twoStep.onWord')}</b>` : html`<b class="is-low">${x('twoStep.offWord')}</b>`}<span>${x('stripTwoStep')}</span><small>${x('stripTwoStepSub', { passkeys: s.passkeys.count, password: s.has_password ? x('passwordSet') : x('passwordNone') })}</small></div>
      <div><b>${n(s.sessions.mine.total)}</b><span>${x('stripSessions')}</span><small>${x('stripSessionsSub', { devices: s.sessions.mine.by_device.length, agents: s.sessions.agents.total })}</small></div>
    </div>`;
}

/** The strip's third tile: how many secrets are kept, and how many of them anything names. */
function secretTile(ctx) {
  const list = ctx.secrets || [];
  const used = list.filter((s) => (s.usedBy || []).length).length;
  return html`
    <div><b>${n(list.length)}</b><span>${x('stripSecrets')}</span><small>${list.length ? x('stripSecretsSub', { used, spare: list.length - used }) : x('stripSecretsNone')}</small></div>`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secSignIn(ctx) {
  const ov = ctx.ov;
  const s = ov.sign_in;
  const tf = s.two_factor;
  const sub = [s.has_password ? x('passwordSet') : x('passwordNone'), tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort'), x('passkeysN', { n: s.passkeys.count })].join(' · ');
  // Each row is a Listing of its own: a panel or a block that belongs to it sits between the
  // listings, and the row it follows is open (no rule between the row and its panel).
  const row = (name, subText, right, extra = '') => html`
    <div class="listing listing--name-state"><div class=${`listing-row ${extra}`}><div class="listing-name"><b>${name}</b><small>${subText}</small></div><div class="listing-doors">${right}</div></div></div>`;
  return html`
    <${PageSection} id="ac-signin" num="01" title=${x('secSignIn')} count=${sub} first=${true}>
      <p class="og-lead">${tf.enabled || s.passkeys.count ? x('signInIntroOn') : x('signInIntro')}</p>
      ${s.managed_by ? html`<div class="ac-why poster-box"><b>${t('profile.security.managedTitle')}</b> ${t('profile.security.managedDesc').replace('{name}', s.managed_by.name)}</div>` : null}
      <div class="ac-rows">
        ${row(x('row.password'), s.has_password ? x('row.passwordSet') : x('row.passwordNone'), html`<span class=${`poster-status ${s.has_password ? 'poster-status--fine' : 'poster-status--attention'}`}>${s.has_password ? x('inUse') : x('none')}</span>`)}
        ${!s.managed_by && s.passkeys.available ? html`
          ${row(x('row.passkeys'), s.passkeys.count ? x('row.passkeysN', { n: s.passkeys.count }) : x('row.passkeysNone'), html`<span class=${`poster-status ${s.passkeys.count ? 'poster-status--fine' : 'poster-status--attention'}`}>${x('devicesN', { n: s.passkeys.count })}</span>`, 'is-open')}
          <div class="ac-panel"><${PasskeysSection} showToast=${ctx.showToast} /></div>` : null}
        ${!s.managed_by && tf.available ? html`
          ${row(x('row.twoStep'), tf.enabled ? x('row.twoStepOn', { n: tf.backup_codes_left }) : tf.pending ? x('row.twoStepPending') : x('row.twoStepOff'), html`<span class=${`poster-status ${tf.enabled ? 'poster-status--fine' : 'poster-status--attention'}`}>${tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort')}</span>`, 'is-open')}
          <div class="ac-panel"><${TwoFactorSection} twoFactor=${tf} managed=${!!s.managed_by} showToast=${ctx.showToast} onChanged=${() => ctx.load()} /></div>` : null}
        ${row(x('row.sessions'), x('row.sessionsSub', { mine: s.sessions.mine.total, agents: s.sessions.agents.total }), html`<span class="ac-n poster-stat-number poster-stat-number--small">${n(s.sessions.mine.total)}</span>${s.sessions.mine.total > 1 ? html`<button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'sessions'} onClick=${() => ctx.signOutOthers()}>${x('doorSignOutOthers')}</button>` : null}`, 'is-open')}
        ${s.sessions.mine.total ? sessionsBlock(ctx) : null}
        ${row(x('row.federation'), ctx.fed.all ? x('row.federationAll') : ctx.fed.nodes.length ? x('row.federationList', { n: ctx.fed.nodes.length }) : x('row.federationNone'), html`<span class="poster-chip">${ctx.fed.all ? x('fed.allChip') : x('fed.listChip', { n: ctx.fed.nodes.length })}</span><button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'fed'} onClick=${() => ctx.toggleFedAll()}>${ctx.fed.all ? x('fed.restrict') : x('fed.allowAll')}</button>`, 'is-open')}
        ${federationBlock(ctx)}
        ${row(x('row.recovery'), ctx.ownerKey ? x('row.recoveryHere') : x('row.recoveryNotHere'), ctx.ownerKey ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setKeyShown(!ctx.keyShown)}>${ctx.keyShown ? x('hide') : x('show')}</button><${CopyButton} className="poster-action poster-action--small" text=${ctx.ownerKey} label=${x('copy')} onCopied=${() => ctx.showToast(x('keyCopied'))} />` : html`<span class="poster-status poster-status--off">${x('notHere')}</span>`, ctx.ownerKey ? 'is-open' : '')}
        ${ctx.ownerKey ? html`<div class="ac-keybox poster-box"><div><b>${x('recovery.title')}</b> ${x('recovery.body')}<br /><code class=${ctx.keyShown ? 'is-shown' : ''}>${ctx.ownerKey}</code></div></div>` : null}
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
    <${PageSection} id="ac-keys" num="02" title=${x('secKeys')} count=${x('secKeysSub', { apps: ov.appGrants.total, tokens: ov.accessTokens.total })}>
      <p class="og-lead">${x('keysIntro')}</p>
      ${all.length ? html`
        <div class="ac-filters">
          ${FILTERS.map((f) => html`<button type="button" key=${f} class=${`poster-tab poster-tab--filter ${ctx.filter === f ? 'is-on' : f === 'unused' && counts[f] ? 'poster-tab--attention' : ''}`} onClick=${() => ctx.setFilter(f)}>${x('filter.' + f, { days: 30 })} · ${counts[f]}</button>`)}
        </div>
        <div class="listing listing--name-desc-when-doors">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('col.who')}</div><div class="poster-label">${x('col.may')}</div><div class="poster-label">${x('col.last')}</div><div class="poster-label"></div></div>
          ${shown.map((r) => keyRow(ctx, r))}
        </div>
        ${list.length > shown.length || unused ? html`<div class="ac-more">
          ${list.length > shown.length ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.showMoreKeys()}>${x('moreKeys', { n: list.length - shown.length })}</button>` : null}
          ${unused ? html`<button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" disabled=${ctx.busy === 'unused'} onClick=${() => ctx.revokeUnused()}>${x('revokeUnused', { n: unused, days: 30 })}</button>` : null}
        </div>` : null}
        ${ctx.baseHolders ? html`<div class="ac-why poster-box"><b>${x('whyBaseTitle')}</b> ${x('whyBase', { n: ctx.baseHolders, total: ov.appGrants.total })} ${ov.base_package.map(scopeSentence).join('; ')}.</div>` : null}`
      : html`<p class="poster-quiet ac-empty"><b>${x('keysEmptyTitle')}</b> ${x('keysEmptyBody')}</p>`}
      ${tokenFold(ctx)}
    <//>`;
}

function opt(ctx, field, value, label, cls = '') {
  return html`<button type="button" class=${`poster-tab poster-tab--tile ${ctx.form[field] === value ? 'is-on' : ''} ${cls}`} onClick=${() => ctx.setForm({ [field]: value })}>${label}</button>`;
}

function tokenFold(ctx) {
  const f = ctx.form;
  const scoped = f.level === 'scoped';
  const chosen = Object.keys(f.scopes).filter((s) => f.scopes[s]);
  const ready = !!f.label.trim() && (!scoped || chosen.length > 0);
  const created = ctx.created;
  return html`
    <div class="ac-form-gap">
    <${FoldSection} id="ac-token" num="" title=${x('form.title')} sub=${created ? x('form.subCreated') : ''} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      ${created ? html`
        <div class="ac-open ac-token-created">
          <span class="poster-label">${x('created.title')}</span>
          <p class="og-lead">${x('created.once')}</p>
          <div class="ac-token code-block"><code class="code-inline">${created.token}</code><${CopyButton} className="poster-action poster-action--small" text=${created.token} label=${x('copy')} onCopied=${() => ctx.showToast(x('created.copied'))} /></div>
          <div class="listing listing--name-state"><div class="listing-row is-open"><div class="listing-name"><b>${x('created.prompt')}</b><small>${x('created.promptSub')}</small></div><div class="listing-doors"><${CopyButton} className="poster-action poster-action--small poster-action--row" text=${created.prompt} label=${x('created.copyPrompt')} onCopied=${() => ctx.showToast(x('created.promptCopied'))} /></div></div></div>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.clearCreated()}>${x('created.done')}</button></div>
        </div>` : null}
      <p class="og-lead">${x('form.intro')}</p>
      <div class="ac-form">
        <span class="poster-label">${x('form.name')}</span>
        <div><input class="og-input" type="text" maxlength="120" value=${f.label} placeholder=${x('form.namePlaceholder')} onInput=${(e) => ctx.setForm({ label: e.target.value })} /><${Hint}>${x('form.nameHint')}<//></div>
        <span class="poster-label">${x('form.level')}</span>
        <div>
          <div class="ac-opts">${opt(ctx, 'level', 'scoped', x('level.scopedOpt'))}${opt(ctx, 'level', 'owner', x('level.ownerOpt'), 'poster-tab--attention')}${ctx.isOperator ? opt(ctx, 'level', 'operator', x('level.operatorOpt'), 'poster-tab--attention') : null}</div>
          ${scoped ? html`<div class="ac-opts">${ctx.tokenScopes.map((s) => html`<button type="button" key=${s} class=${`poster-tab poster-tab--tile ${f.scopes[s] ? 'is-on' : ''}`} onClick=${() => ctx.toggleScope(s)}>${scopeSentence(s)}</button>`)}</div>` : null}
          <${Hint}>${scoped ? x('form.levelHintScoped') : f.level === 'owner' ? x('level.ownerText') : x('level.operatorText')}<//>
        </div>
        <span class="poster-label">${x('form.expiry')}</span>
        <div>
          <div class="ac-opts">${opt(ctx, 'expiry', '86400', x('expiry.day'))}${opt(ctx, 'expiry', '604800', x('expiry.week'))}${opt(ctx, 'expiry', '2592000', x('expiry.month'))}${opt(ctx, 'expiry', '', x('expiry.never'), 'poster-tab--attention')}</div>
          <${Hint}>${x('form.expiryHint')}<//>
        </div>
        <span></span>
        <div class="ac-submit">
          <button type="button" class="poster-slab poster-slab--control" disabled=${!ready || ctx.busy === 'token'} onClick=${() => ctx.createToken()}>${ctx.busy === 'token' ? x('form.making') : x('form.make')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleForm(false)}>${x('cancel')}</button>
          ${msg(ctx.formMsg)}
        </div>
      </div>
    <//>
    </div>`;
}

/* ── 03, 04 and 06: the sections that keep their components ──────────────────────────────────── */

function secAccounts(ctx) {
  const c = ctx.ov.connections;
  const count = c?.connections?.length || 0;
  return html`
    <${PageSection} id="ac-accounts" num="03" title=${x('secAccounts')} count=${c?.enabled ? x('secAccountsSub', { n: count, providers: c.providers.length }) : x('secAccountsOff')}>
      <p class="og-lead">${x('accountsIntro')}</p>
      ${c?.enabled ? html`<div class="ac-kept"><${ConnectionsSection} showToast=${ctx.showToast} /></div>` : html`<p class="poster-quiet ac-empty">${x('accountsOffBody')}</p>`}
    <//>`;
}

/* ── 04: the MCP servers ─────────────────────────────────────────────────────────────────────── */

/**
 * The MCP servers this person attached, in a section of their own. They sat under "Your accounts at
 * other services" until 2026-09-16, which on a server without outside accounts put them directly
 * under "not enabled on this server", and the kept-component rule hid their own title. An MCP server
 * is a set of tools, not an account, and it does not follow the accounts switch, so it gets its own
 * number, title and count. The section supplies the title and intro; `.ac-kept` hides the panel's own.
 */
function secMcp(ctx) {
  return html`
    <${PageSection} id="ac-mcp" num="04" title=${x('secMcp')} count=${ctx.mcpCount == null ? '' : x('secMcpSub', { n: ctx.mcpCount })}>
      <p class="og-lead">${x('mcpIntro')}</p>
      <div class="ac-kept ac-mcp"><${McpServersSection} showToast=${ctx.showToast} /></div>
    <//>`;
}

/* ── 05: the vault ────────────────────────────────────────────────────────────────────────────── */

/**
 * The secrets, and the one thing this section can never do: show a value. The list carries the
 * name, when it was set, when it was last replaced and what names it; the value goes in once and
 * is not read back by this page, by an app or by an agent.
 */
function secSecrets(ctx) {
  const list = ctx.secrets || [];
  return html`
    <${PageSection} id="ac-secrets" num="05" title=${x('secSecrets')} count=${x('secSecretsSub', { n: list.length })}>
      <p class="og-lead">${x('secretsIntro')}</p>
      ${ctx.secretsFailed ? html`<p class="poster-quiet ac-empty">${x('secrets.loadFailed')}</p>` : null}
      ${list.length ? html`
        <div class="listing listing--name-who-when-doors ac-secrets">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('secrets.colName')}</div><div class="poster-label">${x('secrets.colUsedBy')}</div><div class="poster-label">${x('secrets.colSet')}</div><div class="poster-label"></div></div>
          ${list.map((s) => secretRow(ctx, s))}
        </div>`
      : (!ctx.secretsFailed ? html`<p class="poster-quiet ac-empty"><b>${x('secrets.emptyTitle')}</b> ${x('secrets.emptyBody')}</p>` : null)}
      <div class="ac-why poster-box"><b>${x('secrets.whoTitle')}</b> ${x('secretsWho')}</div>
      ${secretFold(ctx)}
    <//>`;
}

/** The add form: a name and a write-only value, and nothing that reads one back. */
function secretFold(ctx) {
  const f = ctx.secretForm;
  const ready = !!f.name.trim() && !!f.value;
  return html`
    <div class="ac-form-gap">
    <${FoldSection} id="ac-secret-add" num="" title=${x('secrets.addTitle')} open=${f.open} onToggle=${() => ctx.toggleSecretForm()}>
      <div class="ac-form">
        <span class="poster-label">${x('secrets.name')}</span>
        <div><input class="og-input" type="text" maxlength="64" autocomplete="off" spellcheck="false" value=${f.name} placeholder=${x('secrets.namePlaceholder')} onInput=${(e) => ctx.setSecretForm({ name: e.target.value })} /><${Hint}>${x('secrets.nameHint')}<//></div>
        <span class="poster-label">${x('secrets.value')}</span>
        <div><input class="og-input" type="password" autocomplete="new-password" spellcheck="false" value=${f.value} placeholder=${x('secrets.valuePlaceholder')} onInput=${(e) => ctx.setSecretForm({ value: e.target.value })} /><${Hint}>${x('secrets.valueHint')}<//></div>
        <span></span>
        <div class="ac-submit">
          <button type="button" class="poster-slab poster-slab--control" disabled=${!ready || ctx.busy === 'secret:' + f.name.trim()} onClick=${() => ctx.writeSecret(f.name.trim(), f.value, false)}>${ctx.busy === 'secret:' + f.name.trim() ? x('secrets.saving') : x('secrets.save')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggleSecretForm(false)}>${x('cancel')}</button>
          ${msg(ctx.secretMsg)}
        </div>
      </div>
    <//>
    </div>`;
}

/* ── 06 ───────────────────────────────────────────────────────────────────────────────────────── */

function secGroups(ctx) {
  const groups = ctx.ov.groups?.groups || [];
  return html`
    <${PageSection} id="ac-groups" num="06" title=${x('secGroups')} count=${x('secGroupsSub', { n: groups.length })}>
      <p class="og-lead">${x('groupsIntro')}</p>
      <div class="ac-kept">
        <${SharingGroupsSection} showToast=${ctx.showToast} initial=${ctx.ov.groups} />
        <${SharesIncomingSection} />
      </div>
    <//>`;
}

/* ── 07 ───────────────────────────────────────────────────────────────────────────────────────── */

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
    <${PageSection} id="ac-addresses" num="07" title=${x('secAddresses')} count=${x('secAddressesSub')}>
      <p class="og-lead">${x('addressesIntro')}</p>
      <div class="facts">
        ${rows.map(([k, v, sub]) => html`
          <div class="facts-k poster-label" key=${'k' + k}>${x('addr.' + k)}</div>
          <div class="facts-v" key=${'v' + k}>${v ? html`<code class="code-inline">${v}</code>` : null}<small>${sub}</small>${v ? html`<${CopyButton} className="poster-action poster-action--small" text=${v} label=${x('copy')} onCopied=${() => ctx.showToast(x('copied'))} />` : null}</div>`)}
        <div class="facts-k poster-label">${x('addr.session')}</div>
        <div class="facts-v">${cur ? x('addr.sessionValue', { date: dateWord(cur.expires_at), days: days ?? '' }) : x('addr.sessionNone')}<small>${x('addr.sessionSub')}</small></div>
      </div>
    <//>`;
}

/* ── 08 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${PageSection} id="ac-roads" num="08" title=${x('secRoads')}>
      <div class="ac-roads">
        <div class="ac-road poster-box poster-box--raised">
          <span class="poster-label">${x('roadAskTitle')}</span>
          <p>${x('roadAskBody')}</p>
          <pre class="code-block">${ask}</pre>
          <div class="og-doors"><${CopyButton} className="poster-action poster-action--small poster-action--lower" text=${ask} label=${x('copyPrompt')} /></div>
        </div>
        <div class="ac-road poster-box">
          <span class="poster-label">${x('roadAgentTitle')}</span>
          <p>${x('roadAgentBody')}</p>
          <small>aimeat_access_list · aimeat_connection_list · aimeat_group_list · aimeat_consent_list · ${x('roadAgentScope')}</small>
        </div>
      </div>
    <//>`;
}
