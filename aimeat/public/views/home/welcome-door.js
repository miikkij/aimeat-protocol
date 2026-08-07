/**
 * @file public/views/home/welcome-door.js
 * @description The front door (aimeat_remake/01-speksi.md §1 and 12-ai-rekisteroi.md): the first
 *   thing on the landing page.
 *
 *   It shows one of TWO things, because the landing page is reachable in both states and a door
 *   that ignores that is worse than no door at all:
 *
 *   **Signed out** — one sentence saying what this is, then three ways in, in the order they are
 *   worth trying:
 *     1. **Let your AI do it.** One prompt. If their AI can make a POST request, they never touch
 *        the interface: they give it an email address and a link arrives.
 *     2. Register a home themselves.
 *     3. Sign in, drawn as a keyhole.
 *
 *   **Signed in** — none of that. Offering "Register your home" to somebody who is already home is
 *   the kind of thing that makes a product feel broken, and both controls used to do NOTHING when
 *   pressed (see below). What a signed-in person gets instead is the way to their own home, and
 *   the switch between the new home and the old profile — which until now existed only INSIDE the
 *   new home, so anyone sitting on the old side had no way to find it at all.
 *
 *   **The two controls open the real auth modal** (via /js/services/auth.js), the same one the
 *   header pill opens. They used to call the SPA router with `/v1/portal#register`, and
 *   `/v1/portal` IS this page — so the router dutifully re-rendered the landing page and nothing
 *   observable happened. A route that resolves to the view you are already looking at is not
 *   navigation.
 * @structure WelcomeDoor({ onNavigate })
 * @usage import { WelcomeDoor } from '/views/home/welcome-door.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 8).
 *   v1.1.0 — 2026-08-08 — Session-aware, and the buttons actually do something: register/sign-in
 *     open the auth modal instead of re-routing to this same page, and a signed-in visitor gets
 *     their home plus the switch between the two sides.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { showLoginModal } from '/js/services/auth.js';
import { CopyButton } from '/components/CopyButton.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The keyhole. Drawn rather than an icon font, so it needs nothing to load and scales cleanly. */
const Keyhole = html`
  <svg class="koti-keyhole" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="9" r="4" />
    <path d="M12 13 L10.5 20 L13.5 20 Z" fill="currentColor" stroke="none" />
  </svg>`;

/**
 * Open the shared auth modal on the tab that matches what the button said.
 * Returns false when the auth library has not loaded yet, so the caller can fall back to the
 * portal rather than swallowing the click — a dead button is the bug this file exists to fix.
 */
function openAuth(tab) {
  // Through the service, not window.AIMEAT.auth: the service subscribes to the auth library's own
  // post-change events, so nothing here can act on a session that has already been signed out.
  return showLoginModal({
    tab,
    onLogin: () => window.dispatchEvent(new Event('aimeat-auth-change')),
  });
}

/** What a signed-in person sees: their own home, and the way to the other side. */
function SignedIn({ onNavigate }) {
  const [ui, setUi] = useState(null);       // 'home' | 'profile'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/v1/home/ui-track')
      .then(r => { if (alive) setUi(r?.data?.ui ?? 'profile'); })
      .catch(e => swallowed('welcome-door: ui-track', e));
    return () => { alive = false; };
  }, []);

  const go = useCallback(() => {
    onNavigate(ui === 'home' ? '/v1/home' : '/v1/profile');
  }, [ui, onNavigate]);

  // The switch is the same call the home's settings dialog makes, in the other direction. It is
  // here because this is the only page both sides share: somebody on the old profile could not
  // reach the new home from anywhere, which made the choice invisible rather than optional.
  const flip = useCallback(async () => {
    const next = ui === 'home' ? 'profile' : 'home';
    setBusy(true);
    try {
      const r = await api('/v1/home/ui-track', { method: 'PUT', body: JSON.stringify({ ui: next }) });
      window.location.href = r?.data?.landing || (next === 'home' ? '/v1/home' : '/v1/profile');
    } catch (e) {
      swallowed('welcome-door: switch', e);
      setBusy(false);
    }
  }, [ui]);

  if (!ui) return null;   // one tick, rather than flashing the wrong offer

  return html`
    <section class="koti-door">
      <h1 class="koti-door-title">${tr('landing.homeBackTitle', 'You are already home.')}</h1>

      <div class="koti-door-entrances">
        <a class="koti-door-register" href=${ui === 'home' ? '/v1/home' : '/v1/profile'}
           onClick=${(e) => { e.preventDefault(); e.stopPropagation(); go(); }}>
          <span class="koti-door-register-title">${tr('landing.homeBackGo', 'Go to your home')}</span>
          <span class="koti-door-register-sub">
            ${ui === 'home'
              ? tr('landing.homeBackOnHome', 'Everything you have made is there.')
              : tr('landing.homeBackOnProfile', 'Your profile, where you left it.')}
          </span>
        </a>
      </div>

      <div class="koti-door-switch">
        <span>
          ${ui === 'home'
            ? tr('home.switch.here', 'You are using the new home view.')
            : tr('landing.switchOnProfile', 'You are using the old profile.')}
        </span>
        <button type="button" class="btn-ghost" disabled=${busy} onClick=${flip}>
          ${ui === 'home'
            ? tr('home.switch.toProfile', 'Go back to the old profile')
            : tr('landing.switchToHome', 'Try the new home')}
        </button>
      </div>
    </section>`;
}

