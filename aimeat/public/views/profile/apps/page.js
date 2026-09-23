/**
 * @file public/views/profile/apps/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Apps page in the poster face (design canvas "AIMEAT Sovellukset-sivu",
 *   direction A): the mast and the strip; what waits for the owner (drafts to publish or discard,
 *   with the lines they change, and the apps acting in the owner's name, with their permissions);
 *   the condition rows, each a number that opens the launcher on exactly those apps; the six apps
 *   that changed last; then the agents-and-skills and build-new sections from build.js; and the
 *   rail. A person with no apps yet gets the same page with the first step on top. Pure render
 *   over the ctx bag.
 * @structure renderPage · secWaiting · secKunto · secNewest · secFirst
 * @usage import { renderPage } from './apps/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Page, Rail, a plain NumeralBand strip,
 *     ListRow for a draft, a grant, a condition and an app (its initials a Chip), Surface asides for
 *     the diff and the permissions; no own CSS. The newest table's column heads are gone: each row
 *     says what it is in its own words.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.3.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-09-02 — Initial.
 *   v1.2.0 — 2026-09-08 — The builders section: who else may build these apps.
 *   v1.1.0 — 2026-09-03 — A newest row says what the app needs (requiresLine): the cortexes it loads and the extensions it calls, with a pinned version after the at sign.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { num as fmtNum } from '/js/format.js';
import { Page, Rail, Section, Stack, ListRow, NumeralBand, Action, CopyAction, Chip, Text, Surface, scrollToId } from '/components/poster-parts.js';
import { a, day, rel, kb, nameOf, appRef, appUrl, catalogUrl, noteFor, initials, crumb, pageLinks, goTab } from './frame.js';
import { secAgents, secBuild } from './build.js';
import { CollaborationSection, PublishDialog } from './collaboration.js';
import { secBuilders } from './builders.js';

export function renderPage(ctx) {
  const apps = ctx.apps || [];
  const loading = ctx.apps === null;
  const none = !loading && apps.length === 0;
  const drafts = apps.filter((x) => x.has_draft);
  const grants = ctx.grants || [];
  const waiting = drafts.length + grants.length;
  const listed = apps.filter((x) => !x.parked && !x.operator_hidden).length;
  const opens = apps.reduce((s, x) => s + (x.downloads || 0), 0);
  const top = [...apps].sort((p, q) => (q.downloads || 0) - (p.downloads || 0)).slice(0, 2);
  const fmt = (n) => fmtNum(n);

  const strip = html`<${NumeralBand} tone="plain" items=${none ? [
    { label: a('stripApps'), value: 0, note: a('stripNone') },
    { label: a('stripDrafts'), value: 0, note: a('stripNone') },
    { label: a('stripOpens'), value: 0, note: a('stripNone') },
    { label: a('stripCommunity'), value: ctx.community, note: a('stripCommunitySub', { n: ctx.communityOwners }) },
  ] : [
    { label: a('stripApps'), value: apps.length, note: a('stripAppsSub', { listed, unlisted: apps.length - listed }) },
    { label: a('stripDrafts'), value: drafts.length, tone: drafts.length ? 'coral' : undefined, note: drafts.length ? drafts.map(nameOf).slice(0, 2).join(' · ') : a('stripDraftsNone') },
    { label: a('stripOpens'), value: fmt(opens), note: top.length ? top.map((x) => `${nameOf(x)} ${fmt(x.downloads || 0)}`).join(' · ') : a('stripNone') },
    { label: a('stripGrants'), value: grants.length, note: grants.length ? grants.map((g) => g.app_name || g.app).slice(0, 2).join(' · ') : a('stripGrantsNone') },
  ]} />`;

  const entries = none
    ? [{ href: '#ap-first', label: a('secFirst') }, { href: '#ap-waiting', label: a('secWaiting'), count: 0 }, { href: '#ap-kunto', label: a('secKunto') }, { href: '#ap-build', label: a('uploadLabel') }]
    : [{ href: '#ap-waiting', label: a('secWaiting'), count: waiting }, { href: '#ap-kunto', label: a('secKunto') }, { href: '#ap-newest', label: a('secNewest'), count: Math.min(apps.length, 6) },
      { href: '#ap-agents', label: a('secAgents') }, { href: '#ap-build', label: a('secBuild') }, { href: '#ap-builders', label: a('secBuilders') }];

  const identity = html`<${Stack} density="compact">
    <${Text} kind="label">${a('titleSub')}<//>
    <${Stack} direction="wrap" density="compact">
      ${none ? html`<${Chip} tone="coral">${a('chipNone')}<//>` : html`<${Chip}>${a('chipCount', { n: apps.length })}<//>`}
      ${none ? html`<${Chip} tone="muted">${a('chipFirst')}<//>` : drafts.length ? html`<${Chip} tone="coral">${a('chipDrafts', { n: drafts.length })}<//>` : null}
      ${none ? null : html`<${Chip} tone="muted">${a('chipOpens', { n: fmt(opens) })}<//>`}
    <//>
  <//>`;
  const actions = none
    ? html`<${CopyAction} kind="primary" text=${ctx.buildPrompt} label=${a('promptDoor')} copiedLabel=${a('promptCopied')} disabled=${!ctx.buildPrompt} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />
      <${Action} onClick=${() => scrollToId('ap-build')}>${a('uploadDoor')}<//>
      <${Action} href=${catalogUrl()} target="_blank">${a('catalogDoor')}<//>`
    : html`<${Action} kind="primary" href=${catalogUrl()} target="_blank">${a('catalogDoor')}<//>
      <${Action} onClick=${() => scrollToId('ap-build')}>${a('uploadDoor')}<//>`;
  const rail = html`<${Rail} kind="index" title=${a('railTitle')} entries=${entries}>${pageLinks()}<//>`;

  return html`<${Page} width="wide" title=${t('profile.tabs.apps')} crumbs=${crumb()} identity=${identity} actions=${actions} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${none ? a('descEmpty') : a('desc')}<//>
      ${strip}
      ${none ? html`${secFirst(ctx)}${secWaiting(ctx, drafts, grants)}${secKunto(ctx)}${secBuild(ctx, { formOnly: true })}`
        : loading ? html`<${Text} tone="muted">${t('common.loading')}<//>`
        : html`${secWaiting(ctx, drafts, grants)}${secKunto(ctx)}${secNewest(ctx, apps)}${secAgents(ctx)}${secBuild(ctx, { formOnly: false })}${secBuilders(ctx)}`}
      ${!loading ? html`<${CollaborationSection} ctx=${ctx} />` : null}
    <//>
    <${ctx.ConfirmUI} />
    ${ctx.publishApp ? html`<${PublishDialog} key=${appRef(ctx.publishApp)} app=${ctx.publishApp} busy=${!!ctx.busy} onPublish=${ctx.submitPublish} onClose=${ctx.closePublish} />` : null}
  <//>`;
}

/* ── 01 · What waits for you ─────────────────────────────────────────────────────────────────── */

