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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { x, day, when, kindOf, cronWords, appName, appUrlOf } from './frame.js';

const dot = (active) => html`<i class=${`ex-dot ${active ? 'is-on' : ''}`} aria-hidden="true"></i>`;

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
    <div class=${`ex-p ${open ? 'is-open' : ''}`} key=${'ext:' + ext.name}>
      <div class="ex-nm">${dot(active)}${ext.name}<span class="ex-tag">v${ext.version || '?'}</span><small>${active ? x('stateActive') : x('stateOff')} · ${x('actionsN', { n: ext.actionCount ?? ids.length })}${own ? '' : ' · ' + x('ownedBy', { owner: ext.installedBy || ext.author || '' })}</small></div>
      <div class="ex-ds">${ext.description || ''}</div>
      <div class="ex-me">${usedLine(ext)}<small>${ids.slice(0, 4).join(' · ')}${ids.length > 4 ? ` · +${ids.length - 4}` : ''}</small></div>
      <div class="ex-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggleExt(ext)}>${open ? x('close') : x('open')}</button>
        ${own ? html`
          <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}</button>
          <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.removeExt(ext)}>${x('remove')}</button>` : null}
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
  if (!d) return html`<div class="ex-open"><p class="ex-empty">${t('common.loading')}</p></div>`;
  if (d.error) return html`<div class="ex-open"><p class="ex-empty">${d.error}</p></div>`;
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
    <div class="ex-open">
      <p class="ex-lead">${ext.description || ''}</p>
      <span class="og-label">${x('actions')}</span>
      <div class="ex-act">
        ${(d.actions || []).map((a) => html`
          <div key=${'a' + a.id}><code>${a.id}</code><small>${a.method || 'POST'}</small></div>
          <div key=${'d' + a.id}>${a.description || ''}<small>${x('inputOutput', { input: schemaWords(a.inputSchema || a.input) || x('nothing'), output: schemaWords(a.outputSchema || a.output) || x('nothing') })}</small></div>
          <div key=${'t' + a.id}>${active && own ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggleTest(ext, a)}>${test && test.actionId === a.id ? x('close') : x('test')}</button>` : null}</div>`)}
      </div>
      ${test ? html`
        <div class="ex-test">
          <span class="og-label">${x('testTitle', { action: test.actionId })}</span>
          <textarea class="og-textarea ex-test-in" rows="3" value=${test.input} onInput=${(e) => ctx.setTestInput(e.target.value)}></textarea>
          <div class="og-doors"><button type="button" class="og-door" disabled=${test.running} onClick=${() => ctx.runTest(ext)}>${x('run')}</button><span class="ex-hint">${x('testHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}</span></div>
          ${test.result ? html`<span class="og-label">${test.result.ok ? x('testOk') : x('testFail')}</span><pre class="ex-out">${test.result.text}</pre>` : null}
        </div>` : null}
      <div class="ex-kv">
        <div class="ex-k">${x('address')}</div><div class="ex-v"><code>${address}</code><small>${x('addressSub')} · <${CopyButton} text=${base + '/'} className="og-crumb-link" label=${x('copyAddress')} copiedLabel=${x('copied')} /></small></div>
        <div class="ex-k">${x('fromApp')}</div><div class="ex-v"><code>${example}</code><small>${x('fromAppSub')} · <${CopyButton} text=${example} className="og-crumb-link" label=${x('copyExample')} copiedLabel=${x('copied')} /></small></div>
        <div class="ex-k">${x('usedBy')}</div><div class="ex-v">${(used.apps || 0) + (used.cortexes || 0) ? html`${(used.app_names || []).map((ref) => html`<a class="og-crumb-link" key=${ref} href=${appUrlOf(ref)} target="_blank" rel="noopener">${appName(ref)}</a> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}${(used.cortex_names || []).length ? html`<small>${x('usedCortexList', { list: used.cortex_names.join(', ') })}</small>` : null}` : html`${x('usedNone')}<small>${x('usedNoneSub')}</small>`}</div>
        <div class="ex-k">${x('memoryArea')}</div><div class="ex-v"><code>ext:${ext.name}</code><small>${x('memoryAreaSub')}</small></div>
        <div class="ex-k">${x('instances')}</div><div class="ex-v">${ext.instances?.supported ? html`${(ctx.instances[ext.name] || []).length ? (ctx.instances[ext.name] || []).map((i) => html`<span class="ex-tag" key=${i.id}>${i.id} · ${i.status}</span> `) : x('instancesNone')}<small>${x('instancesSub')}</small>${own && active ? html`<div class="ex-inst"><input class="og-input" placeholder=${x('instanceIdPlaceholder')} value=${ctx.newInstanceId} onInput=${(e) => ctx.setNewInstanceId(e.target.value)} /><button type="button" class="og-door" onClick=${() => ctx.createInstance(ext)}>${x('createInstance')}</button>${(ctx.instances[ext.name] || []).map((i) => html`<button type="button" class="og-door og-door--quiet" key=${'x' + i.id} onClick=${() => ctx.deleteInstance(ext, i.id)}>${x('deleteInstance', { id: i.id })}</button>`)}</div>` : null}` : html`${x('instancesUnsupported')}<small>${x('instancesSub')}</small>`}</div>
        <div class="ex-k">${x('settings')}</div><div class="ex-v">${cfgKeys.length ? cfgKeys.map((k) => `${k} = ${typeof d.config[k] === 'object' ? JSON.stringify(d.config[k]) : String(d.config[k])}`).join(' · ') : x('settingsNone')}<small>${x('settingsSub')}</small></div>
        <div class="ex-k">${x('schedules')}</div><div class="ex-v">${schedules.length ? schedules.map((s) => { const job = jobs.find((j) => j.actionId === s.action && j.cron === s.cron); return html`<div key=${s.id}>${s.action} · ${cronWords(s.cron)}${job ? html`<small>${x('lastRun', { at: when(job.lastRunAt), result: job.lastRunResult === 'success' ? x('runOk') : x('runFail'), n: job.runCount || 0 })}</small>` : html`<small class="is-coral">${x('notInScheduler')}</small>`}</div>`; }) : x('schedulesNone')}</div>
        <div class="ex-k">${x('limits')}</div><div class="ex-v">${x('limitsLine', { mb: d.limits?.memoryMb ?? '?', s: Math.round((d.limits?.timeoutMs ?? 0) / 1000), calls: d.limits?.maxApiCalls ?? '?' })}<small>${x('requires', { list: (d.requiredApis || []).join(', ') || x('nothing') })}</small></div>
        <div class="ex-k">${x('state')}</div><div class="ex-v">${active ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(ext.installedAt) })}${ext.activatedAt ? ` · ${x('activatedOn', { date: day(ext.activatedAt) })}` : ''}<small>${x('versionsLine', { current: ext.version, list: (d.versions || []).map((v) => v.version).join(', ') })}</small></div>
      </div>
      ${own ? html`<div class="og-doors ex-open-doors">
        <button type="button" class="og-door" onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.removeExt(ext)}>${x('removeExt')}</button>
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
    <div class=${`ex-p ${open ? 'is-open' : ''}`} key=${'cx:' + cx.name}>
      <div class="ex-nm">${dot(cx.status === 'active')}${cx.name}<span class="ex-tag">v${cx.version || '?'}</span><small>${isPublic ? x('public') : x('private')} · ${types.join(' + ')}${own ? '' : ' · ' + x('ownedBy', { owner: cx.installed_by || '' })}</small></div>
      <div class="ex-ds">${cx.description || ''}</div>
      <div class="ex-me">${(used.apps || 0) ? html`<b>${x('usedBy')}</b>${(used.app_names || []).map(appName).join(', ')}${(used.apps || 0) > (used.app_names || []).length ? ' · ' + x('usedMore', { n: used.apps - used.app_names.length }) : ''}` : html`<b class="is-dim">${x('usedNoApp')}</b>`}</div>
      <div class="ex-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggleCortex(cx)}>${open ? x('close') : x('open')}</button>
        ${own ? html`
          <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.toggleVisibility(cx)}>${isPublic ? x('makePrivate') : x('publish')}</button>
          <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.removeCortex(cx)}>${x('remove')}</button>` : null}
      </div>
      ${open ? cortexOpen(ctx, cx, own) : null}
    </div>`;
}

