/**
 * @file public/views/home/step-branch-b.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Branch B (aimeat_remake/09-haara-b-teksti.md): the person made a welcome mat, and
 *   the app they made it in cannot open a connection. They need a different app before step 3.
 *
 *   This is the hardest screen in the product to write, because of where it falls. They just
 *   succeeded at something. Now they are being told their tool is not enough, and that is one short
 *   step from hearing that THEY are not enough. Three things keep it on the right side:
 *
 *     1. Praise what worked before naming the limit. The mat is made, it is theirs, and it is real.
 *     2. State the limit as a property of the TOOL, not a lack of quality. "This app cannot open a
 *        connection yet" is true. "This will not work well on a cheap free version" is the same
 *        fact said so that the person hears they chose badly.
 *     3. State the requirement AS a requirement. It is not a suggestion that can be skipped, and
 *        writing round it would be dishonest and would leave them trying things that cannot work.
 *
 *   There is ONE way forward here, and no third option: take up an app that can. The old draft's
 *   second route (a CLI, a local runner, an API key, choosing a model) belongs to a different track
 *   and is not offered — bundling it here would answer a question nobody on this screen is asking.
 * @structure StepBranchB({ state, onChanged }) — errors render beside the paste box rather than
 *   in a toast, because the person needs them next to the thing they must change.
 * @usage import { StepBranchB } from './step-branch-b.js';
 * @version-history
 *   (2026-08-23) Em-dashes swept from the fallback strings (banned in every surface).
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { PromptCard } from '/components/PromptCard.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The apps that can, from the node's own table — never a list hardcoded here. */
function useCapableApps() {
  const [tools, setTools] = useState([]);
  useEffect(() => {
    let alive = true;
    apiGet('/v1/ai-tools')
      .then(r => { if (alive) setTools(r?.data?.tools ?? []); })
      .catch(e => swallowed('home/step-branch-b: ai-tools', e));
    return () => { alive = false; };
  }, []);
  return tools;
}

