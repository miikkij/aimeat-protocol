/**
 * @file public/views/home/goal-steps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What waits for the person in an agent goal, as the goal page and the home draw it: one
 *   card per step, in the step's own shape. Choose lists the options to tick, approve has its yes and
 *   its "ask again" with the reason the next agent reads, answer takes words, do carries the links, the
 *   ready texts to copy and the prompt for any AI (nothing is a dead end: Jouni, 2026-10-25), provide
 *   takes a text or a stored file's key. Open work no agent took offers the ways forward: the person's
 *   own AI does it now, a new agent made from one sentence, or doing it with a ready prompt.
 *
 *   The answer goes to POST /v1/goals/{id}/works/{workId}/answer, the same call the person's own AI
 *   makes with aimeat_goal_answer, so a step answered either way leaves both places at once (live).
 *   Composed from library components only; it has no sheet of its own.
 * @structure StepCard({ item, onDone }) · NobodyCard({ item, navigate }) · goalPrompt(goal)
 * @usage html`<${StepCard} item=${{ goal_id, goal, work }} onDone=${reload} />`
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Card } from '/components/Card.js';
import { Check } from '/components/Check.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { PromptCard } from '/components/PromptCard.js';
import { Markdown } from '/components/Markdown.js';
import { answerStep } from '/js/services/goals.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goal.' + key, fallback);

/** The kind of a person's step, as the little tag on its card says it. */
export function kindWord(kind) {
  return ({
    choose: g('kindChoose', 'Choose'), approve: g('kindApprove', 'Approve'), answer: g('kindAnswer', 'Answer'),
    do: g('kindDo', 'Do it yourself'), provide: g('kindProvide', 'Give'),
  })[kind] ?? kind;
}

/** A prompt the person gives any AI to work on this goal (the way in for an AI without MCP too). */
export function goalPrompt(goal) {
  return g('prompt', 'Read my AIMEAT goal {id} ("{title}") with aimeat_goal_get. Tell me where it stands, what waits for me, and propose what moves it towards done. Make no change before I agree.')
    .replace('{id}', goal.id ?? goal.goal_id).replace('{title}', goal.title ?? goal.goal ?? '');
}

