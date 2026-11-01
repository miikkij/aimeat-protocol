/**
 * @file public/views/home/build-with-you.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Rakennamme kanssasi" on the home of a node the store sold: the offer, the request
 *   form, the request's place in the queue, the guide to the organism made for it on the queue's
 *   node, and the finish. One card whose content follows the request's state (Jouni, 1.11 16.22).
 *
 *   ONLY ON A CUSTOMER'S NODE (site.js customerNode()), AND ONLY ONCE THE NODE OPENS THE OFFER.
 *   GET /v1/build-with-you/request says whether the offer is open (offer.available, after the first
 *   MCP connection or the first chat turn on the place's key) and holds the request once it is sent.
 *   The card draws nothing until the offer is open, while the node has no queue, or when the read
 *   fails, so an older node without the route shows the home as it was.
 *
 *   THE BUILD CODE (1.11, after Jouni turned down the queue submit agent at 18.18): when the node
 *   holds a code for the order (`buildCode`, AIMEAT_SITE_BUILD_CODE), the person's own AI sends the
 *   request from their own aimeat.io account, and the card shows the code and the three steps
 *   instead of the form. The form and the queue states stay for a node that still has a queue.
 *
 *   NO TIME PROMISES. The queue's position and length are shown as numbers, and the state as a word;
 *   nothing on the card says when the work will be done.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure BuildWithYou() · internal: BuildCodeCard, OfferForm, QueueStatus, InvitedGuide, Finished,
 *   SpecRows
 * @usage html`<${BuildWithYou} />` (views/home/index.js, under the buyer's welcome)
 * @version-history
 *   v1.1.1 — 2026-11-01 — "Connect the chat" opens the Access page at its MCP servers section.
 *   v1.1.0 — 2026-11-01 — BuildCodeCard: the build code and three steps, shown when the node has a
 *     code and no request (commercial-1c and aimeat-protocol-4e, the new model); aimeat.io is the
 *     node's queueOrigin, and the place's chat is the second way in when the node has it. Step 1
 *     says to pick an agent with full access on aimeat.io's consent page: the queue's tool needs
 *     exchange:write and ext:invoke.
 *   v1.0.1 — 2026-11-01 — The first state names the operator: the operator's agent takes the request
 *     to the queue, not the place. The node calls it 'waiting-for-operator' ('received' before).
 *   v1.0.0 — 2026-11-01 — Initial (Jouni, 1.11 16.22, via Grok and commercial-1c; the node's routes
 *     and the queue are aimeat-protocol-4e's and aimeat-apps-c9's).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import { customerNode } from '/js/site.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { CopyButton } from '/components/CopyButton.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), s);

const KEY = 'build-with-you';
const PATH = '/v1/build-with-you/request';
/** Where the build request is sent when the node has no queue address (the store's own node). */
const AIMEAT_ORIGIN = 'https://aimeat.io';

/** The four parts of the request, in the order the person fills them. */
const SPEC = [
  { id: 'what', long: true, label: ['home.buildWithYou.what', 'What'],
    hint: ['home.buildWithYou.whatHint', 'For example, an agent that gathers the week\'s customer feedback into one summary.'] },
  { id: 'forWhom', label: ['home.buildWithYou.forWhom', 'For whom'],
    hint: ['home.buildWithYou.forWhomHint', 'You, your team or your customers.'] },
  { id: 'use', long: true, label: ['home.buildWithYou.use', 'What for'],
    hint: ['home.buildWithYou.useHint', 'What you do with it once it is ready.'] },
  { id: 'readyWhen', label: ['home.buildWithYou.readyWhen', 'Ready when'],
    hint: ['home.buildWithYou.readyWhenHint', 'When you would like to use it.'] },
];

/**
 * The queue's state words. 'waiting-for-operator' is the node's own: stored here until the
 * operator's fleet takes it to the queue (the place holds no key to the queue), so it names the
 * operator. 'received' was its first name and reads the same.
 */
