/**
 * @file public/views/home/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description KOTI — the home. The front room: what is going on, with a door to each control. The
 *   whole machine room (settings and controls, public/views/profile/) sits one click behind it, and
 *   nothing there is touched by this side.
 *
 *   THE FINISHED HOME IS NO LONGER DRAWN HERE. It is a layout the operator can arrange, rendered by
 *   views/surface/renderer.js from the blocks this node declares. What that layout says by default
 *   is exactly what this file used to draw, so a node nobody has configured looks unchanged — and an
 *   operator who wants a home without a shop, or with their own words in it, no longer needs us.
 *
 *   WHAT STAYS HERE: who the page is for (the session), which of the two homes to show, the settings
 *   dialog (a modal over the whole surface rather than a thing in the flow), and the onboarding step
 *   machine. The steps are one block on purpose — branch B moves the agent step from second to
 *   third and the dimmed steps are numbered by position, so their order is not something a layout
 *   should be able to express.
 * @structure default HomeView; internal: Welcome, DimmedStep, OnboardingSteps
 * @usage routed at /v1/home by spa.html (and portal.ts spaRoutes, or F5 is a 404)
 * @version-history
 *   v3.0.0 — 2026-08-26 — The finished home renders through the surface layout engine. The eleven
 *     fetches and the raw aimeat-live-update listener that re-ran all of them on any event of any
 *     kind are gone: each block reads what it needs and re-reads on the domains that can change it.
 *     The onboarding home is untouched and still drawn here, now handed to the engine as one block.
 *   v2.6.1 — 2026-08-23 — Em-dash swept from the webpage fallback line (banned in every surface).
 *   v2.6.0 — 2026-08-23 — The finished home reads as BANDS: the status pieces under the nameplate,
 *     then three ruled bands (what you have made, with the apps row inside it · what you could
 *     set up, with the playbooks and the tried-so-far row · what has happened). Jouni, on his own
 *     account: eight blocks at one weight and no edge between them, the eye settled nowhere.
 *   v2.5.0 — 2026-08-19 — Playbooks (folded, from /v1/home/state) and the trust line at the foot.
 *   v2.4.0 — 2026-08-19 — Prod round: the "Your home is up and running" hero is gone (this is the
 *     dashboard; the nameplate already says who and the pieces say what), the mat line calls the
 *     thing what it is (your AI-made webpage), the nameplate carries the person's GHII address
 *     with a plain-words explainer, own apps come from the paginated listApps() so a big node
 *     cannot page them away, and a prefs write can no longer stomp a not-yet-loaded record.
 *   v2.3.0 — 2026-08-18 — The status pieces moved to status-parts.js and the view answers Jouni's
 *     round on his real account: the mailbox with its flag, the fleet as one line instead of a
 *     worst-agent hero card, stars + folds on the chip lists, the favourite-apps row, the avatar
 *     on the nameplate, and the framed centre column.
 *   v2.2.0 — 2026-08-18 — The home shows what is RELEVANT TO YOU: the shared spaces you belong to
 *     and the knowledge packages you made, by name; which mind answers in the chat; and an
 *     achievements strip derived from the account's real state.
 *   v2.1.0 — 2026-08-18 — Things({usage}): what the person has made, each count a door to its
 *     surface, between the agent card and the feed.
 *   v2.0.0 — 2026-08-18 — The finished home turns from an instruction sheet into a STATUS VIEW.
 *   v1.1.0 — 2026-08-16 — The install suggestion renders in both states: the browser never proposes
 *     installing on its own, so the home does.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 3).
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { useSession } from '/js/use-session.js';
import { Spinner } from '/components/Spinner.js';
import { StepMat, StepMatDone } from '/views/home/step-mat.js';
import { StepAgent } from '/views/home/step-agent.js';
import { StepBranchB } from '/views/home/step-branch-b.js';
import { HomeSettingsDialog } from '/views/home/settings-dialog.js';
import { SurfaceRenderer, useSurfaceLayout } from '/views/surface/renderer.js';
import { useHomeState } from '/views/surface/home-state.js';
import { invalidateShared } from '/views/surface/shared-read.js';

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

/**
 * The greeting. It no longer carries the name: the name is on the nameplate a line above, and
 * printing it twice inside sixty pixels reads as a bug.
 */