function secWaiting(ctx, drafts, grants) {
  const waiting = drafts.length + grants.length;
  return html`
    <${Section} id="ap-waiting" title=${a('secWaiting')} count=${waiting}>
      <${Stack}>
        ${!waiting ? html`<${Text} tone="muted">${ctx.apps && ctx.apps.length ? a('waitingEmpty') : a('waitingEmptyNew')}<//>` : html`
          <${Stack} density="compact">
            ${drafts.map((app) => draftRow(ctx, app))}
            ${grants.map((g) => grantRow(ctx, g))}
          <//>`}
        <${Text} kind="caption" tone="muted">${a('waitingHint')}<//>
      <//>
    <//>`;
}

function draftRow(ctx, app) {
  const ref = appRef(app);
  const open = ctx.diff && ctx.diff.ref === ref;
  const busy = ctx.busy === ref;
  return html`<${ListRow} key=${'d' + ref} name=${nameOf(app)}
    detail=${a('draftMeta', { version: app.manifest?.version || '', date: day(app.created_at), opens: app.downloads || 0 })}
    actions=${html`<${Chip} tone="coral">${a('draftChip')}<//>
      <${Action} disabled=${busy} onClick=${() => ctx.publishDraft(app)}>${a('publishDraft')}<//>
      <${Action} expanded=${!!open} onClick=${() => ctx.toggleDiff(app)}>${open ? a('hideChanges') : a('viewChanges')}<//>
      <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.discardDraft(app)}>${a('discardDraft')}<//>`}>
    ${open ? diffPanel(ctx.diff) : null}
  <//>`;
}

