/**
 * @file public/views/appcat/dialogs/generate.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Generate App with AI" (features F104–F108, F149–F155, F250–F253): the person's own AI,
 *   connected to this node, builds the app and publishes it. The intro and three steps. 1 "Connect
 *   your AI": once, on the connect page (/v1/connect-your-ai, a new tab so the dialog stays).
 *   2 "Describe your app" (the description takes the focus; "Improving: {name}" above it when
 *   improving an app). 3 "Give the prompt to your AI": the short connected prompt
 *   (generate-prompt.js connectedPrompt) and "Copy Prompt" ("✔ Copied!" for 1.4 s; the dialog stays
 *   open). A new app is always Atelier; an app being improved keeps its own track.
 *   Under the steps, folded shut, the road for an AI that cannot connect (Microsoft 365 Copilot, for
 *   one): the long prompt (buildPrompt) on the Classic track for a new app, or on the app's own track
 *   when improving, with the capability packs the idea names and their usage docs, its preview and
 *   copy, and "Add your app", which signs the person in when needed and opens Add on its Paste tab.
 *   Opening the fold reads the packs and the node's two build guides.
 * @structure default GenerateDialog({ app }) · OtherAi
 * @usage openDialog('generate')  — new app.
 *        openDialog('generate', { app: { name, filename, owner, own, track, html } })  — improve that
 *        app (html: its source as text; track: the manifest's track, 'atelier' or anything else for
 *        Classic; owner and filename: where it is on the node; own: false for somebody else's app).
 * @version-history
 *   v2.0.0 — 2026-10-25 — The connected AI is the road (Jouni): connect, describe, give the short
 *     prompt; a new app is Atelier only. The track choice, the template picker and the pack pills
 *     are gone; the long Classic prompt stays, folded, for an AI that cannot connect.
 *   v1.1.0 — 2026-09-27 — Parity: the packs are a group under their label (Field group), the idea field
 *     two lines high; the look of every part is the ruled step's (step-card.css), as the old builder.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old cortex.js prompt builder.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { StepCard } from '/components/StepCard.js';
import { Stack } from '/components/Layout.js';
import { Collapsible } from '/components/Collapsible.js';
import { TextArea } from '/components/TextField.js';
import { copyToClipboard } from '/js/utils.js';
import { x, lang } from '/views/appcat/i18n.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { useFlash } from '/views/appcat/dialogs/parts.js';
import { signInThen } from '/views/appcat/dialogs/app-io.js';
import { buildPrompt, connectedPrompt } from '/views/appcat/dialogs/generate-prompt.js';

const html = htm.bind(h);

/** The pack categories the long prompt carries (the old PB_PACK_CATEGORIES). */
const CATEGORIES = ['visualization', 'diagrams', 'canvas', 'game', '3d', 'realtime'];
/** Pack docs by id, read once (GET /v1/library-packs/{id}). */
const docs = {};

/** Whether a pack's interview triggers match the idea at a word start (suffixes allowed). */
function matches(pack, text) {
  return (pack.interviewTriggers || []).some((t) => {
    const esc = String(t).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-zà-öø-ÿ])' + esc).test(text);
  });
}

async function getJson(path) {
  const resp = await fetch(path);
  return resp.json();
}

/**
 * The road for an AI that cannot connect: the long prompt with everything the AI cannot fetch
 * itself, and the Add dialog for the file it hands back. Mounted only while the fold is open, so
 * the dialog reads the packs and the build guides only for the person who needs them.
 */
