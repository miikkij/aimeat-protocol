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
 *   open). Every app is built and changed with the Atelier specification; an app built on the
 *   retired Classic track is moved with its section `from-classic`.
 *   Under the steps, folded shut, the road for an AI that cannot connect (Microsoft 365 Copilot, for
 *   one): the long prompt (buildPrompt), which is the Atelier specification for pasting with how the
 *   person publishes the file by hand, its preview and copy, and "Add your app", which signs the
 *   person in when needed and opens Add on its Paste tab. Opening the fold reads the specification.
 * @structure default GenerateDialog({ app }) · OtherAi
 * @usage openDialog('generate')  — new app.
 *        openDialog('generate', { app: { name, filename, owner, own, track, html } })  — improve that
 *        app (html: its source as text; track: the manifest's track, 'atelier' or anything else for
 *        an app built on the Classic track; owner and filename: where it is on the node; own: false
 *        for somebody else's app).
 * @version-history
 *   v3.0.0 — 2026-11-19 — Atelier is the only build guide: the long prompt is the Atelier
 *     specification for pasting (?delivery=paste) for every app, plus section `from-classic` for an
 *     app built on the Classic track. The capability packs and the Classic guide are gone from it.
 *   v2.1.0 — 2026-10-25 — No "Connect your AI" step for a person whose AI has connected (the node's
 *     journey stage `connect`); the steps then start from the description (Jouni). On the prompt road
 *     the "Your AI cannot connect?" fold starts open.
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
import { useAiConnected } from '/views/home/journey-steps.js';

const html = htm.bind(h);

async function getJson(path) {
  const resp = await fetch(path);
  return resp.json();
}

/**
 * The road for an AI that cannot connect: the Atelier specification for pasting (with how the person
 * publishes the file by hand), and the Add dialog for the file it hands back. An app built on the
 * retired Classic track also gets the section that moves it. Mounted only while the fold is open, so
 * the dialog reads the specification only for the person who needs it.
 */
function OtherAi({ app, description, l }) {
  const improve = !!app;
  const fromClassic = improve && app.track !== 'atelier';
  const [core, setCore] = useState(null);
  const [move, setMove] = useState('');
  const [copied, flashCopied] = useFlash(1400);

  useEffect(() => {
    let live = true;
    setCore(null);
    getJson('/v1/prompts/build-app-atelier?mode=' + (improve ? 'improve' : 'new') + '&delivery=paste&lang=' + encodeURIComponent(l)).then((d) => {
      const full = d && d.data && d.data.prompt;
      if (live && full && typeof full === 'string') setCore(full);
    }).catch((e) => console.warn('[appcat] the Atelier build guide not read', e));
    if (fromClassic) {
      fetch('/v1/prompts/build-app-atelier/sections/from-classic?format=txt')
        .then((r) => (r.ok ? r.text() : ''))
        .then((text) => { if (live) setMove(text); })
        .catch((e) => console.warn('[appcat] the section that moves a Classic app not read', e));
    }
    return () => { live = false; };
  }, [l, improve, fromClassic]);

  const prompt = buildPrompt({ app: app || null, description, core, move, atelierLoading: x('pb.atelierLoading') });
  const addApp = () => signInThen(() => openDialog('add', { tab: 'paste' }));

  return html`<${Stack} gap="small">
    <${Note} kind="hint">${x('pb.otherHint')}<//>
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
  // The node knows whether this person's AI has connected: then there is nothing to connect, and the
  // steps start from the description. While that is being read, the step stays away rather than
  // showing and vanishing. A person who said their AI cannot connect finds the long prompt open.
  const { connected, road } = useAiConnected();
  useEffect(() => { if (road === 'prompt') setOther(true); }, [road]);
  const first = connected === false ? 1 : 0;

  const prompt = connectedPrompt({ app: app || null, description, lang: l });

  return html`<${Dialog} title=${x('pb.title')} size="lg" footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Note} kind="lead">${x(improving ? 'pb.introImprove' : 'pb.introConnected')}<//>
    ${first ? html`<${StepCard} rule num="1" title=${x('pb.connectStep')}>
      <${Stack} gap="small">
        <${Note} kind="hint">${x('pb.connectHint')}<//>
        <div><${Action} href="/v1/connect-your-ai" newTab>${x('pb.connectBtn')}<//></div>
      <//>
    <//>` : null}
    <${StepCard} rule num=${String(first + 1)} title=${x(improving ? 'pb.changeStep' : 'pb.step1')}>
      <${Stack} gap="medium">
        ${improving ? html`<${Note} kind="report" tone="refused" role="note"><strong>${x('pb.improving')}: ${app.name || app.filename || x('pb.thisApp')}</strong><//>` : null}
        <${TextArea} autoFocus rows=${3} ariaLabel=${x(improving ? 'pb.changeStep' : 'pb.step1')} placeholder=${x(improving ? 'pb.changePh' : 'pb.descPhNew')}
          value=${description} onInput=${setDescription} />
      <//>
    <//>
    <${StepCard} rule num=${String(first + 2)} title=${x('pb.giveStep')}>
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
