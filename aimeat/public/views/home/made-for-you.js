/**
 * @file public/views/home/made-for-you.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The third visit's offer ("three visits" c; Jouni, 2.11 00.52): AIMEAT works on its
 *   own initiative from the person's profile. It chooses one of their interview answers, makes one
 *   finished piece of work for it with the place's own AI (a checklist for work they repeat, a short
 *   plan for what gets in their way, a first draft for what they need, an explanation for what is
 *   unclear), and offers it whole; one press keeps it.
 *   The work is made once: it is written to the home's bookkeeping record `home.offers` as `madeForYou`
 *   ({ state: offered | kept | declined, title, why, body, madeAt }) as soon as it exists, so a reload
 *   shows the same piece and costs nothing. Kept, it is written to the person's own record
 *   `home.made-for-you` ({ state: kept, … }, private), where their AI and the Memory page find it, and
 *   which the place's activity log shows as the work they kept; the offer itself is routine there.
 *   Shown on a node the store sold, from the third visit (visits.js), when the profile has an answer;
 *   nothing is shown while it is made or when the model cannot be reached.
 * @structure MadeForYouOffer({ visit }) · MADE_KEY
 * @usage <${MadeForYouOffer} visit=${visit} />
 * @version-history
 *   v1.1.0 — 2026-11-02 — The offered piece lives in `home.offers`, and only the press that keeps it
 *     writes `home.made-for-you`: written there on offering too, the log said the person kept it twice
 *     (first-timer round on crew60). A record left `offered` in `home.made-for-you` is still read.
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { customerNode } from '/js/site.js';
import { useShared, invalidateShared } from '/views/surface/shared-read.js';
import { useHomeState } from '/views/surface/home-state.js';
import { OFFERS_PATH, patchOffers } from './visits.js';
import { Band } from '/components/Band.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Action, Actions, Loud } from '/components/Action.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export const MADE_KEY = 'home.made-for-you';
const MADE_PATH = `/v1/memory/${MADE_KEY}?soft=1`;
/** The visit from which the offer is made. */
const FROM_VISIT = 3;

/** The interview answers the work is chosen from, labelled for the model. English: a model reads it. */
const LABELS = {
  repetitive: 'Work they repeat',
  challenges: 'What gets in their way',
  needs: 'What they need to get done',
  unclear: 'What is unclear to them',
  work: 'What they do',
};
const LANGUAGE = { fi: 'Finnish', es: 'Spanish', en: 'English' };

const SYSTEM = (language) => [
  'You make one finished piece of work for a person, chosen by you from their own answers below.',
  'Choose the answer where a finished text helps them most today, and make that text complete and ready to use: for work they repeat, a checklist or template they can reuse; for what gets in their way, a short plan of concrete steps; for what they need to get done, a first draft; for what is unclear to them, a plain explanation.',
  'Use what they told you about their work. Ask nothing, offer no options, and say nothing about prices, credits or limits.',
  `Write in ${language}, in plain words.`,
  'Answer with JSON only: {"title": "a short name for the work", "why": "one sentence to the person: which of their answers this is for", "body": "the finished work as plain text, short lines, at most 350 words"}.',
].join('\n');

/** The answers as lines for the model, or '' when the profile has none worth working from. */
function profileLines(profile) {
  const p = profile ?? {};
  const lines = Object.entries(LABELS).filter(([k]) => typeof p[k] === 'string' && p[k].trim())
    .map(([k, label]) => `- ${label}: ${p[k].trim().slice(0, 500)}`);
  const usable = ['repetitive', 'challenges', 'needs', 'unclear'].some((k) => typeof p[k] === 'string' && p[k].trim());
  return usable ? lines.join('\n') : '';
}

/** The model's JSON answer, read leniently: a code fence or words around it are dropped. */
function parseWork(text) {
  const s = String(text ?? '');
  const from = s.indexOf('{');
  const to = s.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try {
    const o = JSON.parse(s.slice(from, to + 1));
    const title = String(o?.title ?? '').trim().slice(0, 120);
    // A model often opens the body with the title again; the card shows the title above it already.
    const lines = String(o?.body ?? '').trim().split('\n');
    if (lines.length > 1 && lines[0].replace(/[#*\s]/g, '').toLowerCase() === title.replace(/[#*\s]/g, '').toLowerCase()) lines.shift();
    const body = lines.join('\n').trim().slice(0, 6000);
    return title && body ? { title, why: String(o?.why ?? '').trim().slice(0, 300), body } : null;
  } catch (err) {
    swallowed('made for you: the answer was not JSON', err);
    return null;
  }
}

async function writeMade(value) {
  await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: MADE_KEY, value, visibility: 'private' }) });
  await invalidateShared('home-made-for-you', MADE_PATH);
}