function diffPanel(diff) {
  if (diff.state === 'loading') return html`<${Surface} kind="aside"><${Text} tone="muted">${a('diffLoading')}<//><//>`;
  if (diff.state === 'failed') return html`<${Surface} kind="aside"><${Text} tone="muted">${a('diffFailed')}<//><//>`;
  const d = diff.result;
  return html`
    <${Surface} kind="aside">
      <${Stack} density="compact">
        <${Text}><strong>${d.addedTotal || d.removedTotal ? a('diffTitle', { added: d.addedTotal, removed: d.removedTotal }) : a('diffNone')}</strong><//>
        ${d.added.length ? html`<${Text} kind="label">${a('diffAdded')}<//><${Surface} kind="code" tone="success">${d.added.join('\n')}<//>` : null}
        ${d.removed.length ? html`<${Text} kind="label">${a('diffRemoved')}<//><${Surface} kind="code" tone="danger">${d.removed.join('\n')}<//>` : null}
      <//>
    <//>`;
}

function grantRow(ctx, g) {
  const open = ctx.openScopes === g.grant_id;
  const busy = ctx.busy === g.grant_id;
  return html`<${ListRow} key=${'g' + g.grant_id} name=${g.app_name || g.app}
    detail=${a('grantMeta', { n: (g.scopes || []).length, granted: day(g.granted_at), used: g.last_used_at ? rel(g.last_used_at) : a('grantNever') })}
    actions=${html`<${Chip} tone="sun">${a('grantChip')}<//>
      <${Action} expanded=${open} onClick=${() => ctx.toggleScopes(g)}>${open ? a('hideScopes') : a('viewScopes')}<//>
      <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.revokeGrant(g)}>${a('revokeGrant')}<//>`}>
    ${open ? html`<${Surface} kind="aside"><${Stack} density="compact">
      <${Text}><strong>${a('scopesLead', { origin: g.app_origin || g.app })}</strong><//>
      <${Stack} direction="wrap" density="compact">${(g.scopes || []).map((s) => html`<${Chip} key=${s}>${s}<//>`)}<//>
    <//><//>` : null}
  <//>`;
}

/* ── 02 · Condition ───────────────────────────────────────────────────────────────────────────── */

function secKunto(ctx) {
  const k = ctx.kunto;
  const facts = k?.facts || {};
  const sub = (key) => {
    if (key === 'noAi') return a('kunto.noAi.why', { uses: facts.usesAi || 0, discloses: facts.discloses || 0 });
    if (key === 'specOff') return a('kunto.specOff.why', { missing: facts.specMissing || 0, stale: facts.specStale || 0 });
    if (key === 'seoOff') return a('kunto.seoOff.why', { found: facts.seoOn || 0, unlisted: facts.unlisted || 0 });
    if (key === 'noSkill') return a('kunto.noSkill.why', { apps: facts.withSkill || 0, skills: facts.skills || 0 });
    return a('kunto.' + key + '.why');
  };
  const has = ctx.apps && ctx.apps.length;
  const actions = has
    ? html`<${CopyAction} text=${ctx.managePrompt()} label=${a('manageDoor')} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />`
    : null;
  return html`
    <${Section} id="ap-kunto" title=${a('secKunto')} count=${has ? a('secKuntoSub', { n: ctx.apps.length }) : null} actions=${actions}>
      <${Stack}>
        ${!has ? html`<${Text} tone="muted">${a('kuntoEmptyNew')}<//>`
          : !k.rows.length ? html`<${Text}><strong>${a('kuntoAllGood')}</strong><//>` : html`
          <${Stack} density="compact">
            ${k.rows.map((r) => html`<${ListRow} key=${r.key} density="compact" detailKind="text"
              mark=${html`<${Text} kind="number" size="small" tone=${r.loud ? 'coral' : 'plain'}>${r.n}<//>`}
              name=${a('kunto.' + r.key + '.what')} detail=${sub(r.key)}
              actions=${html`<${Action} href=${catalogUrl({ filter: r.key })} target="_blank">${a('kuntoShow', { n: r.n })}<//>`} />`)}
          <//>`}
        <${Text} kind="caption" tone="muted">${a('kuntoHint')}<//>
      <//>
    <//>`;
}

