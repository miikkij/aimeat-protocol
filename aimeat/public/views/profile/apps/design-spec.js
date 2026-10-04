/**
 * @file public/views/profile/apps/design-spec.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design spec of one app, shown as a section of the app's page in the App
 *   Catalog (appcat/sections/spec.js): the one document that says what the app is for, its
 *   screens, where its data lives, what was decided and what is open, for everybody who builds it.
 *
 *   Jouni, 2026-10-02: a developer shared an app with him and nothing anywhere said what the app
 *   was. The spec lives beside the app on this page, where the right to build it is given, so the
 *   next builder finds it in the same place. The chat path comes first: an AI connected over MCP
 *   reads and writes it with aimeat_app_manage, and this block hands over the prompt. An AI without
 *   that connection gets the second prompt, answers with the whole document, and the paste box
 *   saves it through the same route the page uses. Editing by hand is the fallback, in a text
 *   area, for the person who just wants to fix a line.
 *
 *   Made of the component kit: the block passes data and never a class.
 * @structure DesignSpecBlock({ ctx, app, path, owner, heading })
 * @usage html`<${DesignSpecBlock} key=${path} ctx=${ctx} app=${app} path=${path} owner=${owner} />`
 * @version-history
 *   v1.2.0 — 2026-10-04 — Settings > Apps no longer shows it; the App Catalog's app page is its place.
 *   v1.1.0 — 2026-10-04 — `heading={false}` leaves the block's own heading out, for the App Catalog's
 *     app page, whose section draws the headline (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Markdown } from '/components/Markdown.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { TextArea } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Space } from '/components/Layout.js';
import { PromptCard } from '/components/PromptCard.js';
import { PasteBox } from '/components/PasteBox.js';
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { getNodeUrl } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';
import { a, nameOf, day } from './frame.js';
import { buildSpecMcpPrompt, buildSpecPastePrompt, readSpecAnswer } from './design-spec.prompt.js';

const html = htm.bind(h);

/** The code a refused call carried, wherever the client put it. */
const codeOf = (err) => err?.error?.code || err?.response?.error?.code || '';