export function WelcomeDoor({ onNavigate }) {
  const session = useSession();
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (session) return undefined;          // nothing here to register with
    let alive = true;
    apiGet('/v1/prompts/agent-onboard')
      .then(r => { if (alive) setPrompt(r?.data?.prompt || ''); })
      .catch(e => swallowed('welcome-door: agent-onboard prompt', e));
    return () => { alive = false; };
  }, [session]);

  if (session) return html`<${SignedIn} onNavigate=${onNavigate} />`;

  const enter = (e, tab) => {
    e.preventDefault();
    e.stopPropagation();
    // The modal is the real thing. If the auth library has not arrived yet, send them to the
    // portal rather than doing nothing at all.
    if (!openAuth(tab)) onNavigate('/v1/portal');
  };

  return html`
    <section class="koti-door">
      <h1 class="koti-door-title">
        ${tr('landing.homeWelcome', 'Welcome to your digital AI home.')}
      </h1>

      ${/* The agent door, first. No mention of MCP on the button — that word belongs inside the
            prompt and the details, not on the thing a stranger reads first. */''}
      <div class="koti-door-agent">
        <div class="koti-door-agent-head">
          <div>
            <p class="koti-door-agent-title">${tr('landing.agentDoorTitle', 'Let your AI do this')}</p>
            <p class="koti-door-agent-sub">
              ${tr('landing.agentDoorSub', 'Copy the prompt into your own AI chat. If it can, a link arrives in your email and your account is done.')}
            </p>
          </div>
          <${CopyButton}
            text=${prompt}
            className="btn-primary"
            label=${tr('landing.agentDoorCopy', 'Copy the prompt')}
            copiedLabel=${tr('landing.agentDoorCopied', 'Copied — paste it in your AI chat')}
            onCopied=${() => setOpen(true)} />
        </div>

        ${open && html`
          <div class="koti-door-after">
            <p>${tr('landing.agentDoorAfter', 'It will ask you for your email address and nothing else. You choose your own username afterwards, from the link.')}</p>
            <p>${tr('landing.agentDoorMcp', 'Be ready to set up a connector for it later — that is the step that lets it reach your home directly.')}</p>
            <p>${tr('landing.agentDoorCannot', 'If it says it cannot, that is a fine answer. Register below instead.')}</p>
          </div>`}
      </div>

      <div class="koti-door-entrances">
        <a class="koti-door-register" href="/v1/portal" onClick=${(e) => enter(e, 'register')}>
          <span class="koti-door-register-title">${tr('landing.registerHome', 'Register your home')}</span>
          <span class="koti-door-register-sub">${tr('landing.registerHomeSub', 'If you do not have a way in yet.')}</span>
        </a>

        ${/* Sign-in as a keyhole: coming back here is stepping into somewhere of your own. */''}
        <a class="koti-door-signin" href="/v1/portal" onClick=${(e) => enter(e, 'signin')}>
          ${Keyhole}
          <span>${tr('landing.signInHome', 'Sign in to your home')}</span>
        </a>
      </div>
    </section>`;
}
