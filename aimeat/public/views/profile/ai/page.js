/**
 * @file public/views/profile/ai/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI page in the poster face: which model answers, on whose key, within what
 *   daily budget. The mast and the strip say who pays and what it has cost; then 01 the connection
 *   (the provider, the key, a real test), 02 the six model roles as rows, 03 the budget and what
 *   spent it (the daily figure in words, the apps that spent most with the cap written on the row,
 *   the 30-day chart), 04 fine-tuning in words, 05 what consumes the key. Pure render over the ctx
 *   bag; the rows are rows.js.
 * @structure renderPage · mast · strip · secConnection · secModels · secBudget · secParams ·
 *   secConsumers
 * @usage import { renderPage } from './ai/page.js';
 * @version-history
 *   v1.25.0 -- 2026-09-26 -- The provider's radio dots and the retry check box carry the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.24.0 -- 2026-09-26 -- The figure on the budget bar is the Meter's figure (.poster-meter-figure), the Wallet meter's look (a unification: the lead's ruling on a figure written on a meter).
 *   v1.23.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.22.0 -- 2026-09-26 -- The last loading line here carries the Loading mark, only while it says loading (a unification: the look most tabs use).
 *   v1.21.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.20.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.19.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-25 -- The budget bar is the quota meter (.poster-box--meter.poster-box--quota, is-full from 90 %), as Memory's storage and the overview draw theirs, a unification.
 *   v1.17.0 -- 2026-09-25 -- The line under a list with its count is the More line (css/components/more-line.css), a unification: the look most tabs use.
 *   v1.16.0 -- 2026-09-25 -- A field and its button in a dashed row are the library's Field row (css/components/field-row.css), moved unchanged under one name (UI consolidation phase 5, a move).
 *   v1.15.0 -- 2026-09-25 -- The connection, the budget, the fine-tuning and the consumers are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-25 -- The model roles and the spend table are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.11.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.10.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-09 — A reasoning row in the parameters section: model default, off, or an
 *     effort level, beside the retry row whose promise the server now keeps.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { scrollTo } from '/views/profile/organisms/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { x, ROLES, money, compact, dateWord, crumb, pageLinks } from './frame.js';
import { roleRow, appRow } from './rows.js';
import { Hint } from '/components/Hint.js';

const SHOWN = 8;
const chip = (text, cls = '') => html`<span class=${`poster-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`form-message ${m.error ? 'form-message--error' : ''}`}>${m.text}</small>` : null);

export function renderPage(ctx) {
  const s = ctx.settings;
  const loading = !s;
  const chosen = ROLES.filter((r) => s?.[r.field]).length;
  const rail = [
    ['01', 'ai-connection', x('secConnection'), ''],
    ['02', 'ai-models', x('secModels'), s ? `${chosen} / ${ROLES.length}` : ''],
    ['03', 'ai-budget', x('secBudget'), ctx.usage ? x('perDayShort', { n: money(ctx.usage.daily_budget_usd) }) : ''],
    ['04', 'ai-params', x('secParams'), ''],
    ['05', 'ai-consumers', x('secConsumers'), ''],
  ];
  return html`
    <div class="og og-ai">
      ${crumb()}
      ${mast(ctx)}
      ${strip(ctx)}
      <div class="og-grid">
        <div class="og-main">
          ${loading ? html`<p class="poster-quiet ai-empty loading-mark">${x('loading')}</p>` : html`
            ${secConnection(ctx)}
            ${secModels(ctx, chosen)}
            ${secBudget(ctx)}
            ${secParams(ctx)}
            ${secConsumers(ctx)}`}
        </div>
        <nav class="og-rail" aria-label=${x('railTitle')}>
          <span class="og-rail-label">${x('railTitle')}</span>
          ${rail.map(([n, id, label, count]) => html`<button type="button" class="og-rail-link" key=${id} onClick=${() => scrollTo(id)}><i>${n}</i>${label}<em>${count}</em></button>`)}
          <hr />
          <span class="og-rail-label">${x('pages')}</span>
          ${pageLinks(ctx.navigate)}
        </nav>
      </div>
      <${ctx.ConfirmUI} />
    </div>`;
}

function mast(ctx) {
  const s = ctx.settings;
  const keyed = ctx.keyed;
  const chips = !s ? [] : keyed
    ? [chip(s.provider === 'openrouter' ? x('chipOwnKey') : x('chipOwnProvider'), 'poster-chip--sun'), chip(x('provider.' + (s.provider || 'openrouter'))), ctx.models.length ? chip(x('chipModels', { n: ctx.models.length })) : null, ctx.usage ? chip(x('chipBudget', { n: money(ctx.usage.daily_budget_usd) })) : null]
    : [chip(x('chipNoKey'), 'poster-chip--coral'), ctx.chat && ctx.chat.allowance_remaining_usd > 0 ? chip(x('chipHouseKey', { host: ctx.host, n: money(ctx.chat.allowance_remaining_usd) })) : null, chip(x('provider.openrouter'))];
  const desc = !s ? '' : keyed ? x('desc', { host: ctx.host }) : x('descNoKey', { host: ctx.host, n: money(ctx.chat?.allowance_remaining_usd || 0) });
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title poster-page-title">${t('profile.generator.openrouter.title')}<small>${x('titleSub')}</small></h1>
        <div class="poster-chips">${chips}</div>
        <p class="og-desc">${desc}</p>
      </div>
      <div class="og-mast-actions">
        ${keyed
          ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}</button>`
          : html`<a class="poster-slab" href="https://openrouter.ai/keys" target="_blank" rel="noopener">${x('getKey')}</a>`}
        <div class="og-doors">
          ${keyed ? html`<a class="poster-action poster-action--small" href="https://openrouter.ai/keys" target="_blank" rel="noopener">${x('getKeyShort')}</a>` : null}
          <a class="poster-action poster-action--small poster-action--lower" href="https://openrouter.ai/credits" target="_blank" rel="noopener">${x('credits')}</a>
        </div>
      </div>
    </div>`;
}

function strip(ctx) {
  const s = ctx.settings;
  const u = ctx.usage;
  const r = ctx.roll;
  if (!s) return html`<div class="og-strip"><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div><div><b>…</b></div></div>`;
  const chosen = ROLES.filter((role) => s[role.field]);
  const payer = ctx.keyed ? x('stripOwnKey') : ctx.host;
  return html`
    <div class="og-strip">
      <div><b class="og-strip-coral">${payer}</b><span>${x('stripPays')}</span><small>${ctx.keyed ? x('stripPaysSub', { provider: x('provider.' + (s.provider || 'openrouter')), host: ctx.host }) : (ctx.chat ? x('stripAllowance', { n: money(ctx.chat.allowance_remaining_usd || 0) }) : '')}</small></div>
      <div><b>${u ? money(u.spent_today_usd) : '…'}</b><span>${x('stripToday')}</span><small>${u ? x('stripTodaySub', { n: money(u.daily_budget_usd) }) : ''}</small></div>
      <div><b>${r ? money(r.cost) : '…'}</b><span>${x('stripMonth')}</span><small>${r ? x('stripMonthSub', { calls: r.calls, apps: r.apps.length }) : ''}</small></div>
      <div><b>${chosen.length} / ${ROLES.length}</b><span>${x('stripRoles')}</span><small>${chosen.length ? chosen.map((role) => x('role.' + role.id).toLowerCase()).join(' · ') : x('stripRolesNone')}</small></div>
    </div>`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConnection(ctx) {
  const s = ctx.settings;
  const d = ctx.conn;   // the draft: provider, baseUrl, apiKey
  const isOr = d.provider === 'openrouter';
  const count = ctx.keyed ? x('secConnectionSub', { provider: x('provider.' + (s.provider || 'openrouter')) }) : x('secConnectionNone');
  return html`
    <${PageSection} id="ai-connection" num="01" title=${x('secConnection')} count=${count} first=${true}>
      <div class="facts">
        <div class="facts-k poster-label">${x('providerLabel')}</div>
        <div class="facts-v">
          <div class="ai-radios">
            ${['openrouter', 'lmstudio', 'custom'].map((p) => html`<label class="ai-radio check-line" key=${p}><input type="radio" name="ai-provider" checked=${d.provider === p} onChange=${() => ctx.setProvider(p)} />${x('providerChoice.' + p)}</label>`)}
          </div>
          ${!isOr ? html`<div class="field-row"><input class="og-input" type="url" value=${d.baseUrl} placeholder="https://…/v1" aria-label=${x('baseUrl')} onInput=${(e) => ctx.setConn({ baseUrl: e.target.value })} /></div>` : null}
          <small>${x('providerHint')}</small>
        </div>
        <div class="facts-k poster-label">${x('keyLabel')}</div>
        <div class="facts-v">
          <div class="field-row">
            <input class="og-input" type="password" autocomplete="off" data-1p-ignore data-lpignore="true" value=${d.apiKey} placeholder=${s.hasApiKey ? x('keyMasked') : 'sk-or-v1-…'} aria-label=${x('keyLabel')} onInput=${(e) => ctx.setConn({ apiKey: e.target.value })} />
            <button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'conn'} onClick=${() => ctx.saveConnection()}>${x('save')}</button>
          </div>
          ${msg(ctx.connMsg)}
          <small>${s.hasApiKey ? x('keyStoredHint') : x('keyHint')}</small>
          ${ctx.keyed ? html`
            <div class="og-doors">
              <button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}</button>
              <button type="button" class="poster-action poster-action--small poster-action--lower" disabled=${ctx.busy === 'models'} onClick=${() => ctx.loadModels()}>${ctx.busy === 'models' ? x('loading') : x('refreshModels')}</button>
              ${s.hasApiKey ? html`<button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" onClick=${() => ctx.removeKey()}>${x('removeKey')}</button>` : null}
            </div>` : null}
        </div>
      </div>
      ${!ctx.keyed ? html`<p class="poster-quiet ai-empty"><b>${x('noKeyLead')}</b> ${x('noKeyBody', { host: ctx.host })}</p>` : null}
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secModels(ctx, chosen) {
  return html`
    <${PageSection} id="ai-models" num="02" title=${x('secModels')} count=${x('secModelsSub', { n: chosen, total: ROLES.length })}>
      ${ctx.modelsError ? html`<small class="form-message form-message--error">${ctx.modelsError}</small>` : null}
      <div class="listing listing--name-who-desc-doors">
        <div class="listing-row listing-row--head"><div class="poster-label">${x('colRole')}</div><div class="poster-label">${x('colModel')}</div><div class="poster-label">${x('colWhat')}</div><div class="poster-label"></div></div>
        ${ROLES.map((role) => roleRow(ctx, role))}
      </div>
      ${msg(ctx.modelsMsg)}
      <${Hint}>${x('hintUnits')}<//>
      <${Hint}>${ctx.keyed ? x('hintModels') : x('hintModelsNoKey')}<//>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function secBudget(ctx) {
  const u = ctx.usage;
  const r = ctx.roll;
  if (!u) return html`<${PageSection} id="ai-budget" num="03" title=${x('secBudget')} count=${null}><p class="poster-quiet ai-empty loading-mark">${x('loading')}</p><//>`;
  const budget = Number(u.daily_budget_usd) || 0;
  const spent = Number(u.spent_today_usd) || 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const perDay = r && r.days ? r.cost / Math.max(1, r.days) : 0;
  const rows = r ? r.apps : [];
  const shown = ctx.showAllApps ? rows : rows.slice(0, SHOWN);
  const editing = ctx.capsEditing;
  const history = ctx.history;
  return html`
    <${PageSection} id="ai-budget" num="03" title=${x('secBudget')} count=${x('secBudgetSub', { n: money(budget), today: money(spent) })}>
      <div class="facts">
        <div class="facts-k poster-label">${x('dailyBudget')}</div>
        <div class="facts-v">
          ${x('dailyBudgetBody', { n: money(budget), today: money(spent) })}
          <small>${x('dailyBudgetSub', { def: money(ctx.aiSettings?.defaults?.daily_budget_usd ?? 1), month: r ? money(r.cost) : money(0), perDay: money(perDay) })}</small>
          <div class=${`ai-bar poster-box poster-box--meter poster-box--quota ${pct >= 90 ? 'is-full' : ''}`}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect width=${pct} height="100" /></svg><span class="poster-meter-figure">${money(spent)} / ${money(budget)} · ${pct} %</span></div>
          ${ctx.budgetEditing ? html`
            <div class="field-row">
              <input class="og-input ai-num" type="number" min="0" max="1000" step="0.10" value=${ctx.budgetDraft} aria-label=${x('dailyBudget')} onInput=${(e) => ctx.setBudgetDraft(e.target.value)} />
              <button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'budget'} onClick=${() => ctx.saveBudget()}>${x('save')}</button>
              <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setBudgetEditing(false)}>${x('cancel')}</button>
            </div>` : html`<div class="og-doors"><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setBudgetEditing(true)}>${x('changeBudget')}</button></div>`}
          ${msg(ctx.budgetMsg)}
        </div>
        <div class="facts-k poster-label">${x('monthLabel')}</div>
        <div class="facts-v">${r && r.days ? x('monthBody', { cost: money(r.cost), calls: r.calls, tokens: compact(r.tokens), apps: r.apps.length, big: r.apps.filter((a) => a.cost >= 0.1).length }) : x('monthNone')}<small>${x('monthSub')}</small></div>
      </div>
      ${rows.length ? html`
        <span class="poster-label ai-spent-label">${x('whatSpent', { shown: shown.length, total: rows.length })}</span>
        <div class="listing listing--cols listing--name-n-n-cap-n ai-apps">
          <div class="listing-row listing-row--head"><div class="poster-label">${x('colApp')}</div><div class="poster-label listing-n">${x('colMonth')}</div><div class="poster-label listing-n">${x('colToday')}</div><div class="poster-label listing-n">${x('colCap')}</div><div class="poster-label listing-n">${x('colCalls')}</div></div>
          ${shown.map((row) => appRow(ctx, row, editing))}
        </div>
        <div class="more-line ai-more">
          ${rows.length > SHOWN ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => ctx.setShowAllApps(!ctx.showAllApps)}>${ctx.showAllApps ? x('showFewer') : x('showAllApps', { n: rows.length })}</button>` : null}
          ${editing
            ? html`<button type="button" class="poster-slab poster-slab--control" disabled=${ctx.busy === 'caps'} onClick=${() => ctx.saveCaps()}>${x('saveCaps')}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setCapsEditing(false)}>${x('cancel')}</button>`
            : html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setCapsEditing(true)}>${x('setCaps')}</button>`}
          <small>${editing ? x('capsEditingHint') : x('capsHint')}</small>
        </div>
        ${msg(ctx.capsMsg)}
        <${Hint}>${x('hintCaps')}<//>` : html`<p class="poster-quiet ai-empty">${x('noSpend')}</p>`}
      ${history && Array.isArray(history.days) && history.days.length ? chart(ctx, history, r) : null}
    <//>`;
}

function chart(ctx, history, r) {
  const labels = history.days.map((d) => dateWord(d.date));
  const apps = history.apps || [];
  const metric = ctx.metric;
  const pick = (m) => (metric === 'tokens' ? m.tokens : metric === 'seconds' ? m.audio_seconds : m.cost_usd) || 0;
  const datasets = apps.map((app, i) => ({ label: app, data: history.days.map((d) => pick((d.per_app && d.per_app[app]) || {})), backgroundColor: colorForIndex(i) }));
  const yFormat = metric === 'tokens' ? ((v) => compact(v)) : metric === 'seconds' ? ((v) => `${Math.round(v)} s`) : ((v) => money(v));
  return html`
    <div class="ai-chart poster-box">
      <div class="ai-chart-head">
        <small class="poster-hint">${x('chartTitle', { n: history.days.length, first: dateWord(r.first), last: dateWord(r.last) })}${r.maxDay ? ` · ${x('chartMax', { n: money(r.maxDay.cost), date: dateWord(r.maxDay.date) })}` : ''}</small>
        <span class="ai-metric">${['cost', 'tokens', 'seconds'].map((k) => html`<button type="button" key=${k} class=${`poster-tab poster-tab--filter ${metric === k ? 'is-on' : ''}`} onClick=${() => ctx.setMetric(k)}>${x('metric.' + k)}</button>`)}</span>
      </div>
      <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${200} legend=${false} yFormat=${yFormat} />
    </div>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secParams(ctx) {
  const s = ctx.settings;
  const p = ctx.params;   // the draft while editing
  const e = ctx.paramsEditing;
  const count = [s.temperature != null ? x('tempShort', { n: s.temperature }) : '', s.temperature == null && s.top_p == null && s.max_tokens == null ? x('allDefaults') : ''].filter(Boolean).join(' · ');
  const field = (key, min, max, step) => html`<input class="og-input ai-num" type="number" min=${min} max=${max} step=${step} value=${p[key]} placeholder=${x('default')} aria-label=${x('param.' + key)} onInput=${(ev) => ctx.setParams({ [key]: ev.target.value })} />`;
  return html`
    <${PageSection} id="ai-params" num="04" title=${x('secParams')} count=${count}>
      <p class="og-lead">${x('paramsIntro')}</p>
      <div class="facts">
        <div class="facts-k poster-label">${x('param.temperature')}</div>
        <div class="facts-v">${e ? field('temperature', 0, 2, 0.1) : (s.temperature != null ? x('tempBody', { n: s.temperature }) : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('tempSub')}</small></div>
        <div class="facts-k poster-label">${x('param.top_p')}</div>
        <div class="facts-v">${e ? field('top_p', 0, 1, 0.05) : (s.top_p != null ? String(s.top_p) : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('topPSub')}</small></div>
        <div class="facts-k poster-label">${x('param.max_tokens')}</div>
        <div class="facts-v">${e ? field('max_tokens', 256, 128000, 256) : (s.max_tokens != null ? x('tokensN', { n: compact(s.max_tokens) }) : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('maxTokensSub')}</small></div>
        <div class="facts-k poster-label">${x('param.retry')}</div>
        <div class="facts-v">${e
          ? html`<div class="ai-inline"><label class="ai-check check-line"><input type="checkbox" checked=${p.autoRetry} onChange=${(ev) => ctx.setParams({ autoRetry: ev.target.checked })} />${x('retryOn')}</label>${p.autoRetry ? html`<label>${x('retryMax')} ${field('maxRetries', 1, 10, 1)}</label>` : null}</div>`
          : (s.autoRetry ? x('retryBody', { n: s.maxRetries || 3 }) : x('retryOff'))}<small>${x('retrySub')}</small></div>
        <div class="facts-k poster-label">${x('param.reasoning')}</div>
        <div class="facts-v">${e
          ? html`<select class="select-field ai-num" aria-label=${x('param.reasoning')} value=${p.reasoning} onChange=${(ev) => ctx.setParams({ reasoning: ev.target.value })}>
              ${['', 'off', 'low', 'medium', 'high'].map((k) => html`<option key=${k} value=${k}>${x('reasoning.' + (k || 'default'))}</option>`)}
            </select>`
          : (s.reasoning && s.reasoning.enabled === false
            ? x('reasoningOff')
            : s.reasoning && s.reasoning.effort
              ? x('reasoningOn', { level: x('reasoning.' + s.reasoning.effort) })
              : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('reasoningSub')}</small></div>
      </div>
      <div class="og-doors">
        ${e
          ? html`<button type="button" class="poster-action poster-action--small" disabled=${ctx.busy === 'params'} onClick=${() => ctx.saveParams()}>${x('save')}</button><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.setParamsEditing(false)}>${x('cancel')}</button>`
          : html`<button type="button" class="poster-action poster-action--small" onClick=${() => ctx.setParamsEditing(true)}>${x('change')}</button>`}
      </div>
      ${msg(ctx.paramsMsg)}
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConsumers(ctx) {
  const top = (ctx.roll?.apps || []).filter((a) => !a.app.includes(':')).slice(0, 3).map((a) => a.app);
  const chat = ctx.chat;
  return html`
    <${PageSection} id="ai-consumers" num="05" title=${x('secConsumers')} count=${null}>
      <p class="og-lead">${x('consumersIntro')}</p>
      <div class="facts">
        <div class="facts-k poster-label">${x('consumer.apps')}</div><div class="facts-v">${x('consumerAppsBody')}${top.length ? ` ${x('consumerAppsTop', { apps: top.join(', ') })}` : ''}</div>
        <div class="facts-k poster-label">${x('consumer.agents')}</div><div class="facts-v">${x('consumerAgentsBody')}</div>
        <div class="facts-k poster-label">${x('consumer.media')}</div><div class="facts-v">${x('consumerMediaBody')}</div>
        <div class="facts-k poster-label">${x('consumer.chat')}</div><div class="facts-v">${chat
          ? (chat.pays === 'node' ? x('consumerChatNode', { host: ctx.host, model: chat.model || '' }) : chat.pays === 'own' ? x('consumerChatOwn') : x('consumerChatAllowance', { n: money(chat.allowance_remaining_usd || 0) }))
          : x('consumerChatUnknown')}<small>${x('consumerChatSub')}</small></div>
        <div class="facts-k poster-label">${x('consumer.agentRule')}</div><div class="facts-v">${x('consumerAgentRuleBody')}</div>
      </div>
    <//>`;
}