/** One making at a time in this page, whatever re-renders: the work costs a model call. */
let making = null;
async function makeWork(lines) {
  const language = LANGUAGE[getLocale()] || 'English';
  const resp = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt: `Their answers:\n${lines}`, systemPrompt: SYSTEM(language), modelRole: 'execution', app_id: 'home-made-for-you' }),
    timeoutMs: 180_000,
    retries: 0,
  });
  // api() throws on a refusal (no model, a spent budget), so what comes back here is an answer.
  const work = parseWork(resp?.data?.content);
  if (!work) throw new Error('NO_WORK');
  await patchOffers({ madeForYou: { state: 'offered', ...work, madeAt: new Date().toISOString() } });
}

/** The card, or nothing: not a store's node, before the third visit, no usable answer, answered, or not made. */
export function MadeForYouOffer({ visit }) {
  const enabled = customerNode() && Number(visit) >= FROM_VISIT;
  const { journey, ready } = useHomeState();
  const pick = (d) => (d?.value && typeof d.value === 'object' ? d.value : null);
  const offers = useShared('home-offers', enabled ? OFFERS_PATH : '', ['memory'], pick);
  const made = useShared('home-made-for-you', enabled ? MADE_PATH : '', ['memory'], pick);
  const [phase, setPhase] = useState('');
  const lines = profileLines(journey?.profile);
  // The offered piece; a record left `offered` in home.made-for-you by the first version is read too.
  const work = offers.data?.madeForYou ?? (made.data?.state === 'offered' ? made.data : null);
  const answered = !!made.data && made.data.state !== 'offered';

  useEffect(() => {
    if (!enabled || !ready || !offers.ready || !made.ready || work || answered || !lines || making) return;
    making = makeWork(lines)
      .catch((err) => swallowed('made for you: making the work', err))
      .finally(() => { making = null; });
  }, [enabled, ready, offers.ready, made.ready, work, answered, lines]);

  if (!enabled || !work) return null;
  if (phase === 'kept') {
    return html`
      <${Band} title=${tr('home.madeForYou.title', 'I made this for you')}>
        <${Note} kind="lead">${tr('home.madeForYou.kept', 'Kept. It is in your memory, and your AI can carry on from it when you ask.')}<//>
        <${Actions}><${Action} small soft href="/v1/profile?tab=memory">${tr('home.madeForYou.memoryLink', 'Memory page')} →<//><//>
      <//>`;
  }
  if (work.state !== 'offered' || answered) return null;

  const answer = (state) => async () => {
    setPhase('busy');
    try {
      const answeredAt = new Date().toISOString();
      // Only keeping writes the person's own record; saying no is the home's bookkeeping.
      if (state === 'kept') await writeMade({ ...work, state, answeredAt });
      await patchOffers({ madeForYou: { ...work, state, answeredAt } });
      setPhase(state === 'kept' ? 'kept' : '');
    } catch (err) {
      swallowed('made for you: the answer', err);
      setPhase('error');
    }
  };

  return html`
    <${Band} title=${tr('home.madeForYou.title', 'I made this for you')}>
      <${Note} kind="lead">${tr('home.madeForYou.lead', 'I looked at what you told me about your work and made one thing ready for you. Keep it if it helps.')}<//>
      ${work.why && html`<${Note} kind="hint">${work.why}<//>`}
      <${SubHeading}>${work.title}<//>
      <${Note} kind="hint" size="text">${String(work.body).split('\n').map((line, i) => html`${i ? html`<br />` : ''}${line}`)}<//>
      ${phase === 'error' && html`<${Note} kind="report" tone="err" role="alert">${tr('home.madeForYou.failed', 'Your answer was not saved. Try again in a moment.')}<//>`}
      <${Actions}>
        <${Loud} onClick=${answer('kept')} disabled=${phase === 'busy'}>${tr('home.madeForYou.keep', 'Keep it')}<//>
        <${Action} small soft onClick=${answer('declined')} disabled=${phase === 'busy'}>${tr('home.madeForYou.decline', 'No thanks')}<//>
      <//>
    <//>`;
}