/* ── 03 · Last changed ────────────────────────────────────────────────────────────────────────── */

function secNewest(ctx, apps) {
  const rows = [...apps].sort((p, q) => String(q.created_at || '').localeCompare(String(p.created_at || ''))).slice(0, 6);
  const grantRefs = new Set((ctx.grants || []).map((g) => g.app));
  const actions = html`<${Action} href=${catalogUrl()} target="_blank">${a('allInCatalog', { n: apps.length })}<//>`;
  return html`
    <${Section} id="ap-newest" title=${a('secNewest')} count=${rows.length} actions=${actions}>
      <${Stack}>
        <${Stack} density="compact">
          ${rows.map((app) => {
            const ref = appRef(app);
            const flags = ctx.kunto?.flags?.[ref] || {};
            const legal = app.manifest?.legal ? Object.keys(app.manifest.legal).length : 0;
            const desc = app.manifest?.descriptions?.[getLocale()] || app.manifest?.description || '';
            return html`<${ListRow} key=${ref} mark=${html`<${Chip}>${initials(nameOf(app))}<//>`}
              name=${nameOf(app)} detail=${a('rowMeta', { version: app.manifest?.version || '', n: app.version_number || 1, date: day(app.created_at), size: kb(app.size) })}
              value=${html`<${Stack} density="compact"><${Text} kind="number" size="small">${app.downloads || 0}<//><${Text} kind="caption">${a('colOpens')}<//><//>`}
              actions=${html`<${Action} href=${appUrl(app)} target="_blank" onClick=${() => ctx.recordOpen(app)}>${a('open')}<//>
                <${Action} kind="text" href=${catalogUrl({ q: nameOf(app) })} target="_blank">${a('inCatalog')}<//>`}>
              <${Stack} density="compact">
                ${desc ? html`<${Text}>${desc}<//>` : null}
                ${requiresLine(app)}
                <${Text} kind="caption" tone="coral">${noteFor(app, flags, grantRefs, legal)}<//>
              <//>
            <//>`;
          })}
        <//>
        <${Text} kind="caption" tone="muted">${a('newestHint')}<//>
      <//>
    <//>`;
}

/**
 * What the app loads and calls, from the dependency map the list carries: the cortexes and
 * extensions by name, with the version when the app pinned one.
 */
function requiresLine(app) {
  const r = app.requires;
  if (!r) return null;
  const names = [...(r.cortex || []), ...(r.extensions || [])].map((d) => d.pinned ? `${d.name}@${d.pinned}` : d.name);
  if (!names.length) return null;
  return html`<${Text} kind="mono" tone="muted">${a('requires', { list: names.join(' · ') })}<//>`;
}

/* ── The first step, when there is nothing yet ────────────────────────────────────────────────── */

function secFirst(ctx) {
  return html`
    <${Section} id="ap-first" title=${a('secFirst')}>
      <${Stack}>
        <${Text}><strong>${a('firstHead')}</strong> ${a('firstBody')}<//>
        <${Stack} direction="wrap">
          <${Action} href="/v1/aimeat-os" target="_blank">${a('guideDoor')}<//>
          <${Action} href=${catalogUrl()} target="_blank">${a('communityDoor', { n: ctx.community })}<//>
          <${Action} onClick=${() => goTab('appdev')}>${a('appdevDoor')}<//>
        <//>
      <//>
    <//>`;
}
