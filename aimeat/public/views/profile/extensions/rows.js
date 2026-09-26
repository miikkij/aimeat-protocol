/**
 * @file public/views/profile/extensions/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the Extensions page's two lists and what opens under one. A server
 *   extension row: name and version with its status, what it does, who uses it (apps, a clock,
 *   or nothing visible) and its action ids, the doors. Opened: the actions with their input and
 *   output and a test panel, the address and a call example, the memory area, instances, settings,
 *   schedules with their last runs, limits, state, kept versions, the apps that use it. A cortex
 *   row: name and version, what it gives an app, its API, who loads it. Opened: the script tag
 *   pinned to the current version, the API surface, the prompt, the parts, visibility, versions.
 * @structure extRow · extOpen · cortexRow · cortexOpen
 * @usage import { extRow, cortexRow } from './rows.js';
 * @version-history
 *   v1.14.0 -- 2026-09-26 -- A test's answer and a library's API are the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.13.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.12.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.11.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- The dot before a name is the Status dot (.status-dot, active or inactive), a unification.
 *   v1.9.0 -- 2026-09-25 -- An opened extension's and an opened cortex's facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.8.0 -- 2026-09-25 -- A server extension's row, a cortex's row and the action table are the Listing (listing-row and its name, words and doors cells, the open panel), a unification: the look most tabs use. The used-by column keeps its typewriter face on a span inside a plain cell.
 *   v1.7.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { x, day, when, kindOf, cronWords, appName, appUrlOf } from './frame.js';

const dot = (active) => html`<i class=${`status-dot ${active ? 'status-dot--active' : 'status-dot--inactive'}`} aria-hidden="true"></i>`;

function usedLine(ext) {
  const u = ext.used_by || {};
  const kind = kindOf(ext);
  if (kind === 'apps') {
    const names = (u.app_names || []).map(appName);
    const more = (u.apps || 0) - names.length;
    const parts = [names.join(', '), more > 0 ? x('usedMore', { n: more }) : '', u.cortexes ? x('usedCortexes', { n: u.cortexes }) : ''].filter(Boolean);
    return html`<b>${x('usedBy')}</b>${parts.join(' · ')}`;
  }
  if (kind === 'background') return html`<b>${x('kindBackground')}</b>${(ext.schedules || []).map((s) => cronWords(s.cron)).join(' · ')}`;
  return html`<b class="is-dim">${x('kindUnseen')}</b>${x('kindUnseenSub')}`;
}

export function extRow(ctx, ext) {
  const own = ext.installedBy === ctx.session?.owner;
  const active = ext.status === 'active';
  const open = ctx.expanded === 'ext:' + ext.name;
  const busy = ctx.busy === 'ext:' + ext.name;
  const ids = (ext.actions || []).map((a) => a.id);
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${'ext:' + ext.name}>
      <div class="listing-name">${dot(active)}${ext.name}<span class="poster-chip">v${ext.version || '?'}</span><small>${active ? x('stateActive') : x('stateOff')} · ${x('actionsN', { n: ext.actionCount ?? ids.length })}${own ? '' : ' · ' + x('ownedBy', { owner: ext.installedBy || ext.author || '' })}</small></div>
      <div class="listing-desc">${ext.description || ''}</div>
      <div><span class="ex-me">${usedLine(ext)}<small>${ids.slice(0, 4).join(' · ')}${ids.length > 4 ? ` · +${ids.length - 4}` : ''}</small></span></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleExt(ext)}>${open ? x('close') : x('open')}</button>
        ${own ? html`
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.removeExt(ext)}>${x('remove')}</button>` : null}
      </div>
      ${open ? extOpen(ctx, ext, own) : null}
    </div>`;
}

function schemaWords(schema) {
  const props = schema?.properties || (schema && typeof schema === 'object' && !('type' in schema) ? schema : null);
  if (!props || typeof props !== 'object') return '';
  const req = new Set(schema?.required || []);
  return Object.entries(props).filter(([k]) => !['type', 'required', 'properties'].includes(k)).map(([k, v]) => `${k}${req.has(k) ? '*' : ''}: ${(v && typeof v === 'object' && v.type) || '?'}`).join(', ');
}

function extOpen(ctx, ext, own) {
  const d = ctx.details['ext:' + ext.name];
  if (!d) return html`<div class="listing-open poster-box poster-box--raised"><p class="poster-quiet ex-empty loading-mark">${t('common.loading')}</p></div>`;
  if (d.error) return html`<div class="listing-open poster-box poster-box--raised"><p class="poster-quiet ex-empty">${d.error}</p></div>`;
  const active = ext.status === 'active';
  const base = `${ctx.nodeUrl}/v1/ext/${encodeURIComponent(ext.name)}`;
  const firstAction = (d.actions || [])[0]?.id || 'action';
  const address = `POST ${base}/${firstAction}`;
  const example = `const r = await session.fetch('/v1/ext/${ext.name}@${ext.version}/${firstAction}', { method: 'POST', body: JSON.stringify({}) });`;
  const schedules = Array.isArray(d.config?.__schedules) ? d.config.__schedules : [];
  const jobs = ctx.jobs.filter((j) => j.extensionName === ext.name);
  const cfgKeys = Object.keys(d.config || {}).filter((k) => !k.startsWith('__'));
  const test = ctx.test && ctx.test.ext === ext.name ? ctx.test : null;
  const used = ext.used_by || {};
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${ext.description || ''}</p>
      <span class="poster-label">${x('actions')}</span>
      <div class="listing listing--id-desc-doors ex-act">
        ${(d.actions || []).map((a) => html`
          <div class="listing-row" key=${a.id}>
            <div class="listing-name"><code class="code-inline">${a.id}</code><small>${a.method || 'POST'}</small></div>
            <div class="listing-desc">${a.description || ''}<small>${x('inputOutput', { input: schemaWords(a.inputSchema || a.input) || x('nothing'), output: schemaWords(a.outputSchema || a.output) || x('nothing') })}</small></div>
            <div class="listing-doors">${active && own ? html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" onClick=${() => ctx.toggleTest(ext, a)}>${test && test.actionId === a.id ? x('close') : x('test')}</button>` : null}</div>
          </div>`)}
      </div>
      ${test ? html`
        <div class="ex-test">
          <span class="poster-label">${x('testTitle', { action: test.actionId })}</span>
          <textarea class="og-textarea ex-test-in" rows="3" value=${test.input} onInput=${(e) => ctx.setTestInput(e.target.value)}></textarea>
          <div class="og-doors"><button type="button" class="poster-action poster-action--small" disabled=${test.running} onClick=${() => ctx.runTest(ext)}>${x('run')}</button><span class="poster-hint">${x('testHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}</span></div>
          ${test.result ? html`<span class="poster-label">${test.result.ok ? x('testOk') : x('testFail')}</span><pre class="code-block ex-out">${test.result.text}</pre>` : null}
        </div>` : null}
      <div class="facts">
        <div class="facts-k poster-label">${x('address')}</div><div class="facts-v"><code class="code-inline">${address}</code><small>${x('addressSub')} · <${CopyButton} text=${base + '/'} className="og-crumb-link" label=${x('copyAddress')} copiedLabel=${x('copied')} /></small></div>
        <div class="facts-k poster-label">${x('fromApp')}</div><div class="facts-v"><code class="code-inline">${example}</code><small>${x('fromAppSub')} · <${CopyButton} text=${example} className="og-crumb-link" label=${x('copyExample')} copiedLabel=${x('copied')} /></small></div>
        <div class="facts-k poster-label">${x('usedBy')}</div><div class="facts-v">${(used.apps || 0) + (used.cortexes || 0) ? html`${(used.app_names || []).map((ref) => html`<a class="og-crumb-link" key=${ref} href=${appUrlOf(ref)} target="_blank" rel="noopener">${appName(ref)}</a> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}${(used.cortex_names || []).length ? html`<small>${x('usedCortexList', { list: used.cortex_names.join(', ') })}</small>` : null}` : html`${x('usedNone')}<small>${x('usedNoneSub')}</small>`}</div>
        <div class="facts-k poster-label">${x('memoryArea')}</div><div class="facts-v"><code class="code-inline">ext:${ext.name}</code><small>${x('memoryAreaSub')}</small></div>
        <div class="facts-k poster-label">${x('instances')}</div><div class="facts-v">${ext.instances?.supported ? html`${(ctx.instances[ext.name] || []).length ? (ctx.instances[ext.name] || []).map((i) => html`<span class="poster-chip" key=${i.id}>${i.id} · ${i.status}</span> `) : x('instancesNone')}<small>${x('instancesSub')}</small>${own && active ? html`<div class="ex-inst"><input class="og-input" placeholder=${x('instanceIdPlaceholder')} value=${ctx.newInstanceId} onInput=${(e) => ctx.setNewInstanceId(e.target.value)} /><button type="button" class="poster-action poster-action--small" onClick=${() => ctx.createInstance(ext)}>${x('createInstance')}</button>${(ctx.instances[ext.name] || []).map((i) => html`<button type="button" class="poster-action poster-action--small poster-action--lower" key=${'x' + i.id} onClick=${() => ctx.deleteInstance(ext, i.id)}>${x('deleteInstance', { id: i.id })}</button>`)}</div>` : null}` : html`${x('instancesUnsupported')}<small>${x('instancesSub')}</small>`}</div>
        <div class="facts-k poster-label">${x('settings')}</div><div class="facts-v">${cfgKeys.length ? cfgKeys.map((k) => `${k} = ${typeof d.config[k] === 'object' ? JSON.stringify(d.config[k]) : String(d.config[k])}`).join(' · ') : x('settingsNone')}<small>${x('settingsSub')}</small></div>
        <div class="facts-k poster-label">${x('schedules')}</div><div class="facts-v">${schedules.length ? schedules.map((s) => { const job = jobs.find((j) => j.actionId === s.action && j.cron === s.cron); return html`<div key=${s.id}>${s.action} · ${cronWords(s.cron)}${job ? html`<small>${x('lastRun', { at: when(job.lastRunAt), result: job.lastRunResult === 'success' ? x('runOk') : x('runFail'), n: job.runCount || 0 })}</small>` : html`<small class="is-coral">${x('notInScheduler')}</small>`}</div>`; }) : x('schedulesNone')}</div>
        <div class="facts-k poster-label">${x('limits')}</div><div class="facts-v">${x('limitsLine', { mb: d.limits?.memoryMb ?? '?', s: Math.round((d.limits?.timeoutMs ?? 0) / 1000), calls: d.limits?.maxApiCalls ?? '?' })}<small>${x('requires', { list: (d.requiredApis || []).join(', ') || x('nothing') })}</small></div>
        <div class="facts-k poster-label">${x('state')}</div><div class="facts-v">${active ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(ext.installedAt) })}${ext.activatedAt ? ` · ${x('activatedOn', { date: day(ext.activatedAt) })}` : ''}<small>${x('versionsLine', { current: ext.version, list: (d.versions || []).map((v) => v.version).join(', ') })}</small></div>
      </div>
      ${own ? html`<div class="og-doors listing-open-doors">
        <button type="button" class="poster-action poster-action--small" onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.removeExt(ext)}>${x('removeExt')}</button>
      </div>` : null}
    </div>`;
}

export function cortexRow(ctx, cx) {
  const own = cx.installed_by === ctx.session?.owner;
  const open = ctx.expanded === 'cx:' + cx.name;
  const busy = ctx.busy === 'cx:' + cx.name;
  const isPublic = cx.visibility === 'public';
  const used = cx.used_by || {};
  const types = (cx.component_types || []).map((k) => x('part.' + k) || k);
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${'cx:' + cx.name}>
      <div class="listing-name">${dot(cx.status === 'active')}${cx.name}<span class="poster-chip">v${cx.version || '?'}</span><small>${isPublic ? x('public') : x('private')} · ${types.join(' + ')}${own ? '' : ' · ' + x('ownedBy', { owner: cx.installed_by || '' })}</small></div>
      <div class="listing-desc">${cx.description || ''}</div>
      <div><span class="ex-me">${(used.apps || 0) ? html`<b>${x('usedBy')}</b>${(used.app_names || []).map(appName).join(', ')}${(used.apps || 0) > (used.app_names || []).length ? ' · ' + x('usedMore', { n: used.apps - used.app_names.length }) : ''}` : html`<b class="is-dim">${x('usedNoApp')}</b>`}</span></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleCortex(cx)}>${open ? x('close') : x('open')}</button>
        ${own ? html`
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.toggleVisibility(cx)}>${isPublic ? x('makePrivate') : x('publish')}</button>
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.removeCortex(cx)}>${x('remove')}</button>` : null}
      </div>
      ${open ? cortexOpen(ctx, cx, own) : null}
    </div>`;
}

function cortexOpen(ctx, cx, own) {
  const d = ctx.details['cx:' + cx.name];
  if (!d) return html`<div class="listing-open poster-box poster-box--raised"><p class="poster-quiet ex-empty loading-mark">${t('common.loading')}</p></div>`;
  if (d.error) return html`<div class="listing-open poster-box poster-box--raised"><p class="poster-quiet ex-empty">${d.error}</p></div>`;
  const comps = d.components || [];
  const libs = comps.filter((c) => c.type === 'lib');
  const prompts = comps.filter((c) => c.type === 'prompt');
  const tag = (lib) => `<script src="${ctx.nodeUrl}/v1/cortex/${encodeURIComponent(cx.name)}@${cx.version}/libs/${encodeURIComponent(lib.filename)}"></script>`;
  const used = cx.used_by || {};
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${cx.description || ''}</p>
      <div class="facts">
        ${libs.map((lib) => html`
          <div class="facts-k poster-label" key=${'k' + lib.filename}>${x('intoApp')}</div><div class="facts-v" key=${'v' + lib.filename}><code class="code-inline">${tag(lib)}</code><small>${x('intoAppSub')} · <${CopyButton} text=${tag(lib)} className="og-crumb-link" label=${x('copyTag')} copiedLabel=${x('copied')} /></small></div>
          ${lib.api_surface ? html`<div class="facts-k poster-label" key=${'ak' + lib.filename}>${x('api')}</div><div class="facts-v" key=${'av' + lib.filename}><pre class="code-block ex-api">${lib.api_surface}</pre><small>${x('apiSub')} · <${CopyButton} text=${lib.api_surface} className="og-crumb-link" label=${x('copyApi')} copiedLabel=${x('copied')} /></small></div>` : null}`)}
        ${prompts.map((p) => html`<div class="facts-k poster-label" key=${'pk' + p.name}>${x('prompt')}</div><div class="facts-v" key=${'pv' + p.name}>${p.name} · ${x('chars', { n: (p._content || '').length })}<small>${x('promptSub')} · <${CopyButton} text=${p._content || ''} className="og-crumb-link" label=${x('copyPrompt')} copiedLabel=${x('copied')} /></small></div>`)}
        <div class="facts-k poster-label">${x('parts')}</div><div class="facts-v">${comps.map((c) => html`<span class="poster-chip" key=${c.type + (c.name || c.filename || '')}>${x('part.' + c.type) || c.type} ${c.name || c.filename || c.key_pattern || ''}</span> `)}</div>
        <div class="facts-k poster-label">${x('usedBy')}</div><div class="facts-v">${(used.apps || 0) ? html`${(used.app_names || []).map((ref) => html`<a class="og-crumb-link" key=${ref} href=${appUrlOf(ref)} target="_blank" rel="noopener">${appName(ref)}</a> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}` : html`${x('usedNoApp')}<small>${x('usedNoAppSub')}</small>`}</div>
        <div class="facts-k poster-label">${x('visibility')}</div><div class="facts-v">${cx.visibility === 'public' ? x('publicLong') : x('privateLong')}</div>
        <div class="facts-k poster-label">${x('state')}</div><div class="facts-v">${cx.status === 'active' ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(cx.installed_at) })} · ${cx.author || cx.installed_by || ''}${d.license ? ` · ${d.license}` : ''}<small>${x('versionsLine', { current: cx.version, list: (d.versions || []).map((v) => v.version).join(', ') })}</small></div>
      </div>
      ${own ? html`<div class="og-doors listing-open-doors">
        <button type="button" class="poster-action poster-action--small" onClick=${() => (cx.status === 'active' ? ctx.deactivateCortex(cx) : ctx.activateCortex(cx))}>${cx.status === 'active' ? x('deactivate') : x('activate')}</button>
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.removeCortex(cx)}>${x('removeCortex')}</button>
      </div>` : null}
    </div>`;
}