const WAITING = ['home.buildWithYou.state.received', 'Sent to the operator, who passes it to the queue.'];
const STATE_WORDS = {
  'waiting-for-operator': WAITING,
  received: WAITING,
  queued: ['home.buildWithYou.state.queued', 'In the queue'],
  building: ['home.buildWithYou.state.building', 'Being built'],
  invited: ['home.buildWithYou.state.invited', 'Invitation sent'],
  done: ['home.buildWithYou.state.done', 'Ready'],
  declined: ['home.buildWithYou.state.declined', 'Not taken on'],
};

function title() {
  return tr('home.buildWithYou.title', 'We build it with you');
}

/** The card, or nothing: not a customer's node, no queue, the offer not open yet, or no answer. */
export function BuildWithYou() {
  const enabled = customerNode();
  const { data } = useShared(KEY, enabled ? PATH : '', [KEY]);
  if (!enabled || !data) return null;
  const { offer, request } = data;
  const queueOrigin = typeof data.queueOrigin === 'string' ? data.queueOrigin : '';
  const buildCode = typeof data.buildCode === 'string' ? data.buildCode.trim() : '';

  if (!request && buildCode) {
    return html`<${BuildCodeCard} code=${buildCode} aimeatOrigin=${queueOrigin || AIMEAT_ORIGIN}
      chatPath=${!!queueOrigin} />`;
  }
  if (!request) return offer?.available ? html`<${OfferForm} />` : null;
  if (request.state === 'done') return html`<${Finished} />`;
  if (request.state === 'invited' || (request.organismInviteSent && request.state !== 'declined')) {
    return html`<${InvitedGuide} request=${request} queueOrigin=${queueOrigin} />`;
  }
  return html`<${QueueStatus} request=${request} />`;
}

/**
 * The build code and the three steps: the person's own AI, connected to aimeat.io and to this place,
 * sends the request from their own aimeat.io account with the code; the work is followed in the
 * request's workspace there. The words follow the store panel's (commercial-1c, 1.11). `chatPath`:
 * the node has the queue's address, so Access and security offers "Connect to aimeat.io" for the
 * place's own chat, the second way in.
 */
function BuildCodeCard({ code, aimeatOrigin, chatPath }) {
  const host = hostOf(aimeatOrigin) || 'aimeat.io';
  const say = fill(tr('home.buildWithYou.codeSay', 'Send my build request to {host} with the code {code}.'), { host, code });
  return html`
    <${Band} title=${title()}>
      <${Note} kind="lead">${tr('home.buildWithYou.promise', 'We build your first complete piece of work with you.')}<//>
      <${BandNote}>${tr('home.buildWithYou.scope', 'Tell us with your AI what you need: one agent or one small app. Bigger work is priced separately.')}<//>
      <${NamedRow} label=${tr('home.buildWithYou.codeLabel', 'Your build code')}>
        <code>${code}</code> <${CopyButton} text=${code} label=${tr('home.buildWithYou.codeCopy', 'Copy the code')} />
      <//>
      <${IndexList} steps>
        <${IndexStep}>
          ${fill(tr('home.buildWithYou.codeStepConnect', 'Connect your own AI (Claude, ChatGPT or Grok) to {host} and to this place.'), { host })}
          <${Actions}>
            <${Action} small href=${`${aimeatOrigin}/v1/profile?tab=mcp`} newTab>${fill(tr('home.buildWithYou.codeConnectThere', 'Connect to {host}'), { host })} →<//>
            <${Action} small href="/v1/profile?tab=mcp">${tr('home.buildWithYou.codeConnectHere', 'Connect to this place')} →<//>
          <//>
          <${Note} kind="hint">${fill(tr('home.buildWithYou.codeFullAccess', 'When {host} asks, choose an agent with full access.'), { host })}<//>
          ${chatPath && html`
            <${Note} kind="hint">${fill(tr('home.buildWithYou.codeChatPath', 'You can also use this place\'s chat: connect it to {host} under Access and security.'), { host })}<//>
            <${Actions}>
              <${Action} small soft href="/v1/profile?tab=access&section=ac-mcp">${fill(tr('home.buildWithYou.codeChatButton', 'Connect the chat to {host}'), { host })} →<//>
            <//>`}
        <//>
        <${IndexStep}>
          ${tr('home.buildWithYou.codeStepAsk', 'Ask your AI to send your build request with this code.')}
          <${Note} kind="hint">${fill(tr('home.buildWithYou.codeSayHint', 'You can say, for example: "{say}"'), { say })}<//>
        <//>
        <${IndexStep}>
          ${fill(tr('home.buildWithYou.codeStepFollow', 'When your request is taken on, you get an invitation to its own workspace on {host}. You follow the work there.'), { host })}
        <//>
      <//>
      <${Actions}>
        <${Action} small soft href="/v1/home?trail=1">${tr('home.buildWithYou.trailLink', 'Everything done in your place')} →<//>
      <//>
    <//>`;
}