/** @param {{ item: { goal_id: string, goal: string, work: any }, onDone?: () => void, showGoal?: boolean }} props */
export function StepCard({ item, onDone, showGoal }) {
  const w = item.work;
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async (answer) => {
    setBusy(true); setErr('');
    try { await answerStep(item.goal_id, w.id, answer); onDone?.(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  let body = null;
  if (w.human_kind === 'choose') {
    const toggle = (id, on) => setPicked((cur) => (w.multiple ? (on ? [...cur, id] : cur.filter((x) => x !== id)) : (on ? [id] : [])));
    body = html`
      ${w.options.map((o) => html`
        <${Check} key=${o.id} ruled radio=${!w.multiple} name=${'pick-' + w.id} checked=${picked.includes(o.id)}
          onChange=${(on) => toggle(o.id, on)} hint=${o.detail}>${o.label}<//>`)}
      <${Actions}>
        <${Loud} control disabled=${busy || picked.length === 0} onClick=${() => send({ options: picked })}>
          ${picked.length > 1 ? g('chooseN', 'Choose these {n}').replace('{n}', String(picked.length)) : g('choose', 'Choose')}
        <//>
      <//>`;
  } else if (w.human_kind === 'approve') {
    body = html`
      ${w.held && html`<${Note} kind="quiet">${g('heldNote', 'The next work waits for your yes: {title}.').replace('{title}', w.held.title)}<//>`}
      <${Actions}>
        <${Loud} control disabled=${busy} onClick=${() => send({ approve: true })}>${g('approve', 'Approve')}<//>
        <${Action} control onClick=${() => setAsking(!asking)}>${g('askAgain', 'Reject and ask again')}<//>
      <//>
      ${asking && html`
        <${TextArea} label=${g('whyLabel', 'What was not good?')} value=${reason} onInput=${setReason} rows=${2} />
        <${Note} kind="quiet" size="small">${g('whyNote', 'The next work gets the result and your reason.')}<//>
        <${Actions}><${Loud} control disabled=${busy || !reason.trim()} onClick=${() => send({ approve: false, reason })}>${g('askAgainSend', 'Ask again')}<//><//>`}`;
  } else if (w.human_kind === 'answer') {
    body = html`
      <${TextField} label=${g('answerLabel', 'Your answer')} value=${text} onInput=${setText} onEnter=${() => text.trim() && send({ text })}
        actions=${html`<${Loud} control disabled=${busy || !text.trim()} onClick=${() => send({ text })}>${g('send', 'Send')}<//>`} />`;
  } else if (w.human_kind === 'do') {
    const lead = (w.links ?? []).length && (w.texts ?? []).length
      ? g('doLeadLinks', 'Your turn. Open each link, copy the ready text under it and post it there yourself. Then press "I did this".')
      : g('doLead', 'Your turn: this is something only you can do. When it is done, press "I did this".');
    body = html`
      <${Note}>${lead}<//>
      ${(w.links ?? []).map((l, i) => html`
        <div key=${'l' + i}>
          <${Action} tone="inline" href=${l.url} newTab>${l.title || l.url} →<//>
          ${w.texts?.[i] && html`
            <${TextArea} label=${g('readyText', 'Ready text')} value=${w.texts[i]} rows=${3} readOnly />
            <${Action} small copy=${w.texts[i]} copiedLabel=${g('copied', 'Copied')}>${g('copyText', 'Copy the text')}<//>`}
        </div>`)}
      ${!(w.links ?? []).length && (w.texts ?? []).map((tx, i) => html`
        <div key=${'t' + i}>
          <${TextArea} label=${g('readyText', 'Ready text')} value=${tx} rows=${3} readOnly />
          <${Action} small copy=${tx} copiedLabel=${g('copied', 'Copied')}>${g('copyText', 'Copy the text')}<//>
        </div>`)}
      ${w.prompt && html`<${PromptCard} label=${g('promptLabel', 'A ready prompt for any AI')} prompt=${w.prompt} copyLabel=${g('copyPrompt', 'Copy the prompt')} />`}
      <${Actions}><${Loud} control disabled=${busy} onClick=${() => send({ text: text || undefined })}>${g('didIt', 'I did this')}<//><//>`;
  } else if (w.human_kind === 'provide') {
    body = html`
      <${TextArea} label=${g('provideLabel', 'The text, or the key of a stored file')} value=${text} onInput=${setText} rows=${3} />
      <${Note} kind="quiet" size="small">${g('provideNote', 'You can also send the file to your own AI and ask it to give it to this goal.')}<//>
      <${Actions}>
        <${Loud} control disabled=${busy || !text.trim()} onClick=${() => send({ kind: /^[\w./-]+\.[a-z0-9]{2,5}$/i.test(text.trim()) ? 'file' : 'text', ref: text.trim() })}>${g('give', 'Give')}<//>
      <//>`;
  }

  return html`
    <${Card} tone="framed" state=${w.human_kind === 'approve' ? 'raised' : undefined}
      kicker=${showGoal ? `${kindWord(w.human_kind)} · ${item.goal}` : kindWord(w.human_kind)} name=${w.title}>
      ${w.description && html`<${Markdown} text=${w.description} small />`}
      ${body}
      ${err && html`<${ErrorNote} text=${err} />`}
    <//>`;
}

/** A goal the person's AI proposed: one press opens it to read and approve. */
export function ProposalCard({ item, navigate }) {
  // The log names the person 'owner' and an AI by its principal; the card says "You" or the AI's name.
  const raw = String(item.proposed_by || '');
  const by = raw === 'owner' ? g('youWord', 'You') : raw.split('#')[0];
  return html`
    <${Card} tone="framed" state="raised" kicker=${g('proposalTag', 'A proposed goal')} name=${item.goal}>
      <${Note} kind="quiet">${g('proposalBy', '{who} proposed it, with {n} works. Nothing starts before you approve it.').replace('{who}', by || g('yourAi', 'Your AI')).replace('{n}', String(item.works ?? 0))}<//>
      <${Actions}>
        <${Loud} control onClick=${() => navigate?.(`/v1/home?goal=${encodeURIComponent(item.goal_id)}`)}>${g('proposalOpen', 'Read and approve')}<//>
      <//>
    <//>`;
}

/** Open work no agent took: the ways forward, none of them a dead end. */
export function NobodyCard({ item, navigate }) {
  const w = item.work;
  const sentence = `${w.title}${w.description ? '. ' + w.description : ''}`;
  const prompt = g('nobodyPrompt', 'In my AIMEAT goal {goal} there is open work no agent took: "{title}". Take it with aimeat_goal_work (action "claim", goal_id {id}, work_id {work}) and do it, or tell me what you need.')
    .replace('{goal}', item.goal).replace('{title}', w.title).replace('{id}', item.goal_id).replace('{work}', w.id);
  return html`
    <${Card} tone="framed" kicker=${`${g('nobodyTag', 'Nobody took it')} · ${item.goal}`} name=${w.title}>
      <${Note} kind="quiet">${w.wants?.length
        ? g('nobodyWants', 'None of your agents that know {skills} took it. Choose how it gets done:').replace('{skills}', w.wants.join(', '))
        : g('nobodyAny', 'No agent took it. Choose how it gets done:')}<//>
      <${PromptCard} label=${g('nobodyOwnAi', 'Your own AI does it now')} prompt=${prompt} copyLabel=${g('copyPrompt', 'Copy the prompt')} />
      <${Actions}>
        <${Action} control onClick=${() => navigate?.('/v1/home?new-agent=1&say=' + encodeURIComponent(sentence))}>${g('nobodyMake', 'Make an agent for it')}<//>
      <//>
    <//>`;
}