function OtherAi({ app, description, l }) {
  const track = app && app.track === 'atelier' ? 'atelier' : 'classic';
  const [packs, setPacks] = useState([]);
  const [core, setCore] = useState({ new: null, improve: null });
  const [coreAtelier, setCoreAtelier] = useState({ new: null, improve: null });
  const [, setDocTick] = useState(0);
  const [copied, flashCopied] = useFlash(1400);

  useEffect(() => {
    let live = true;
    if (track === 'classic') {
      getJson('/v1/library-packs?lang=' + encodeURIComponent(l)).then((d) => {
        const all = (d.data && d.data.packs) || [];
        const list = all.filter((p) => {
          if (p.status === 'deprecated') return false;
          if (p.kind === 'vendored' || p.kind === 'bundle') return CATEGORIES.includes(p.category);
          if (p.kind === 'cortex') return CATEGORIES.includes(p.category) && p.id !== 'aimeat-charts';
          return false;
        });
        if (live) setPacks(list);
      }).catch((e) => console.warn('[appcat] capability packs not read (an older node)', e));
    }
    for (const mode of ['new', 'improve']) {
      if (track === 'classic') {
        getJson('/v1/prompts/build-app?mode=' + mode + '&lang=' + encodeURIComponent(l)).then((d) => {
          const body = d && d.data && d.data.body;
          if (live && body && typeof body === 'string') setCore((c) => ({ ...c, [mode]: body }));
        }).catch((e) => console.warn('[appcat] the Classic build guide not read; the inline text is used', e));
      } else {
        getJson('/v1/prompts/build-app-atelier?mode=' + mode + '&lang=' + encodeURIComponent(l)).then((d) => {
          const full = d && d.data && d.data.prompt;
          if (live && full && typeof full === 'string') setCoreAtelier((c) => ({ ...c, [mode]: full }));
        }).catch((e) => console.warn('[appcat] the Atelier build guide not read', e));
      }
    }
    return () => { live = false; };
  }, [l, track]);

  // The packs the idea names travel with their usage docs: a chat AI cannot fetch them itself.
  const lower = String(description || '').toLowerCase();
  const picked = packs.filter((p) => matches(p, lower));
  useEffect(() => {
    for (const p of picked) {
      if (docs[p.id]) continue;
      getJson('/v1/library-packs/' + encodeURIComponent(p.id))
        .then((d) => { const pack = d.data && d.data.pack; if (pack) { docs[p.id] = pack; setDocTick((n) => n + 1); } })
        .catch((e) => console.warn('[appcat] pack doc not read; the core text still names the packs', e));
    }
    // picked is derived; the ids are what matter, so this runs when they change and not on every key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.map((p) => p.id).join(',')]);

  const prompt = buildPrompt({
    track, app: app || null, description, lang: l, core, coreAtelier, template: null,
    packs: picked.map((p) => docs[p.id]), atelierLoading: x('pb.atelierLoading'),
  });
  const addApp = () => signInThen(() => openDialog('add', { tab: 'paste' }));

  return html`<${Stack} gap="small">
    <${Note} kind="hint">${x('pb.otherHint')}${app ? '' : ' ' + x('pb.otherClassic')}<//>
    ${picked.length ? html`<${Note} kind="hint">${x('pb.otherPacks')}: ${picked.map((p) => p.title || p.id).join(' · ')}<//>` : null}
    <${Label} ruled>${x('pb.promptPreview')}<//>
    <${Code} block scroll>${prompt}<//>
    <div><${Action} onClick=${async () => { await copyToClipboard(prompt); flashCopied(); }}>${copied ? '✔ ' + x('pb.copied') : x('pb.otherCopy')}<//></div>
    <${Note} kind="hint">${x('pb.step3hint')}<//>
    <div><${Action} onClick=${addApp}>${x('pb.otherAdd')}<//></div>
  <//>`;
}

export default function GenerateDialog({ app, close }) {
  const improving = !!app;
  const l = lang();
  const [description, setDescription] = useState('');
  const [other, setOther] = useState(false);
  const [copied, flashCopied] = useFlash(1400);

  const prompt = connectedPrompt({ app: app || null, description, lang: l });

  return html`<${Dialog} title=${x('pb.title')} size="lg" footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Note} kind="lead">${x(improving ? 'pb.introImprove' : 'pb.introConnected')}<//>
    <${StepCard} rule num="1" title=${x('pb.connectStep')}>
      <${Stack} gap="small">
        <${Note} kind="hint">${x('pb.connectHint')}<//>
        <div><${Action} href="/v1/connect-your-ai" newTab>${x('pb.connectBtn')}<//></div>
      <//>
    <//>
    <${StepCard} rule num="2" title=${x(improving ? 'pb.changeStep' : 'pb.step1')}>
      <${Stack} gap="medium">
        ${improving ? html`<${Note} kind="report" tone="refused" role="note"><strong>${x('pb.improving')}: ${app.name || app.filename || x('pb.thisApp')}</strong><//>` : null}
        <${TextArea} autoFocus rows=${3} ariaLabel=${x(improving ? 'pb.changeStep' : 'pb.step1')} placeholder=${x(improving ? 'pb.changePh' : 'pb.descPhNew')}
          value=${description} onInput=${setDescription} />
      <//>
    <//>
    <${StepCard} rule num="3" title=${x('pb.giveStep')}>
      <${Stack} gap="small">
        <${Note} kind="hint">${x(improving ? 'pb.giveHintImprove' : 'pb.giveHint')}<//>
        <${Label} ruled>${x('pb.promptPreview')}<//>
        <${Code} block scroll>${prompt}<//>
        <div><${Loud} control onClick=${async () => { await copyToClipboard(prompt); flashCopied(); }}>${copied ? '✔ ' + x('pb.copied') : x('pb.copy')}<//></div>
      <//>
    <//>
    <${Collapsible} title=${x('pb.otherTitle')} open=${other} onToggle=${() => setOther((o) => !o)}>
      <${OtherAi} app=${app || null} description=${description} l=${l} />
    <//>
  <//>`;
}
