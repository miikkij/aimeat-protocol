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
 *   2026-09-22 -- Composed from the shared component set: ListRow with a status marker and the
 *     version as a Chip, the opened record a Surface of KeyValue rows, the actions as compact rows,
 *     the test panel a Field and a code Surface; no own CSS.
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ListRow, Stack, KeyValue, Field, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { x, day, when, kindOf, cronWords, appName, appUrlOf } from './frame.js';

/** A name with its version beside it. */
const named = (name, version) => html`${name} <${Chip}>v${version || '?'}<//>`;
/** A KeyValue whose value is a line and a quieter note under it. */
const kv = (label, body, note) => html`<${KeyValue} label=${label}>
  <${Stack} density="compact"><div>${body}</div>${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}<//>
<//>`;
const loadingRecord = (text) => html`<${Surface} kind="record"><${Text} tone="muted">${text}<//><//>`;
const appLinks = (used) => (used.app_names || []).map((ref) => html`<${Action} kind="text" key=${ref} href=${appUrlOf(ref)} target="_blank">${appName(ref)}<//> `);

function usedLine(ext) {
  const u = ext.used_by || {};
  const kind = kindOf(ext);
  if (kind === 'apps') {
    const names = (u.app_names || []).map(appName);
    const more = (u.apps || 0) - names.length;
    const parts = [names.join(', '), more > 0 ? x('usedMore', { n: more }) : '', u.cortexes ? x('usedCortexes', { n: u.cortexes }) : ''].filter(Boolean);
    return html`<${Text} kind="caption"><strong>${x('usedBy')}</strong> ${parts.join(' · ')}<//>`;
  }
  if (kind === 'background') return html`<${Text} kind="caption"><strong>${x('kindBackground')}</strong> ${(ext.schedules || []).map((s) => cronWords(s.cron)).join(' · ')}<//>`;
  return html`<${Text} kind="caption" tone="muted"><strong>${x('kindUnseen')}</strong> ${x('kindUnseenSub')}<//>`;
}

export function extRow(ctx, ext) {
  const own = ext.installedBy === ctx.session?.owner;
  const active = ext.status === 'active';
  const open = ctx.expanded === 'ext:' + ext.name;
  const busy = ctx.busy === 'ext:' + ext.name;
  const ids = (ext.actions || []).map((a) => a.id);
  return html`<${ListRow} key=${'ext:' + ext.name} density="compact" marker=${active ? 'success' : 'muted'} name=${named(ext.name, ext.version)}
    detail=${`${active ? x('stateActive') : x('stateOff')} · ${x('actionsN', { n: ext.actionCount ?? ids.length })}${own ? '' : ' · ' + x('ownedBy', { owner: ext.installedBy || ext.author || '' })}`}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggleExt(ext)}>${open ? x('close') : x('open')}<//>
      ${own ? html`
        <${Action} disabled=${busy} onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}<//>
        <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.removeExt(ext)}>${x('remove')}<//>` : null}`}>
    <${Stack} density="compact">
      ${ext.description ? html`<${Text}>${ext.description}<//>` : null}
      ${usedLine(ext)}
      ${ids.length ? html`<${Text} kind="mono" tone="muted">${ids.slice(0, 4).join(' · ')}${ids.length > 4 ? ` · +${ids.length - 4}` : ''}<//>` : null}
      ${open ? extOpen(ctx, ext, own) : null}
    <//>
  <//>`;
}

function schemaWords(schema) {
  const props = schema?.properties || (schema && typeof schema === 'object' && !('type' in schema) ? schema : null);
  if (!props || typeof props !== 'object') return '';
  const req = new Set(schema?.required || []);
  return Object.entries(props).filter(([k]) => !['type', 'required', 'properties'].includes(k)).map(([k, v]) => `${k}${req.has(k) ? '*' : ''}: ${(v && typeof v === 'object' && v.type) || '?'}`).join(', ');
}