function Welcome() {
  return html`
    <header class="koti-welcome">
      <h1 class="koti-h1">${tr('home.welcome', 'Welcome to your new home.')}</h1>
      <p class="koti-welcome-sub">
        ${tr('home.welcomeSub', 'Before the place can do anything for you, there are a couple of things to do.')}
      </p>
    </header>`;
}

/**
 * The setup path, as one unit. An operator can drop it or put their own words around it; its own
 * order is not arrangeable, because branch B inserts a step and the dimmed ones are numbered by
 * position. It is driven by needsBetterApp (live) rather than by branch (write-once, historical),
 * so re-pasting a mat from a capable app collapses that step by itself.
 */
function OnboardingSteps({ state, onChanged, showToast }) {
  const step = state.step;
  const onBranchB = state.needsBetterApp || (state.branch === 'B' && !state.mat.done);
  return html`
    <ol class="koti-steps">
      <li>
        ${step === 'welcome-mat'
          ? html`<${StepMat} onDone=${onChanged} />`
          : html`<${StepMatDone} state=${state} />`}
      </li>
      <li>
        ${step === 'better-app'
          ? html`<${StepBranchB} state=${state} onChanged=${onChanged} />`
          : step === 'first-agent' && !onBranchB
            ? html`<${StepAgent} onChanged=${onChanged} showToast=${showToast} />`
            : html`<${DimmedStep}
                n="2"
                titleKey=${onBranchB ? 'home.step2b' : (STEP_TITLES[step]?.[0] ?? 'home.step2')}
                fallback=${onBranchB ? 'Get an app that can connect' : (STEP_TITLES[step]?.[1] ?? 'Connect your first agent')}
                note=${tr('home.step2Dim', 'Opens once your welcome mat is up.')} />`}
      </li>
      ${onBranchB && html`
        <li>
          ${step === 'first-agent'
            ? html`<${StepAgent} onChanged=${onChanged} showToast=${showToast} />`
            : html`<${DimmedStep}
                n="3"
                titleKey="home.step3"
                fallback="Connect your first agent"
                note=${tr('home.step3Dim', 'Opens once you have an app that can connect.')} />`}
        </li>`}
    </ol>`;
}

export default function HomeView({ navigate }) {
  const session = useSession();
  const { state, ready: stateReady } = useHomeState();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState('');

  // Which home to show decides which layout to read, and both are read before either is needed:
  // switching between them mid-session must not blank the page while a second fetch runs.
  const finished = useSurfaceLayout('home');
  const onboarding = useSurfaceLayout('home-onboarding');
  const surface = state?.initialized ? finished : onboarding;

  // One line of feedback, and only for things that went wrong: the steps themselves report by
  // changing, which is louder than a message that fades.
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 6000);
  }, []);

  // A step finishing changes the account's state, which is what decides the whole page.
  const onStepChanged = useCallback(() => {
    invalidateShared('home-state', '/v1/home/state');
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

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

  if (!stateReady || !surface.ready) {
    return html`<div class="koti koti-loading"><${Spinner} /></div>`;
  }

  if (!state) {
    return html`
      <div class="koti">
        <div class="koti-error" role="alert">
          <p class="koti-error-text">${tr('home.loadFailed', 'Your home could not be loaded just now. Try again in a moment.')}</p>
        </div>
      </div>`;
  }

  // What a block cannot fetch for itself: who is signed in, where the router goes, the way into the
  // settings dialog this view owns, and the step machine, which is state this view already holds.
  const ctx = {
    session,
    navigate,
    openSettings,
    renderSteps: () => html`
      <${Welcome} />
      <${OnboardingSteps} state=${state} onChanged=${onStepChanged} showToast=${showToast} />`,
  };

  return html`
    <div class="koti">
      <${SurfaceRenderer}
        layout=${surface.layout}
        freeform=${surface.freeform}
        ctx=${ctx}
        locale=${getLocale()} />
      <${HomeSettingsDialog} open=${settingsOpen} onClose=${() => setSettingsOpen(false)}
        session=${session} showToast=${showToast} />
      ${toast && html`<div class="koti-toast" role="status">${toast}</div>`}
    </div>`;
}