export function StepBranchB({ state, onChanged }) {
  const tools = useCapableApps();
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [errText, setErrText] = useState('');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    let alive = true;
    apiGet('/v1/prompts/welcome-mat')
      .then(r => { if (alive) setPrompt(r?.data?.prompt || ''); })
      .catch(e => swallowed('home/step-branch-b: prompt', e));
    return () => { alive = false; };
  }, []);

  // Re-pasting the mat is the whole mechanism of this branch: the person redoes it in an app that
  // can connect, and the same endpoint re-reads the metadata and re-decides. No separate
  // "I upgraded" button to click, because a button would be a claim and the mat is evidence.
  const submit = useCallback(async () => {
    setBusy(true);
    setErrText('');
    try {
      const r = await api('/v1/home/welcome-mat', { method: 'POST', body: JSON.stringify({ paste }) });
      if (r.data?.branch === 'B') {
        // Still an app that cannot. Say so without starting over, and keep their text.
        setErrText(tr('home.branchB.stillB',
          'That one cannot open a connection either. The list above is the checked one; the app has to be from it.'));
      } else {
        onChanged(r.data);
      }
    } catch (e) {
      setErrText(e?.response?.error?.message || e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [paste, onChanged]);

  // The app they used, by the name they gave it. Naming it matters: they know what they used, and
  // a screen that talks around it reads as evasive.
  const appName = state.ai?.client || tr('home.branchB.thatApp', 'the app you used');
  const hasPaste = paste.trim().length > 0;

  // Which entry in the list IS their app. Everyone who reaches this screen got here by saying they
  // lack the tier their app requires — so their app CAN do this, on a plan they do not have. Saying
  // "it cannot open a connection" and then listing it would be a contradiction the reader spots
  // immediately, and would read as the screen not knowing what it is talking about.
  const theirs = tools.find(x => x.id === state.ai?.resolvedClient)
    || tools.find(x => (x.label || '').toLowerCase() === String(appName).toLowerCase());
  // Their own app first: upgrading the thing they already use is the cheapest move available.
  const ordered = theirs ? [theirs, ...tools.filter(x => x.id !== theirs.id)] : tools;

  return html`
    <div class="koti-step koti-step-open koti-b">
      <div class="koti-step-head">
        <span class="koti-step-num">2</span>
        <h2 class="koti-step-title">${tr('home.branchB.title', 'Your welcome mat is done')}</h2>
      </div>

      <p class="koti-step-lede">
        ${theirs
          ? tr('home.branchB.ledePlan', '{app} made it, and {app} can open a connection to your home, but only on one of its paid plans, and you said you are not on one. So the next step needs either that plan or another app.')
              .replace(/\{app\}/g, theirs.label)
          : tr('home.branchB.lede', 'You made it with {app}. It can write, but it cannot open a connection to your home yet, so the next step needs a different app.')
              .replace('{app}', appName)}
      </p>
      <p class="koti-step-lede">
        ${tr('home.branchB.why', 'A connection means the AI can read and write things in your home itself, instead of you copying text back and forth. That is what this place is built on: everything here is done with an AI, so without a connection your home cannot be finished.')}
      </p>

      <div class="koti-b-way">
        <h3 class="koti-b-way-title">
          ${tr('home.branchB.wayTitle', 'Take up an AI app that can open a connection')}
        </h3>
        <p class="koti-b-way-body">
          ${tr('home.branchB.wayBody', 'Some AI apps do this directly. They are paid, typically around 20 dollars a month. If you use an AI every day, this is the one you want.')}
        </p>

        <ul class="koti-b-apps">
          ${ordered.map(tool => html`
            <li class="koti-b-app" key=${tool.id}>
              <div class="koti-b-app-head">
                <span class="koti-b-app-name">${tool.label}</span>
                ${theirs && tool.id === theirs.id && html`
                  <span class="badge badge-info">${tr('home.branchB.yours', 'The one you already use')}</span>`}
                ${tool.recommended && (!theirs || tool.id !== theirs.id) && html`
                  <span class="badge badge-info">${tr('home.branchB.recommended', 'A good first one')}</span>`}
              </div>
              ${tool.mcp?.plans && html`<p class="koti-b-app-plans">${tool.mcp.plans}</p>`}
              ${tool.mcp?.docs && html`
                <a class="koti-b-app-docs" href=${tool.mcp.docs} target="_blank" rel="noopener">
                  ${tr('home.branchB.theirDocs', 'Their own instructions')}
                </a>`}
            </li>`)}
        </ul>
      </div>

      <div class="koti-b-again">
        <h3 class="koti-b-way-title">${tr('home.branchB.againTitle', 'Then make the mat again with it')}</h3>
        <p class="koti-b-way-body">
          ${tr('home.branchB.againBody', 'Same prompt, new app. Paste what it gives you here and we carry on from there. Your first mat stays until this one replaces it.')}
        </p>

        <${PromptCard}
          label=${tr('home.mat.promptLabel', 'The prompt')}
          prompt=${prompt}
          className=${hasPaste ? 'btn-outline' : 'btn-primary'}
          copyLabel=${tr('home.mat.copy', 'Copy the prompt')}
          copiedLabel=${tr('home.mat.copied', 'Copied. Paste it in your AI chat')} />

        <label class="koti-paste-label" for="koti-b-paste">
          ${tr('home.mat.pasteLabel', 'Paste what your AI gave you here')}
        </label>
        <textarea
          id="koti-b-paste"
          class="koti-paste"
          rows="7"
          spellcheck="false"
          placeholder=${tr('home.mat.pastePlaceholder', 'Everything it wrote is fine, explanation and all.')}
          value=${paste}
          onInput=${(e) => setPaste(e.target.value)}></textarea>

        ${errText && html`
          <div class="koti-error" role="alert">
            <p class="koti-error-text">${errText}</p>
          </div>`}

        <div class="koti-actions">
          <button type="button"
            class=${hasPaste ? 'btn-primary' : 'btn-outline'}
            disabled=${busy || !hasPaste}
            onClick=${submit}>
            ${busy ? tr('home.mat.sending', 'Reading it…') : tr('home.branchB.submit', 'Here is the new one')}
          </button>
        </div>
      </div>
    </div>`;
}