function extOpen(ctx, ext, own) {
  const d = ctx.details['ext:' + ext.name];
  if (!d) return loadingRecord(t('common.loading'));
  if (d.error) return loadingRecord(d.error);
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
  const inst = ctx.instances[ext.name] || [];
  return html`
    <${Surface} kind="record">
      <${Stack}>
        ${ext.description ? html`<${Text} kind="lead">${ext.description}<//>` : null}
        <${Text} kind="label">${x('actions')}<//>
        <${Stack} density="compact">
          ${(d.actions || []).map((a) => html`<${ListRow} key=${'a' + a.id} density="compact" name=${a.id} detail=${a.method || 'POST'}
            actions=${active && own ? html`<${Action} expanded=${!!(test && test.actionId === a.id)} onClick=${() => ctx.toggleTest(ext, a)}>${test && test.actionId === a.id ? x('close') : x('test')}<//>` : null}>
            <${Stack} density="compact">
              ${a.description ? html`<${Text}>${a.description}<//>` : null}
              <${Text} kind="mono" tone="muted">${x('inputOutput', { input: schemaWords(a.inputSchema || a.input) || x('nothing'), output: schemaWords(a.outputSchema || a.output) || x('nothing') })}<//>
            <//>
          <//>`)}
        <//>
        ${test ? html`
          <${Stack} density="compact">
            <${Field} type="textarea" label=${x('testTitle', { action: test.actionId })} rows=${3} value=${test.input} onInput=${(e) => ctx.setTestInput(e.target.value)} />
            <${Stack} direction="horizontal" align="center">
              <${Action} disabled=${test.running} onClick=${() => ctx.runTest(ext)}>${x('run')}<//>
              <${Text} kind="caption" tone="muted">${x('testHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}<//>
            <//>
            ${test.result ? html`<${Text} kind="label">${test.result.ok ? x('testOk') : x('testFail')}<//>
              <${Surface} kind="code" tone=${test.result.ok ? 'plain' : 'danger'}>${test.result.text}<//>` : null}
          <//>` : null}
        <div>
          ${kv(x('address'), html`<${Text} kind="mono">${address}<//>`, html`${x('addressSub')} · <${CopyAction} kind="text" text=${base + '/'} label=${x('copyAddress')} copiedLabel=${x('copied')} />`)}
          ${kv(x('fromApp'), html`<${Text} kind="mono">${example}<//>`, html`${x('fromAppSub')} · <${CopyAction} kind="text" text=${example} label=${x('copyExample')} copiedLabel=${x('copied')} />`)}
          ${(used.apps || 0) + (used.cortexes || 0)
            ? kv(x('usedBy'), html`${appLinks(used)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}`,
              (used.cortex_names || []).length ? x('usedCortexList', { list: used.cortex_names.join(', ') }) : null)
            : kv(x('usedBy'), x('usedNone'), x('usedNoneSub'))}
          ${kv(x('memoryArea'), html`<${Text} kind="mono">ext:${ext.name}<//>`, x('memoryAreaSub'))}
          ${ext.instances?.supported
            ? kv(x('instances'), html`<${Stack} density="compact">
                ${inst.length ? html`<${Stack} direction="wrap" density="compact">${inst.map((i) => html`<${Chip} key=${i.id}>${i.id} · ${i.status}<//>`)}<//>` : html`<span>${x('instancesNone')}</span>`}
                ${own && active ? html`<${Stack} direction="wrap" align="end" density="compact">
                  <${Field} width="narrow" ariaLabel=${x('instanceIdPlaceholder')} placeholder=${x('instanceIdPlaceholder')} value=${ctx.newInstanceId} onInput=${(e) => ctx.setNewInstanceId(e.target.value)} />
                  <${Action} onClick=${() => ctx.createInstance(ext)}>${x('createInstance')}<//>
                  ${inst.map((i) => html`<${Action} key=${'x' + i.id} tone="danger" onClick=${() => ctx.deleteInstance(ext, i.id)}>${x('deleteInstance', { id: i.id })}<//>`)}
                <//>` : null}
              <//>`, x('instancesSub'))
            : kv(x('instances'), x('instancesUnsupported'), x('instancesSub'))}
          ${kv(x('settings'), cfgKeys.length ? cfgKeys.map((k) => `${k} = ${typeof d.config[k] === 'object' ? JSON.stringify(d.config[k]) : String(d.config[k])}`).join(' · ') : x('settingsNone'), x('settingsSub'))}
          ${kv(x('schedules'), schedules.length ? html`<${Stack} density="compact">${schedules.map((s) => {
            const job = jobs.find((j) => j.actionId === s.action && j.cron === s.cron);
            return html`<${Stack} key=${s.id} density="compact"><span>${s.action} · ${cronWords(s.cron)}</span>${job
              ? html`<${Text} kind="caption" tone="muted">${x('lastRun', { at: when(job.lastRunAt), result: job.lastRunResult === 'success' ? x('runOk') : x('runFail'), n: job.runCount || 0 })}<//>`
              : html`<${Text} kind="caption" tone="coral">${x('notInScheduler')}<//>`}<//>`;
          })}<//>` : x('schedulesNone'))}
          ${kv(x('limits'), x('limitsLine', { mb: d.limits?.memoryMb ?? '?', s: Math.round((d.limits?.timeoutMs ?? 0) / 1000), calls: d.limits?.maxApiCalls ?? '?' }), x('requires', { list: (d.requiredApis || []).join(', ') || x('nothing') }))}
          ${kv(x('state'), `${active ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(ext.installedAt) })}${ext.activatedAt ? ` · ${x('activatedOn', { date: day(ext.activatedAt) })}` : ''}`, x('versionsLine', { current: ext.version, list: (d.versions || []).map((v) => v.version).join(', ') }))}
        </div>
        ${own ? html`<${Stack} direction="wrap">
          <${Action} onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}<//>
          <${Action} tone="danger" onClick=${() => ctx.removeExt(ext)}>${x('removeExt')}<//>
        <//>` : null}
      <//>
    <//>`;
}

export function cortexRow(ctx, cx) {
  const own = cx.installed_by === ctx.session?.owner;
  const open = ctx.expanded === 'cx:' + cx.name;
  const busy = ctx.busy === 'cx:' + cx.name;
  const isPublic = cx.visibility === 'public';
  const used = cx.used_by || {};
  const types = (cx.component_types || []).map((k) => x('part.' + k) || k);
  return html`<${ListRow} key=${'cx:' + cx.name} density="compact" marker=${cx.status === 'active' ? 'success' : 'muted'} name=${named(cx.name, cx.version)}
    detail=${`${isPublic ? x('public') : x('private')} · ${types.join(' + ')}${own ? '' : ' · ' + x('ownedBy', { owner: cx.installed_by || '' })}`}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggleCortex(cx)}>${open ? x('close') : x('open')}<//>
      ${own ? html`
        <${Action} disabled=${busy} onClick=${() => ctx.toggleVisibility(cx)}>${isPublic ? x('makePrivate') : x('publish')}<//>
        <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.removeCortex(cx)}>${x('remove')}<//>` : null}`}>
    <${Stack} density="compact">
      ${cx.description ? html`<${Text}>${cx.description}<//>` : null}
      ${(used.apps || 0)
        ? html`<${Text} kind="caption"><strong>${x('usedBy')}</strong> ${(used.app_names || []).map(appName).join(', ')}${(used.apps || 0) > (used.app_names || []).length ? ' · ' + x('usedMore', { n: used.apps - used.app_names.length }) : ''}<//>`
        : html`<${Text} kind="caption" tone="muted"><strong>${x('usedNoApp')}</strong><//>`}
      ${open ? cortexOpen(ctx, cx, own) : null}
    <//>
  <//>`;
}

function cortexOpen(ctx, cx, own) {
  const d = ctx.details['cx:' + cx.name];
  if (!d) return loadingRecord(t('common.loading'));
  if (d.error) return loadingRecord(d.error);
  const comps = d.components || [];
  const libs = comps.filter((c) => c.type === 'lib');
  const prompts = comps.filter((c) => c.type === 'prompt');
  const tag = (lib) => `<script src="${ctx.nodeUrl}/v1/cortex/${encodeURIComponent(cx.name)}@${cx.version}/libs/${encodeURIComponent(lib.filename)}"></script>`;
  const used = cx.used_by || {};
  return html`
    <${Surface} kind="record">
      <${Stack}>
        ${cx.description ? html`<${Text} kind="lead">${cx.description}<//>` : null}
        <div>
          ${libs.map((lib) => html`
            ${kv(x('intoApp'), html`<${Text} kind="mono">${tag(lib)}<//>`, html`${x('intoAppSub')} · <${CopyAction} kind="text" text=${tag(lib)} label=${x('copyTag')} copiedLabel=${x('copied')} />`)}
            ${lib.api_surface ? kv(x('api'), html`<${Surface} kind="code">${lib.api_surface}<//>`, html`${x('apiSub')} · <${CopyAction} kind="text" text=${lib.api_surface} label=${x('copyApi')} copiedLabel=${x('copied')} />`) : null}`)}
          ${prompts.map((p) => kv(x('prompt'), `${p.name} · ${x('chars', { n: (p._content || '').length })}`, html`${x('promptSub')} · <${CopyAction} kind="text" text=${p._content || ''} label=${x('copyPrompt')} copiedLabel=${x('copied')} />`))}
          ${kv(x('parts'), html`<${Stack} direction="wrap" density="compact">${comps.map((c) => html`<${Chip} key=${c.type + (c.name || c.filename || '')}>${x('part.' + c.type) || c.type} ${c.name || c.filename || c.key_pattern || ''}<//>`)}<//>`)}
          ${(used.apps || 0)
            ? kv(x('usedBy'), html`${appLinks(used)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}`)
            : kv(x('usedBy'), x('usedNoApp'), x('usedNoAppSub'))}
          ${kv(x('visibility'), cx.visibility === 'public' ? x('publicLong') : x('privateLong'))}
          ${kv(x('state'), `${cx.status === 'active' ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(cx.installed_at) })} · ${cx.author || cx.installed_by || ''}${d.license ? ` · ${d.license}` : ''}`, x('versionsLine', { current: cx.version, list: (d.versions || []).map((v) => v.version).join(', ') }))}
        </div>
        ${own ? html`<${Stack} direction="wrap">
          <${Action} onClick=${() => (cx.status === 'active' ? ctx.deactivateCortex(cx) : ctx.activateCortex(cx))}>${cx.status === 'active' ? x('deactivate') : x('activate')}<//>
          <${Action} tone="danger" onClick=${() => ctx.removeCortex(cx)}>${x('removeCortex')}<//>
        <//>` : null}
      <//>
    <//>`;
}