export function DesignSpecBlock({ ctx, app, path, owner, heading = true }) {
  const [read, setRead] = useState({ state: 'loading', spec: null, stale: false, appVersion: 0, template: '' });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [paste, setPaste] = useState('');
  const [removing, setRemoving] = useState(false);
  // A reload is one more tick: the effect below reads whenever the app or the tick changes, and a
  // read that lands after the app changed is dropped, so a slow answer never shows under the next app.
  const [tick, setTick] = useState(0);
  const load = () => setTick((n) => n + 1);

  useEffect(() => {
    let active = true;
    apiGet(`${path}/design-spec`).then((res) => {
      if (!active) return;
      const d = res?.data || {};
      setRead({ state: 'ready', spec: d.design_spec || null, stale: !!d.stale, appVersion: d.app_version || 0, template: d.template || '' });
    }).catch((err) => { swallowed('apps: design spec', err); if (active) setRead((r) => ({ ...r, state: 'failed' })); });
    return () => { active = false; };
  }, [path, tick]);

  const spec = read.spec;
  const current = spec?.markdown || read.template;

  async function save(markdown, expectedRevision) {
    setBusy(true);
    try {
      const body = { markdown, ...(typeof expectedRevision === 'number' ? { expected_revision: expectedRevision } : {}) };
      const res = await apiPut(`${path}/design-spec`, body);
      const d = res?.data || {};
      ctx.showToast?.(d.unchanged ? a('specConfirmedToast', { version: d.design_spec?.version }) : a('specSavedToast'));
      setEditing(false); setPaste(''); setAsking(false);
      load();
    } catch (err) {
      // The person sees the refusal in a toast; the text they typed stays in the field.
      swallowed('apps: design spec save', err);
      ctx.showToast?.(codeOf(err) === 'REVISION_MISMATCH' ? a('specConflict') : (err?.error?.message || err?.message || a('specFailed')), true);
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiDelete(`${path}/design-spec`);
      ctx.showToast?.(a('specRemovedToast'));
      setRemoving(false);
      load();
    } catch (err) {
      swallowed('apps: design spec remove', err);
      ctx.showToast?.(err?.error?.message || err?.message || a('specFailed'), true);
    } finally { setBusy(false); }
  }

  function startEditing() { setText(current); setEditing(true); setAsking(false); }

  function saveAnswer() {
    const r = readSpecAnswer(paste);
    if (!r.ok) { ctx.showToast?.(a('specPasteEmpty'), true); return; }
    save(r.markdown, spec?.revision);
  }

  const mcpPrompt = buildSpecMcpPrompt({ url: getNodeUrl(), owner: app.owner, filename: app.filename, name: nameOf(app), present: !!spec, stale: read.stale });
  const pastePrompt = buildSpecPastePrompt({ name: nameOf(app), current });

  return html`<${Space} above=${heading ? 'large' : 'none'}>
    ${heading ? html`<${SubHeading} level=${3}>${a('specTitle')}<//>` : null}
    <${Note}>${a('specLead')}<//>
    ${read.state === 'loading' ? html`<${Note} kind="loading">${a('specLoading')}<//>` : null}
    ${read.state === 'failed' ? html`<${Note} kind="quiet" role="alert">${a('specFailed')}<//>` : null}
    ${read.state === 'ready' && !editing ? html`
      ${spec ? html`
        <${Note} kind="meta">${a('specMeta', { who: spec.updatedBy, date: day(spec.updatedAt), version: spec.version })}<//>
        ${read.stale
          ? html`<${Note} kind="state" tone="attention">${a('specStale', { version: read.appVersion, written: spec.version })}<//>`
          : html`<${Note} kind="state" tone="fine">${a('specCurrent', { version: spec.version })}<//>`}
        <${Markdown} text=${spec.markdown} small scroll />
      ` : html`<${Note} kind="quiet">${a('specNone')}<//>`}
      <${Actions}>
        <${Action} small disabled=${busy} onClick=${startEditing}>${spec ? a('specEdit') : a('specWrite')}<//>
        ${spec && read.stale ? html`<${Action} small disabled=${busy} onClick=${() => save(spec.markdown, spec.revision)}>${a('specConfirm')}<//>` : null}
        <${Action} small soft disabled=${busy} onClick=${() => setAsking(!asking)}>${asking ? a('specAskHide') : a('specAsk')}<//>
        ${spec && owner ? html`<${Action} small soft disabled=${busy || removing} onClick=${() => setRemoving(true)}>${a('specRemove')}<//>` : null}
      <//>
      ${removing ? html`<${Space} above="small">
        <${Note} kind="quiet" role="alert">${a('specRemoveAsk')}<//>
        <${Actions}>
          <${Loud} control danger disabled=${busy} onClick=${remove}>${a('specRemoveYes')}<//>
          <${Action} small onClick=${() => setRemoving(false)}>${a('specKeep')}<//>
        <//>
      <//>` : null}
      ${asking ? html`<${Space} above="medium">
        <${PromptCard} loud label=${a('specMcpLabel')} prompt=${mcpPrompt} showPrompt=${false}
          copyLabel=${a('specCopy')} copiedLabel=${a('specCopied')} />
        <${Note}>${a('specMcpHint')}<//>
        <${PromptCard} quiet label=${a('specPasteLabel')} prompt=${pastePrompt} showPrompt=${false}
          copyLabel=${a('specCopy')} copiedLabel=${a('specCopied')} />
        <${Note}>${a('specPasteHint')}<//>
        <${PasteBox} id=${`ap-spec-paste-${app.owner}-${app.filename}`} label=${a('specPasteBox')} placeholder=${a('specPastePh')}
          value=${paste} onInput=${(e) => setPaste(e.target.value)} />
        <${Actions}>
          <${Loud} control disabled=${busy || !paste.trim()} onClick=${saveAnswer}>${a('specPasteSave')}<//>
        <//>
      <//>` : null}
    ` : null}
    ${read.state === 'ready' && editing ? html`
      <form onSubmit=${(e) => { e.preventDefault(); save(text, spec?.revision); }}>
        <${Fields}>
          <${TextArea} wide label=${a('specTextLabel')} rows=${18} maxLength="65536" required value=${text} onInput=${setText} />
        <//>
        <${Space} above="medium">
          <${FormActions}>
            <${Loud} control type="submit" disabled=${busy || text.trim().length < 3}>${a('specSave')}<//>
            <${Action} small onClick=${() => setEditing(false)}>${a('specCancel')}<//>
          <//>
        <//>
      </form>
    ` : null}
  <//>`;
}
