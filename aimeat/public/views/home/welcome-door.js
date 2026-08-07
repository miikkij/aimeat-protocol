/**
 * @file public/views/home/welcome-door.js
 * @description The front door (aimeat_remake/01-speksi.md §1 and 12-ai-rekisteroi.md): the first
 *   thing on the landing page.
 *
 *   One sentence saying what this is — a digital home for your AI — and then three ways in, in the
 *   order they are worth trying:
 *
 *     1. **Let your AI do it.** One prompt. If their AI can make a POST request, they never touch
 *        the interface: they give it an email address and a link arrives. It is first because it
 *        is the strongest claim the product makes, demonstrated rather than described — and
 *        because it is the sharpest test of whether their AI is up to the rest of this.
 *     2. Register a home themselves.
 *     3. Sign in, drawn as a keyhole. Signing in here is stepping into a place you own, not
 *        authenticating to a service, and the language follows that the whole way down.
 *
 *   This component is the ONE deliberate exception to "the new path does not touch shared files":
 *   the landing page belongs to both paths, and the copy is a stated requirement. It lives in its
 *   own file so the exception stays one import line rather than a rewrite of landing.js.
 * @structure WelcomeDoor({ onNavigate })
 * @usage import { WelcomeDoor } from '/views/home/welcome-door.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 8).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
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

export function WelcomeDoor({ onNavigate }) {
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/v1/prompts/agent-onboard')
      .then(r => { if (alive) setPrompt(r?.data?.prompt || ''); })
      .catch(e => swallowed('welcome-door: agent-onboard prompt', e));
    return () => { alive = false; };
  }, []);

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
        <a class="koti-door-register" href="/v1/portal"
           onClick=${(e) => { e.preventDefault(); e.stopPropagation(); onNavigate('/v1/portal#register'); }}>
          <span class="koti-door-register-title">${tr('landing.registerHome', 'Register your home')}</span>
          <span class="koti-door-register-sub">${tr('landing.registerHomeSub', 'If you do not have a way in yet.')}</span>
        </a>

        ${/* Sign-in as a keyhole: coming back here is stepping into somewhere of your own. */''}
        <a class="koti-door-signin" href="/v1/portal"
           onClick=${(e) => { e.preventDefault(); e.stopPropagation(); onNavigate('/v1/portal#signin'); }}>
          ${Keyhole}
          <span>${tr('landing.signInHome', 'Sign in to your home')}</span>
        </a>
      </div>
    </section>`;
}
