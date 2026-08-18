/**
 * @file public/views/home/step-mat.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Step 1 of the home path: the welcome mat (aimeat_remake/03-welcome-mat.md). Copy a
 *   prompt into your own AI chat, paste the answer back, press the button.
 *
 *   Two rules shape this file. First, a failed paste KEEPS THE TEXT: the box is never cleared on
 *   an error, because the person may not be able to make their AI reproduce it. Second, exactly
 *   ONE primary action exists at any moment — Copy while the box is empty, Send once it has
 *   something in it — so the screen never asks the person to choose what to do next.
 *
 *   There is no skip control here, and there is no code path that could render one.
 * @structure StepMat({ state, onDone }) — the open step; StepMatDone({ state }) — the collapsed
 *   summary once the mat exists.
 * @usage import { StepMat } from './step-mat.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 3).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { PromptCard } from '/components/PromptCard.js';
import { CardMenu } from '/components/CardMenu.js';
import { listOpenItems, addOpenItem, switchOff } from '/js/services/open-items.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** What the server said was missing, in words. Naming it is the difference from "try again". */
function missingLine(reason, missing) {
  if (reason === 'empty') return tr('home.mat.errEmpty', 'The box was empty.');
  if (reason === 'empty_page') {
    return tr('home.mat.errEmptyPage', 'That was a page, but there was nothing on it. Ask your AI to write some content into it.');
  }
  const parts = [];
  if (missing?.includes('doctype')) parts.push(tr('home.mat.missDoctype', 'a line starting with <!doctype html>'));
  if (missing?.includes('html-tag')) parts.push(tr('home.mat.missHtml', 'an <html> tag'));
  if (missing?.includes('body-tag')) parts.push(tr('home.mat.missBody', 'a <body> tag'));
  if (!parts.length) return tr('home.mat.errGeneric', 'I could not find a page in what you pasted.');
  // "X, Y and Z" — joining all three with "and" reads as a machine listing conditions.
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(tr('home.mat.listComma', ', '))}${tr('home.mat.listAnd', ' and ')}${parts[parts.length - 1]}`;
  return tr('home.mat.errMissing', 'I could not find a page in what you pasted. I was looking for {list}.')
    .replace('{list}', list);
}

export function StepMat({ onDone }) {
  const [prompt, setPrompt] = useState('');
  const [fallbackPrompt, setFallbackPrompt] = useState('');
  const [usingFallback, setUsingFallback] = useState(false);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [errText, setErrText] = useState('');
  const [attempts, setAttempts] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    apiGet('/v1/prompts/welcome-mat')
      .then((r) => {
        if (!alive) return;
        setPrompt(r?.data?.prompt || '');
        setFallbackPrompt(r?.data?.fallback_prompt || '');
      })
      .catch((e) => { if (alive) setErrText(e.message || String(e)); });
    return () => { alive = false; };
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setErrText('');
    try {
      const r = await api('/v1/home/welcome-mat', { method: 'POST', body: JSON.stringify({ paste }) });
      onDone(r.data);
    } catch (e) {
      // The text STAYS. Clearing it here would throw away work the person may not get back.
      // api() puts the whole envelope on err.response; the specifics live in error.details.
      const d = e?.response?.error?.details || {};
      setAttempts(d.attempts || 0);
      setErrText(missingLine(d.reason, d.missing));
      if (boxRef.current) boxRef.current.focus();
    } finally {
      setBusy(false);
    }
  }, [paste, onDone]);

  const shown = usingFallback && fallbackPrompt ? fallbackPrompt : prompt;
  const hasPaste = paste.trim().length > 0;

  return html`
    <div class="koti-step koti-step-open">
      <div class="koti-step-head">
        <span class="koti-step-num">1</span>
        <h2 class="koti-step-title">${tr('home.mat.title', 'Your welcome mat')}</h2>
      </div>

      <p class="koti-step-lede">
        ${tr('home.mat.lede', 'Every home needs a welcome mat. You are going to make yours with your own AI: copy the prompt below into your AI chat, paste what it gives back into the box, and press the button.')}
      </p>

      <${PromptCard}
        label=${usingFallback ? tr('home.mat.promptShort', 'The shorter prompt') : tr('home.mat.promptLabel', 'The prompt')}
        prompt=${shown}
        className=${hasPaste ? 'btn-outline' : 'btn-primary'}
        copyLabel=${tr('home.mat.copy', 'Copy the prompt')}
        copiedLabel=${tr('home.mat.copied', 'Copied — paste it in your AI chat')} />

      <label class="koti-paste-label" for="koti-paste">
        ${tr('home.mat.pasteLabel', 'Paste what your AI gave you here')}
      </label>
      <textarea
        id="koti-paste"
        ref=${boxRef}
        class="koti-paste"
        rows="8"
        spellcheck="false"
        placeholder=${tr('home.mat.pastePlaceholder', 'Everything it wrote is fine — explanation and all.')}
        value=${paste}
        onInput=${(e) => setPaste(e.target.value)}></textarea>

      ${errText && html`
        <div class="koti-error" role="alert">
          <p class="koti-error-text">${errText}</p>
          <p class="koti-error-hint">
            ${tr('home.mat.errKept', 'Your text is still in the box. Ask your AI for the whole HTML file in one code block, and paste again.')}
            ${attempts > 1 ? ` ${tr('home.mat.attempts', 'Attempts so far: {n}.').replace('{n}', String(attempts))}` : ''}
          </p>
          ${fallbackPrompt && !usingFallback && html`
            <button type="button" class="btn-ghost koti-fallback-btn" onClick=${() => setUsingFallback(true)}>
              ${tr('home.mat.tryShorter', 'Show me a shorter prompt to try')}
            </button>`}
        </div>`}

      <div class="koti-actions">
        <button
          type="button"
          class=${hasPaste ? 'btn-primary' : 'btn-outline'}
          disabled=${busy || !hasPaste}
          onClick=${submit}>
          ${busy ? tr('home.mat.sending', 'Reading it…') : tr('home.mat.submit', 'Here is my welcome mat')}
        </button>
      </div>
    </div>`;
}

/** The collapsed step, once there is a mat. Shows the thing that was made, not a tick. */
/**
 * The mat, once it exists — and the first place a person ever meets the corner menu.
 *
 * THIS CARD TEACHES THE DOTS. It is the first thing anybody finishes here, so it is the moment they
 * are looking at a card of their own with something like pride rather than confusion. A new mark in
 * the corner is interesting there; on the step before it, it would have been one more obstacle
 * between them and their first success.
 *
 * The hint under it appears ONCE and never again after the menu has been opened. A control nobody
 * has seen needs one sentence the first time; the same sentence on the fiftieth visit is noise, and
 * a product that keeps explaining itself is one that never taught anything.
 */
export function StepMatDone({ state }) {
  const [item, setItem] = useState(null);
  const [taught, setTaught] = useState(true);
  const origin = 'home.mat';
  const title = tr('home.mat.improve', 'Make my welcome page better');

  useEffect(() => {
    try { setTaught(localStorage.getItem('aimeat.cardmenu.seen') === '1'); }
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser refusing storage just means the hint shows again
    catch { /* show the hint */ }
  }, []);

  const find = useCallback(async () => {
    try {
      const list = await listOpenItems();
      setItem(list.find(i => i.origin === origin) ?? null);
    } catch (e) { swallowed('home/mat: open items', e); }
  }, []);

  useEffect(() => { find(); }, [find]);
  useEffect(() => {
    const handler = () => find();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [find]);

  const learned = () => {
    setTaught(true);
    // eslint-disable-next-line aimeat/no-silent-catch -- the hint reappearing is the whole cost
    try { localStorage.setItem('aimeat.cardmenu.seen', '1'); } catch { /* noop */ }
  };

  const state3 = item?.status === 'working' ? 'working' : item ? 'open' : 'off';

  return html`
    <div class="koti-step koti-step-done">
      <${CardMenu} state=${state3} label=${tr('home.mat.titleDone', 'Your welcome mat is up')}
        onOpened=${learned}
        actions=${[{
          label: item
            ? tr('openItems.toggleOff', 'Take it off your open items')
            : title,
          run: async () => {
            if (item) { await switchOff(item.id); setItem(null); }
            else { setItem(await addOpenItem({ title, kind: 'document', origin })); }
          },
        }]} />
      <div class="koti-step-head">
        <span class="koti-step-num koti-step-num-done">✓</span>
        <h2 class="koti-step-title">${tr('home.mat.titleDone', 'Your welcome mat is up')}</h2>
      </div>
      <p class="koti-step-lede">
        ${tr('home.mat.doneLede', 'This is the first thing you made here, and it is a real page with its own address.')}
      </p>
      <div class="koti-mat-links">
        <a class="btn-outline" href=${state.mat.url}>${tr('home.mat.view', 'Look at it')}</a>
        ${state.mat.standaloneUrl && html`
          <a class="koti-mat-url" href=${state.mat.standaloneUrl} target="_blank" rel="noopener">
            ${state.mat.standaloneUrl}
          </a>`}
      </div>
      ${!taught && html`
        <p class="koti-teach">
          ${tr('home.mat.teachDots', 'The three dots in the corner are how you act on anything here. Every card has them, always in that same corner.')}
        </p>`}
    </div>`;
}
