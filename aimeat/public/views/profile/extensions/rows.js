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
 *   Made of the component kit: the rows pass data and never a class.
 * @structure extRow · extOpen · cortexRow · cortexOpen
 * @usage import { extRow, cortexRow } from './rows.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): a row is
 *     the List's Row (the status dot and the version tag are the Name's `dot` and `tag`), who uses it
 *     the typewriter Cell with its bold head word (main's .ex-me: ink, grey when nothing is seen), the
 *     opened row the List's Panel with its doors, the action table a List of the id-desc-doors cut,
 *     the test a Box with the typewriter Text area, the facts Facts (the copies are Action
 *     links with `copy`, a schedule's lines FactLine with the coral "not in the scheduler"; the test
 *     box is the Box's field tone, Jouni's "Dashed field box", which kept Extensions' look), the
 *     instances and parts Marks, the new-instance field a TextField with its actions.
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
import { List, Row, Name, Desc, Cell, Doors, Panel } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { TextField, TextArea } from '/components/TextField.js';
import { x, day, when, kindOf, cronWords, appName, appUrlOf } from './frame.js';

/** A copy inside a fact's grey line: the coral link that says it copied. */
const copyLink = (text, label) => html`<${Action} tone="link" copy=${text} copiedLabel=${x('copied')}>${label}<//>`;
/** The apps that use a thing, each a link to the app, and how many more. */
const appLinks = (used) => html`${(used.app_names || []).map((ref) => html`<${Action} tone="link" key=${ref} href=${appUrlOf(ref)} newTab>${appName(ref)}<//> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - used.app_names.length }) : ''}`;

/** Who uses an extension: apps, a clock, or nothing visible, as the typewriter cell's head and words. */
function usedCell(ext, ids) {
  const u = ext.used_by || {};
  const kind = kindOf(ext);
  const sub = html`${ids.slice(0, 4).join(' · ')}${ids.length > 4 ? ` · +${ids.length - 4}` : ''}`;
  if (kind === 'apps') {
    const names = (u.app_names || []).map(appName);
    const more = (u.apps || 0) - names.length;
    const parts = [names.join(', '), more > 0 ? x('usedMore', { n: more }) : '', u.cortexes ? x('usedCortexes', { n: u.cortexes }) : ''].filter(Boolean);
    return html`<${Cell} meta head=${x('usedBy')} sub=${sub}>${parts.join(' · ')}<//>`;
  }
  if (kind === 'background') return html`<${Cell} meta head=${x('kindBackground')} sub=${sub}>${(ext.schedules || []).map((s) => cronWords(s.cron)).join(' · ')}<//>`;
  return html`<${Cell} meta head=${x('kindUnseen')} headDim sub=${sub}>${x('kindUnseenSub')}<//>`;
}

export function extRow(ctx, ext) {
  const own = ext.installedBy === ctx.session?.owner;
  const active = ext.status === 'active';
  const open = ctx.expanded === 'ext:' + ext.name;
  const busy = ctx.busy === 'ext:' + ext.name;
  const ids = (ext.actions || []).map((a) => a.id);
  return html`
    <${Row} key=${'ext:' + ext.name} open=${open}>
      <${Name} dot=${active ? 'active' : 'inactive'} tag=${'v' + (ext.version || '?')}
        meta=${`${active ? x('stateActive') : x('stateOff')} · ${x('actionsN', { n: ext.actionCount ?? ids.length })}${own ? '' : ' · ' + x('ownedBy', { owner: ext.installedBy || ext.author || '' })}`}>${ext.name}<//>
      <${Desc}>${ext.description || ''}<//>
      ${usedCell(ext, ids)}
      <${Doors}>
        <${Action} small row onClick=${() => ctx.toggleExt(ext)}>${open ? x('close') : x('open')}<//>
        ${own ? html`
          <${Action} small row soft disabled=${busy} onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}<//>
          <${Action} small row soft disabled=${busy} onClick=${() => ctx.removeExt(ext)}>${x('remove')}<//>` : null}
      <//>
      ${open ? extOpen(ctx, ext, own) : null}
    <//>`;
}

function schemaWords(schema) {
  const props = schema?.properties || (schema && typeof schema === 'object' && !('type' in schema) ? schema : null);
  if (!props || typeof props !== 'object') return '';
  const req = new Set(schema?.required || []);
  return Object.entries(props).filter(([k]) => !['type', 'required', 'properties'].includes(k)).map(([k, v]) => `${k}${req.has(k) ? '*' : ''}: ${(v && typeof v === 'object' && v.type) || '?'}`).join(', ');
}

/** What an opened row shows while its details load, or when they could not be read. */
function waitPanel(d) {
  if (!d) return html`<${Panel}><${Note} kind="loading">${t('common.loading')}<//><//>`;
  return html`<${Panel}><${Note} kind="quiet">${d.error}<//><//>`;
}

/** The test of one action: its input, the run, what it answered. */
function testBox(ctx, ext, test) {
  return html`
    <${Box} tone="field">
      <${Label} block>${x('testTitle', { action: test.actionId })}<//>
      <${TextArea} code rows=${3} value=${test.input} onInput=${(v) => ctx.setTestInput(v)} />
      <${Actions}><${Action} small disabled=${test.running} onClick=${() => ctx.runTest(ext)}>${x('run')}<//><${Note} inline>${x('testHint')}${test.elapsed ? ` · ${test.elapsed} ms` : ''}<//><//>
      ${test.result ? html`<${Label} block>${test.result.ok ? x('testOk') : x('testFail')}<//><${Code} block scroll>${test.result.text}<//>` : null}
    <//>`;
}

function extOpen(ctx, ext, own) {
  const d = ctx.details['ext:' + ext.name];
  if (!d || d.error) return waitPanel(d);
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
  const instances = ctx.instances[ext.name] || [];
  const doors = own ? html`
    <${Action} small onClick=${() => (active ? ctx.deactivateExt(ext) : ctx.activateExt(ext))}>${active ? x('deactivate') : x('activate')}<//>
    <${Action} small soft onClick=${() => ctx.removeExt(ext)}>${x('removeExt')}<//>` : null;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${ext.description || ''}<//>
      <${Label} block>${x('actions')}<//>
      <${List} cols="id-desc-doors">
        ${(d.actions || []).map((a) => html`
          <${Row} key=${a.id}>
            <${Name} code meta=${a.method || 'POST'}>${a.id}<//>
            <${Desc} sub=${x('inputOutput', { input: schemaWords(a.inputSchema || a.input) || x('nothing'), output: schemaWords(a.outputSchema || a.output) || x('nothing') })}>${a.description || ''}<//>
            <${Doors}>${active && own ? html`<${Action} small row soft onClick=${() => ctx.toggleTest(ext, a)}>${test && test.actionId === a.id ? x('close') : x('test')}<//>` : null}<//>
          <//>`)}
      <//>
      ${test ? testBox(ctx, ext, test) : null}
      <${Facts} rows=${[
        { k: x('address'), v: address, mono: true, sub: html`${x('addressSub')} · ${copyLink(base + '/', x('copyAddress'))}` },
        { k: x('fromApp'), v: example, mono: true, sub: html`${x('fromAppSub')} · ${copyLink(example, x('copyExample'))}` },
        (used.apps || 0) + (used.cortexes || 0)
          ? { k: x('usedBy'), v: appLinks(used), sub: (used.cortex_names || []).length ? x('usedCortexList', { list: used.cortex_names.join(', ') }) : undefined }
          : { k: x('usedBy'), v: x('usedNone'), sub: x('usedNoneSub') },
        { k: x('memoryArea'), v: `ext:${ext.name}`, mono: true, sub: x('memoryAreaSub') },
        ext.instances?.supported
          ? {
            k: x('instances'),
            v: instances.length ? html`<${Marks}>${instances.map((i) => html`<${Mark} key=${i.id}>${i.id} · ${i.status}<//>`)}<//>` : x('instancesNone'),
            sub: x('instancesSub'),
            actions: own && active ? html`<${TextField} placeholder=${x('instanceIdPlaceholder')} value=${ctx.newInstanceId} onInput=${(v) => ctx.setNewInstanceId(v)}
              actions=${html`<${Action} small onClick=${() => ctx.createInstance(ext)}>${x('createInstance')}<//>${instances.map((i) => html`<${Action} small soft key=${'x' + i.id} onClick=${() => ctx.deleteInstance(ext, i.id)}>${x('deleteInstance', { id: i.id })}<//>`)}`} />` : null,
          }
          : { k: x('instances'), v: x('instancesUnsupported'), sub: x('instancesSub') },
        { k: x('settings'), v: cfgKeys.length ? cfgKeys.map((k) => `${k} = ${typeof d.config[k] === 'object' ? JSON.stringify(d.config[k]) : String(d.config[k])}`).join(' · ') : x('settingsNone'), sub: x('settingsSub') },
        {
          k: x('schedules'),
          v: schedules.length ? schedules.map((s) => {
            const job = jobs.find((j) => j.actionId === s.action && j.cron === s.cron);
            return html`<${FactLine} key=${s.id} sub=${job ? x('lastRun', { at: when(job.lastRunAt), result: job.lastRunResult === 'success' ? x('runOk') : x('runFail'), n: job.runCount || 0 }) : x('notInScheduler')} subTone=${job ? undefined : 'notice'}>${s.action} · ${cronWords(s.cron)}<//>`;
          }) : x('schedulesNone'),
        },
        { k: x('limits'), v: x('limitsLine', { mb: d.limits?.memoryMb ?? '?', s: Math.round((d.limits?.timeoutMs ?? 0) / 1000), calls: d.limits?.maxApiCalls ?? '?' }), sub: x('requires', { list: (d.requiredApis || []).join(', ') || x('nothing') }) },
        { k: x('state'), v: `${active ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(ext.installedAt) })}${ext.activatedAt ? ` · ${x('activatedOn', { date: day(ext.activatedAt) })}` : ''}`, sub: x('versionsLine', { current: ext.version, list: (d.versions || []).map((v) => v.version).join(', ') }) },
      ]} />
    <//>`;
}

export function cortexRow(ctx, cx) {
  const own = cx.installed_by === ctx.session?.owner;
  const open = ctx.expanded === 'cx:' + cx.name;
  const busy = ctx.busy === 'cx:' + cx.name;
  const isPublic = cx.visibility === 'public';
  const used = cx.used_by || {};
  const types = (cx.component_types || []).map((k) => x('part.' + k) || k);
  return html`
    <${Row} key=${'cx:' + cx.name} open=${open}>
      <${Name} dot=${cx.status === 'active' ? 'active' : 'inactive'} tag=${'v' + (cx.version || '?')}
        meta=${`${isPublic ? x('public') : x('private')} · ${types.join(' + ')}${own ? '' : ' · ' + x('ownedBy', { owner: cx.installed_by || '' })}`}>${cx.name}<//>
      <${Desc}>${cx.description || ''}<//>
      ${(used.apps || 0)
        ? html`<${Cell} meta head=${x('usedBy')}>${(used.app_names || []).map(appName).join(', ')}${(used.apps || 0) > (used.app_names || []).length ? ' · ' + x('usedMore', { n: used.apps - used.app_names.length }) : ''}<//>`
        : html`<${Cell} meta head=${x('usedNoApp')} headDim />`}
      <${Doors}>
        <${Action} small row onClick=${() => ctx.toggleCortex(cx)}>${open ? x('close') : x('open')}<//>
        ${own ? html`
          <${Action} small row soft disabled=${busy} onClick=${() => ctx.toggleVisibility(cx)}>${isPublic ? x('makePrivate') : x('publish')}<//>
          <${Action} small row soft disabled=${busy} onClick=${() => ctx.removeCortex(cx)}>${x('remove')}<//>` : null}
      <//>
      ${open ? cortexOpen(ctx, cx, own) : null}
    <//>`;
}

function cortexOpen(ctx, cx, own) {
  const d = ctx.details['cx:' + cx.name];
  if (!d || d.error) return waitPanel(d);
  const comps = d.components || [];
  const libs = comps.filter((c) => c.type === 'lib');
  const prompts = comps.filter((c) => c.type === 'prompt');
  const tag = (lib) => `<script src="${ctx.nodeUrl}/v1/cortex/${encodeURIComponent(cx.name)}@${cx.version}/libs/${encodeURIComponent(lib.filename)}"></script>`;
  const used = cx.used_by || {};
  const doors = own ? html`
    <${Action} small onClick=${() => (cx.status === 'active' ? ctx.deactivateCortex(cx) : ctx.activateCortex(cx))}>${cx.status === 'active' ? x('deactivate') : x('activate')}<//>
    <${Action} small soft onClick=${() => ctx.removeCortex(cx)}>${x('removeCortex')}<//>` : null;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${cx.description || ''}<//>
      <${Facts} rows=${[
        ...libs.flatMap((lib) => [
          { key: 'k' + lib.filename, k: x('intoApp'), v: tag(lib), mono: true, sub: html`${x('intoAppSub')} · ${copyLink(tag(lib), x('copyTag'))}` },
          lib.api_surface && { key: 'a' + lib.filename, k: x('api'), v: html`<${Code} block>${lib.api_surface}<//>`, sub: html`${x('apiSub')} · ${copyLink(lib.api_surface, x('copyApi'))}` },
        ]),
        ...prompts.map((p) => ({ key: 'p' + p.name, k: x('prompt'), v: `${p.name} · ${x('chars', { n: (p._content || '').length })}`, sub: html`${x('promptSub')} · ${copyLink(p._content || '', x('copyPrompt'))}` })),
        { k: x('parts'), v: html`<${Marks}>${comps.map((c) => html`<${Mark} key=${c.type + (c.name || c.filename || '')}>${x('part.' + c.type) || c.type} ${c.name || c.filename || c.key_pattern || ''}<//>`)}<//>` },
        (used.apps || 0)
          ? { k: x('usedBy'), v: appLinks(used) }
          : { k: x('usedBy'), v: x('usedNoApp'), sub: x('usedNoAppSub') },
        { k: x('visibility'), v: cx.visibility === 'public' ? x('publicLong') : x('privateLong') },
        { k: x('state'), v: `${cx.status === 'active' ? x('stateActive') : x('stateOff')} · ${x('installedOn', { date: day(cx.installed_at) })} · ${cx.author || cx.installed_by || ''}${d.license ? ` · ${d.license}` : ''}`, sub: x('versionsLine', { current: cx.version, list: (d.versions || []).map((v) => v.version).join(', ') }) },
      ]} />
    <//>`;
}