function cortexOpen(ctx, cx, own) {
  const d = ctx.details['cx:' + cx.name];
  if (!d) return html`<div class="ex-open"><p class="ex-empty">${t('common.loading')}</p></div>`;
  if (d.error) return html`<div class="ex-open"><p class="ex-empty">${d.error}</p></div>`;
  const comps = d.components || [];
  const libs = comps.filter((c) => c.type === 'lib');
  const prompts = comps.filter((c) => c.type === 'prompt');
  const tag = (lib) => `<script src="${ctx.nodeUrl}/v1/cortex/${encodeURIComponent(cx.name)}@${cx.version}/libs/${encodeURIComponent(lib.filename)}"></script>`;
  const used = cx.used_by || {};
  return html`
    <div class="ex-open">
      <p class="ex-lead">${cx.description || ''}</p>
      <div class="ex-kv">
        ${libs.map((lib) => html`
          <div class="ex-k" key=${'k' + lib.filename}>${x('intoApp')}</div><div class="ex-v" key=${'v' + lib.filename}><code>${tag(lib)}</code><small>${x('intoAppSub')} · <${CopyButton} text=${tag(lib)} className="og-crumb-link" label=${x('copyTag')} copiedLabel=${x('copied')} /></small></div>
          ${lib.api_surface ? html`<div class="ex-k" key=${'ak' + lib.filename}>${x('api')}</div><div class="ex-v" key=${'av' + lib.filename}><pre class="ex-api">${lib.api_surface}</pre><small>${x('apiSub')} · <${CopyButton} text=${lib.api_surface} className="og-crumb-link" label=${x('copyApi')} copiedLabel=${x('copied')} /></small></div>` : null}`)}
        ${prompts.map((p) => html`<div class="ex-k" key=${'pk' + p.name}>${x('prompt')}</div><div class="ex-v" key=${'pv' + p.name}>${p.name} · ${x('chars', { n: (p._content || '').length })}<small>${x('promptSub')} · <${CopyButton} text=${p._content || ''} className="og-crumb-link" label=${x('copyPrompt')} copiedLabel=${x('copied')} /></small></div>`)}
        <div class="ex-k">${x('parts')}</div><div class="ex-v">${comps.map((c) => html`<span class="ex-tag" key=${c.type + (c.name || c.filename || '')}>${x('part.' + c.type) || c.type} ${c.name || c.filename || c.key_pattern || ''}</span> `)}</div>
        <div class="ex-k">${x('usedBy')}</div><div class="ex-v">${(used.apps || 0) ? html`${(used.app_names || []).map((ref) => html`<a class="og-crumb-link" key=${ref} href=${appUrlOf(ref)} target="_blank" rel="noopener">${appName(ref)}</a> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}` : html`${x('usedNoApp')}<small>${x('usedNoAppSub')}</small>`}</div>
        <div class="ex-k">${x('visibility')}</div><div class="ex-v">${cx.visibility === 'public' ? x('publicLong') : x('privateLong')}</div>
        <div class="ex-k">${x('state')}</div><div class="ex-v">${cx.status === 'active' ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(cx.installed_at) })} · ${cx.author || cx.installed_by || ''}${d.license ? ` · ${d.license}` : ''}<small>${x('versionsLine', { current: cx.version, list: (d.versions || []).map((v) => v.version).join(', ') })}</small></div>
      </div>
      ${own ? html`<div class="og-doors ex-open-doors">
        <button type="button" class="og-door" onClick=${() => (cx.status === 'active' ? ctx.deactivateCortex(cx) : ctx.activateCortex(cx))}>${cx.status === 'active' ? x('deactivate') : x('activate')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.removeCortex(cx)}>${x('removeCortex')}</button>
      </div>` : null}
    </div>`;
}