/** The offer: the promise, what it covers, and the four-part request sent with one button. */
function OfferForm() {
  const [spec, setSpec] = useState({ what: '', forWhom: '', use: '', readyWhen: '' });
  const [missing, setMissing] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const empty = SPEC.filter((p) => !spec[p.id].trim()).map((p) => p.id);
    setMissing(empty);
    if (empty.length) { setError(tr('home.buildWithYou.fillAll', 'Fill in all four parts.')); return; }
    setBusy(true);
    setError('');
    try {
      await apiPost(PATH, Object.fromEntries(SPEC.map((p) => [p.id, spec[p.id].trim()])));
      invalidateShared(KEY, PATH);
    } catch (e) {
      // A request already sent from another tab or by the person's AI: show it rather than refuse.
      if (e?.code === 'BUILD_REQUEST_EXISTS') { invalidateShared(KEY, PATH); return; }
      setError(e?.code === 'BUILD_WITH_YOU_OFF'
        ? tr('home.buildWithYou.off', 'Requests cannot be sent just now.')
        : e?.code === 'VALIDATION_ERROR'
          ? tr('home.buildWithYou.fillAll', 'Fill in all four parts.')
          : tr('home.buildWithYou.sendFailed', 'The request did not go through. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const set = (id) => (value) => {
    setSpec((prev) => ({ ...prev, [id]: value }));
    if (missing.includes(id) && value.trim()) setMissing((prev) => prev.filter((m) => m !== id));
  };

  return html`
    <${Band} title=${title()}>
      <${Note} kind="lead">${tr('home.buildWithYou.promise', 'We build your first complete piece of work with you.')}<//>
      <${BandNote}>${tr('home.buildWithYou.scope', 'Tell us with your AI what you need: one agent or one small app. Bigger work is priced separately.')}<//>
      <${Fields} column>
        ${SPEC.map((p) => {
          const Control = p.long ? TextArea : TextField;
          return html`<${Control} key=${p.id} label=${tr(...p.label)} hint=${tr(...p.hint)}
            rows=${p.long ? 3 : undefined} value=${spec[p.id]} onInput=${set(p.id)}
            invalid=${missing.includes(p.id)} />`;
        })}
      <//>
      ${error && html`<${Note} kind="message" error>${error}<//>`}
      <${FormActions}>
        <${Loud} disabled=${busy} onClick=${send}>${tr('home.buildWithYou.send', 'Send the request')}<//>
      <//>
      <${Note} kind="hint">${tr('home.buildWithYou.aiCanDo', 'You can also ask your AI to fill in the request with you. It can send it and tell you where you are in the queue.')}<//>
    <//>`;
}

/** Where the request stands: the state word, the place in the queue as numbers, what was sent. */
function QueueStatus({ request }) {
  const word = STATE_WORDS[request.state] || null;
  const placed = Number.isFinite(request.position) && Number.isFinite(request.queueLength);
  return html`
    <${Band} title=${title()}>
      ${placed && request.state !== 'declined' && html`
        <${Note} kind="lead">${fill(tr('home.buildWithYou.position', 'You are number {n} of {total} requests in the queue.'),
          { n: request.position, total: request.queueLength })}<//>`}
      ${word && html`<${NamedRow} label=${tr('home.buildWithYou.stateLabel', 'Status')}>${tr(...word)}<//>`}
      ${request.note && html`<${NamedRow} label=${tr('home.buildWithYou.noteLabel', 'Message from the builders')}>${request.note}<//>`}
      <${SpecRows} spec=${request.spec} />
      <${Actions}>
        <${Action} small soft href="/v1/home?trail=1">${tr('home.buildWithYou.trailLink', 'Everything done in your place')} →<//>
      <//>
    <//>`;
}

/** The operator invited them: the organism on the queue's node, the email, and the three steps. */
function InvitedGuide({ request, queueOrigin }) {
  const org = request.organism || null;
  const orgHref = org?.url || (queueOrigin && org?.id
    ? `${queueOrigin}/v1/profile?tab=organisms&org=${encodeURIComponent(org.id)}` : '');
  const host = hostOf(queueOrigin || org?.url || '') || 'aimeat.io';
  const connectHref = queueOrigin ? `${queueOrigin}/v1/profile?tab=mcp` : '';
  return html`
    <${Band} title=${title()}>
      <${Note} kind="lead">${org?.name
        ? fill(tr('home.buildWithYou.invitedNamed', 'An organism called {name} was made on {host} for your request. It is one shared place for you, your AI and the builders.'), { name: org.name, host })
        : fill(tr('home.buildWithYou.invited', 'An organism was made on {host} for your request. It is one shared place for you, your AI and the builders.'), { host })}<//>
      <${IndexList} steps>
        <${IndexStep}>
          ${request.inviteEmail
            ? fill(tr('home.buildWithYou.acceptTo', 'Accept the invitation in your email. It went to {email}.'), { email: request.inviteEmail })
            : tr('home.buildWithYou.accept', 'Accept the invitation in your email.')}
        <//>
        <${IndexStep}>
          ${fill(tr('home.buildWithYou.follow', 'Follow the work on {host}.'), { host })}
          ${orgHref && html`<${Actions}><${Action} small href=${orgHref} newTab>${org?.name || host} →<//><//>`}
        <//>
        <${IndexStep}>
          ${fill(tr('home.buildWithYou.connectThere', 'Connect your AI to {host} too, the same way as here: open Connect your AI on {host}, pick your AI and follow the steps on the page. At the end you approve the connection.'), { host })}
          ${connectHref && html`<${Actions}><${Action} small href=${connectHref} newTab>${tr('home.buildWithYou.connectThereButton', 'Connect your AI there')} →<//><//>`}
        <//>
      <//>
      ${request.note && html`<${NamedRow} label=${tr('home.buildWithYou.noteLabel', 'Message from the builders')}>${request.note}<//>`}
      <${SpecRows} spec=${request.spec} />
      <${Actions}>
        <${Action} small soft href="/v1/home?trail=1">${tr('home.buildWithYou.trailLink', 'Everything done in your place')} →<//>
      <//>
    <//>`;
}

/** The finish: it works, and how to go on with an AI of their own. */
function Finished() {
  return html`
    <${Band} title=${title()}>
      <${Note} kind="lead">${tr('home.buildWithYou.doneTitle', 'Your agent is ready and working.')}<//>
      <${BandNote}>${tr('home.buildWithYou.continue', 'From here you can carry on alone with your own AI. Claude Code, Codex and a Grok bot can all connect to your place and keep developing what was built.')}<//>
      <${Actions}>
        <${Action} small href="/v1/help#outside">${tr('home.buildWithYou.continueLink', 'How to connect them')} →<//>
        <${Action} small soft href="/v1/home?trail=1">${tr('home.buildWithYou.trailLink', 'Everything done in your place')} →<//>
      <//>
    <//>`;
}

/** What the person sent, so the card says what is being built. */
function SpecRows({ spec }) {
  if (!spec) return null;
  return html`${SPEC.filter((p) => spec[p.id]).map((p) => html`
    <${NamedRow} key=${p.id} label=${tr(...p.label)}>${spec[p.id]}<//>`)}`;
}

/** The host part of an address, or '' when there is none to read. */
function hostOf(url) {
  return url && URL.canParse(url) ? new URL(url).host : '';
}

export default BuildWithYou;
