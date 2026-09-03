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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, scrollTo } from '/views/profile/organisms/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { x, ROLES, money, compact, dateWord, crumb, pageLinks } from './frame.js';
import { roleRow, appRow } from './rows.js';

const SHOWN = 8;
const chip = (text, cls = '') => html`<span class=${`og-chip ${cls}`}>${text}</span>`;
const msg = (m) => (m ? html`<small class=${`ai-msg ${m.error ? 'is-err' : ''}`}>${m.text}</small>` : null);

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
          ${loading ? html`<p class="ai-empty">${x('loading')}</p>` : html`
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
    ? [chip(s.provider === 'openrouter' ? x('chipOwnKey') : x('chipOwnProvider'), 'og-chip--sun'), chip(x('provider.' + (s.provider || 'openrouter'))), ctx.models.length ? chip(x('chipModels', { n: ctx.models.length })) : null, ctx.usage ? chip(x('chipBudget', { n: money(ctx.usage.daily_budget_usd) }), 'og-chip--dim') : null]
    : [chip(x('chipNoKey'), 'og-chip--coral'), ctx.chat && ctx.chat.allowance_remaining_usd > 0 ? chip(x('chipHouseKey', { host: ctx.host, n: money(ctx.chat.allowance_remaining_usd) })) : null, chip(x('provider.openrouter'), 'og-chip--dim')];
  const desc = !s ? '' : keyed ? x('desc', { host: ctx.host }) : x('descNoKey', { host: ctx.host, n: money(ctx.chat?.allowance_remaining_usd || 0) });
  return html`
    <div class="og-mast">
      <div class="og-mast-words">
        <h1 class="og-title">${t('profile.generator.openrouter.title')}<small>${x('titleSub')}</small></h1>
        <div class="og-chips">${chips}</div>
        <p class="og-desc">${desc}</p>
      </div>
      <div class="og-mast-actions">
        ${keyed
          ? html`<button type="button" class="og-slab" disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}</button>`
          : html`<a class="og-slab" href="https://openrouter.ai/keys" target="_blank" rel="noopener">${x('getKey')}</a>`}
        <div class="og-doors">
          ${keyed ? html`<a class="og-door" href="https://openrouter.ai/keys" target="_blank" rel="noopener">${x('getKeyShort')}</a>` : null}
          <a class="og-door og-door--quiet" href="https://openrouter.ai/credits" target="_blank" rel="noopener">${x('credits')}</a>
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
    <${Section} id="ai-connection" num="01" title=${x('secConnection')} count=${count} first=${true}>
      <div class="ai-kv">
        <div class="ai-k">${x('providerLabel')}</div>
        <div class="ai-v">
          <div class="ai-radios">
            ${['openrouter', 'lmstudio', 'custom'].map((p) => html`<label class="ai-radio" key=${p}><input type="radio" name="ai-provider" checked=${d.provider === p} onChange=${() => ctx.setProvider(p)} />${x('providerChoice.' + p)}</label>`)}
          </div>
          ${!isOr ? html`<div class="ai-field"><input class="og-input" type="url" value=${d.baseUrl} placeholder="https://…/v1" aria-label=${x('baseUrl')} onInput=${(e) => ctx.setConn({ baseUrl: e.target.value })} /></div>` : null}
          <small>${x('providerHint')}</small>
        </div>
        <div class="ai-k">${x('keyLabel')}</div>
        <div class="ai-v">
          <div class="ai-field">
            <input class="og-input" type="password" autocomplete="off" data-1p-ignore data-lpignore="true" value=${d.apiKey} placeholder=${s.hasApiKey ? x('keyMasked') : 'sk-or-v1-…'} aria-label=${x('keyLabel')} onInput=${(e) => ctx.setConn({ apiKey: e.target.value })} />
            <button type="button" class="og-door" disabled=${ctx.busy === 'conn'} onClick=${() => ctx.saveConnection()}>${x('save')}</button>
          </div>
          ${msg(ctx.connMsg)}
          <small>${s.hasApiKey ? x('keyStoredHint') : x('keyHint')}</small>
          ${ctx.keyed ? html`
            <div class="og-doors">
              <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}</button>
              <button type="button" class="og-door og-door--quiet" disabled=${ctx.busy === 'models'} onClick=${() => ctx.loadModels()}>${ctx.busy === 'models' ? x('loading') : x('refreshModels')}</button>
              ${s.hasApiKey ? html`<button type="button" class="og-door og-door--quiet og-door--danger" onClick=${() => ctx.removeKey()}>${x('removeKey')}</button>` : null}
            </div>` : null}
        </div>
      </div>
      ${!ctx.keyed ? html`<p class="ai-empty"><b>${x('noKeyLead')}</b> ${x('noKeyBody', { host: ctx.host })}</p>` : null}
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secModels(ctx, chosen) {
  return html`
    <${Section} id="ai-models" num="02" title=${x('secModels')} count=${x('secModelsSub', { n: chosen, total: ROLES.length })}>
      ${ctx.modelsError ? html`<small class="ai-msg is-err">${ctx.modelsError}</small>` : null}
      <div class="ai-rl">
        <div class="ai-r ai-r--head"><div>${x('colRole')}</div><div>${x('colModel')}</div><div>${x('colWhat')}</div><div></div></div>
        ${ROLES.map((role) => roleRow(ctx, role))}
      </div>
      ${msg(ctx.modelsMsg)}
      <p class="ai-hint">${x('hintUnits')}</p>
      <p class="ai-hint">${ctx.keyed ? x('hintModels') : x('hintModelsNoKey')}</p>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function secBudget(ctx) {
  const u = ctx.usage;
  const r = ctx.roll;
  if (!u) return html`<${Section} id="ai-budget" num="03" title=${x('secBudget')} count=${null}><p class="ai-empty">${x('loading')}</p><//>`;
  const budget = Number(u.daily_budget_usd) || 0;
  const spent = Number(u.spent_today_usd) || 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const perDay = r && r.days ? r.cost / Math.max(1, r.days) : 0;
  const rows = r ? r.apps : [];
  const shown = ctx.showAllApps ? rows : rows.slice(0, SHOWN);
  const editing = ctx.capsEditing;
  const history = ctx.history;
  return html`
    <${Section} id="ai-budget" num="03" title=${x('secBudget')} count=${x('secBudgetSub', { n: money(budget), today: money(spent) })}>
      <div class="ai-kv">
        <div class="ai-k">${x('dailyBudget')}</div>
        <div class="ai-v">
          ${x('dailyBudgetBody', { n: money(budget), today: money(spent) })}
          <small>${x('dailyBudgetSub', { def: money(ctx.aiSettings?.defaults?.daily_budget_usd ?? 1), month: r ? money(r.cost) : money(0), perDay: money(perDay) })}</small>
          <div class="ai-bar"><i class=${pct >= 90 ? 'is-warn' : ''} style=${`width:${pct}%`}></i><span>${money(spent)} / ${money(budget)} · ${pct} %</span></div>
          ${ctx.budgetEditing ? html`
            <div class="ai-field">
              <input class="og-input ai-num" type="number" min="0" max="1000" step="0.10" value=${ctx.budgetDraft} aria-label=${x('dailyBudget')} onInput=${(e) => ctx.setBudgetDraft(e.target.value)} />
              <button type="button" class="og-door" disabled=${ctx.busy === 'budget'} onClick=${() => ctx.saveBudget()}>${x('save')}</button>
              <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setBudgetEditing(false)}>${x('cancel')}</button>
            </div>` : html`<div class="og-doors"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setBudgetEditing(true)}>${x('changeBudget')}</button></div>`}
          ${msg(ctx.budgetMsg)}
        </div>
        <div class="ai-k">${x('monthLabel')}</div>
        <div class="ai-v">${r && r.days ? x('monthBody', { cost: money(r.cost), calls: r.calls, tokens: compact(r.tokens), apps: r.apps.length, big: r.apps.filter((a) => a.cost >= 0.1).length }) : x('monthNone')}<small>${x('monthSub')}</small></div>
      </div>
      ${rows.length ? html`
        <span class="og-label ai-label">${x('whatSpent', { shown: shown.length, total: rows.length })}</span>
        <div class="ai-apps">
          <div class="ai-h">${x('colApp')}</div><div class="ai-h ai-n">${x('colMonth')}</div><div class="ai-h ai-n ai-today">${x('colToday')}</div><div class="ai-h ai-n">${x('colCap')}</div><div class="ai-h ai-n ai-calls">${x('colCalls')}</div>
          ${shown.map((row) => appRow(ctx, row, editing))}
        </div>
        <div class="ai-more">
          ${rows.length > SHOWN ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setShowAllApps(!ctx.showAllApps)}>${ctx.showAllApps ? x('showFewer') : x('showAllApps', { n: rows.length })}</button>` : null}
          ${editing
            ? html`<button type="button" class="og-slab og-slab--sm" disabled=${ctx.busy === 'caps'} onClick=${() => ctx.saveCaps()}>${x('saveCaps')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setCapsEditing(false)}>${x('cancel')}</button>`
            : html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setCapsEditing(true)}>${x('setCaps')}</button>`}
          <small>${editing ? x('capsEditingHint') : x('capsHint')}</small>
        </div>
        ${msg(ctx.capsMsg)}
        <p class="ai-hint">${x('hintCaps')}</p>` : html`<p class="ai-empty">${x('noSpend')}</p>`}
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
    <div class="ai-chart">
      <div class="ai-chart-head">
        <small>${x('chartTitle', { n: history.days.length, first: dateWord(r.first), last: dateWord(r.last) })}${r.maxDay ? ` · ${x('chartMax', { n: money(r.maxDay.cost), date: dateWord(r.maxDay.date) })}` : ''}</small>
        <span class="ai-metric">${['cost', 'tokens', 'seconds'].map((k) => html`<button type="button" key=${k} class=${metric === k ? 'is-on' : ''} onClick=${() => ctx.setMetric(k)}>${x('metric.' + k)}</button>`)}</span>
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
    <${Section} id="ai-params" num="04" title=${x('secParams')} count=${count}>
      <p class="ai-para">${x('paramsIntro')}</p>
      <div class="ai-kv">
        <div class="ai-k">${x('param.temperature')}</div>
        <div class="ai-v">${e ? field('temperature', 0, 2, 0.1) : (s.temperature != null ? x('tempBody', { n: s.temperature }) : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('tempSub')}</small></div>
        <div class="ai-k">${x('param.top_p')}</div>
        <div class="ai-v">${e ? field('top_p', 0, 1, 0.05) : (s.top_p != null ? String(s.top_p) : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('topPSub')}</small></div>
        <div class="ai-k">${x('param.max_tokens')}</div>
        <div class="ai-v">${e ? field('max_tokens', 256, 128000, 256) : (s.max_tokens != null ? x('tokensN', { n: compact(s.max_tokens) }) : html`<span class="is-unset">${x('modelDefault')}</span>`)}<small>${x('maxTokensSub')}</small></div>
        <div class="ai-k">${x('param.retry')}</div>
        <div class="ai-v">${e
          ? html`<div class="ai-inline"><label class="ai-check"><input type="checkbox" checked=${p.autoRetry} onChange=${(ev) => ctx.setParams({ autoRetry: ev.target.checked })} />${x('retryOn')}</label>${p.autoRetry ? html`<label>${x('retryMax')} ${field('maxRetries', 1, 10, 1)}</label>` : null}</div>`
          : (s.autoRetry ? x('retryBody', { n: s.maxRetries || 3 }) : x('retryOff'))}<small>${x('retrySub')}</small></div>
      </div>
      <div class="og-doors">
        ${e
          ? html`<button type="button" class="og-door" disabled=${ctx.busy === 'params'} onClick=${() => ctx.saveParams()}>${x('save')}</button><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.setParamsEditing(false)}>${x('cancel')}</button>`
          : html`<button type="button" class="og-door" onClick=${() => ctx.setParamsEditing(true)}>${x('change')}</button>`}
      </div>
      ${msg(ctx.paramsMsg)}
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConsumers(ctx) {
  const top = (ctx.roll?.apps || []).filter((a) => !a.app.includes(':')).slice(0, 3).map((a) => a.app);
  const chat = ctx.chat;
  return html`
    <${Section} id="ai-consumers" num="05" title=${x('secConsumers')} count=${null}>
      <p class="ai-para">${x('consumersIntro')}</p>
      <div class="ai-kv">
        <div class="ai-k">${x('consumer.apps')}</div><div class="ai-v">${x('consumerAppsBody')}${top.length ? ` ${x('consumerAppsTop', { apps: top.join(', ') })}` : ''}</div>
        <div class="ai-k">${x('consumer.agents')}</div><div class="ai-v">${x('consumerAgentsBody')}</div>
        <div class="ai-k">${x('consumer.media')}</div><div class="ai-v">${x('consumerMediaBody')}</div>
        <div class="ai-k">${x('consumer.chat')}</div><div class="ai-v">${chat
          ? (chat.pays === 'node' ? x('consumerChatNode', { host: ctx.host, model: chat.model || '' }) : chat.pays === 'own' ? x('consumerChatOwn') : x('consumerChatAllowance', { n: money(chat.allowance_remaining_usd || 0) }))
          : x('consumerChatUnknown')}<small>${x('consumerChatSub')}</small></div>
        <div class="ai-k">${x('consumer.agentRule')}</div><div class="ai-v">${x('consumerAgentRuleBody')}</div>
      </div>
    <//>`;
}
