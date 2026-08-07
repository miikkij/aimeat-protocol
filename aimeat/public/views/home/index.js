/**
 * @file public/views/home/index.js
 * @description KOTI — the home (aimeat_remake/06-koti-feed-suostumus.md). The new onboarding path,
 *   living beside the old profile rather than replacing it: nothing under public/views/profile/ is
 *   touched, and a person moves between the two with a switch.
 *
 *   The word "profile" does not appear on this path, and neither does "path": the four
 *   destinations that open once the home exists are ROOMS.
 *
 *   An uninitialised home shows a welcome, step 1 open, and steps 2 and 3 NAMED BUT DIMMED — the
 *   person can see how many are left without being able to jump. No quotas, no shop row, no empty
 *   inventory cards: one task at a time, and the empty state is filled by doing the task rather
 *   than by decoration.
 * @structure default HomeView; internal: Welcome, StepList, DimmedStep
 * @usage routed at /v1/home by spa.html (and portal.ts spaRoutes, or F5 is a 404)
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 3).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { Spinner } from '/components/Spinner.js';
import { StepMat, StepMatDone } from '/views/home/step-mat.js';
import { StepAgent, AgentCard } from '/views/home/step-agent.js';
import { StepBranchB } from '/views/home/step-branch-b.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The steps, named. `better-app` exists only on branch B; on A there are two, not three. */
const STEP_TITLES = {
  'welcome-mat': ['home.step1', 'Your welcome mat'],
  'better-app': ['home.step2b', 'Get an app that can connect'],
  'first-agent': ['home.step2', 'Connect your first agent'],
};

/** A step that is named so the person knows it is coming, and dimmed so they cannot start it. */
function DimmedStep({ n, titleKey, fallback, note }) {
  return html`
    <div class="koti-step koti-step-dim" aria-disabled="true">
      <div class="koti-step-head">
        <span class="koti-step-num">${n}</span>
        <h2 class="koti-step-title">${tr(titleKey, fallback)}</h2>
      </div>
      ${note && html`<p class="koti-step-lede">${note}</p>`}
    </div>`;
}

function Welcome({ name }) {
  return html`
    <header class="koti-welcome">
      <h1 class="koti-h1">
        ${name
          ? tr('home.welcomeNamed', 'Welcome to your new home, {name}.').replace('{name}', name)
          : tr('home.welcome', 'Welcome to your new home.')}
      </h1>
      <p class="koti-welcome-sub">
        ${tr('home.welcomeSub', 'Before the place can do anything for you, there are a couple of things to do.')}
      </p>
    </header>`;
}

export default function HomeView({ navigate }) {
  const session = useSession();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');

  // One line of feedback, and only for things that went wrong: the steps themselves report by
  // changing, which is louder than a message that fades.
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/home/state');
      setState(r.data.state);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message || String(e));
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  // Every surface showing server data re-fetches on the live-update event, so an agent connecting
  // in another tab (or the agent itself writing the proof key) moves this screen without a reload.
  useEffect(() => {
    const handler = () => { if (session) load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session, load]);

  const onMatDone = useCallback((data) => {
    if (data?.state) setState(data.state);
    else load();
  }, [load]);

  if (!session) {
    return html`
      <div class="koti">
        <header class="koti-welcome">
          <h1 class="koti-h1">${tr('home.signInTitle', 'Step into your home')}</h1>
          <p class="koti-welcome-sub">${tr('home.signInDesc', 'Sign in to see where you left off.')}</p>
        </header>
        <div class="koti-actions">
          <button type="button" class="btn-primary" onClick=${() => navigate('/v1/portal')}>
            ${tr('home.signIn', 'Sign in')}
          </button>
        </div>
      </div>`;
  }

  if (loadError) {
    return html`
      <div class="koti">
        <div class="koti-error" role="alert"><p class="koti-error-text">${loadError}</p></div>
      </div>`;
  }

  if (!state) {
    return html`<div class="koti koti-loading"><${Spinner} /></div>`;
  }

  const name = state.displayName || state.owner;

  // ── The home, once it exists: the first agent as a card, its details below it. ──
  if (state.initialized) {
    return html`
      <div class="koti">
        <header class="koti-welcome">
          <h1 class="koti-h1">${tr('home.readyTitle', 'Your home is up and running.')}</h1>
          <p class="koti-welcome-sub">
            ${tr('home.readySub', 'Your welcome mat is out and your first agent is home.')}
          </p>
        </header>
        <${AgentCard} agent=${state.agent} />
        <${StepMatDone} state=${state} />
      </div>`;
  }

  const step = state.step;
  // Branch B inserts a step: get an app that can connect, which pushes the agent to number 3.
  // It is driven by needsBetterApp (live) rather than by branch (write-once, historical), so
  // re-pasting a mat from a capable app collapses this step by itself.
  const onBranchB = state.needsBetterApp || (state.branch === 'B' && !state.mat.done);

  return html`
    <div class="koti">
      <${Welcome} name=${name} />

      <ol class="koti-steps">
        <li>
          ${step === 'welcome-mat'
            ? html`<${StepMat} onDone=${onMatDone} />`
            : html`<${StepMatDone} state=${state} />`}
        </li>
        <li>
          ${step === 'better-app'
            ? html`<${StepBranchB} state=${state} onChanged=${onMatDone} />`
            : step === 'first-agent' && !onBranchB
              ? html`<${StepAgent} onChanged=${load} showToast=${showToast} />`
              : html`<${DimmedStep}
                  n="2"
                  titleKey=${onBranchB ? 'home.step2b' : (STEP_TITLES[step]?.[0] ?? 'home.step2')}
                  fallback=${onBranchB ? 'Get an app that can connect' : (STEP_TITLES[step]?.[1] ?? 'Connect your first agent')}
                  note=${tr('home.step2Dim', 'Opens once your welcome mat is up.')} />`}
        </li>
        ${onBranchB && html`
          <li>
            ${step === 'first-agent'
              ? html`<${StepAgent} onChanged=${load} showToast=${showToast} />`
              : html`<${DimmedStep}
                  n="3"
                  titleKey="home.step3"
                  fallback="Connect your first agent"
                  note=${tr('home.step3Dim', 'Opens once you have an app that can connect.')} />`}
          </li>`}
      </ol>
      ${toast && html`<div class="koti-toast" role="status">${toast}</div>`}
    </div>`;
}
