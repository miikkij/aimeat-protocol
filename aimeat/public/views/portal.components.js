/**
 * @file public/views/portal.components.js
 * @description Portal feed / prompt / world sub-components (OnelinersFeed, PromptSection, UserWorldAccordion, TheWorld). Extracted from portal.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from views/portal.js (max-file-lines)
 */
import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import htm from "htm";
import { t } from "/js/i18n.js";
import { CopyButton as BaseCopyButton } from "/components/CopyButton.js";
import { StatusDot } from "/components/StatusDot.js";
import { hasAuth, getCurrentSession, timeAgo } from "./portal.helpers.js";
import { buildMainPrompt, buildFullBuilderPrompt, buildAgentPrompt, buildConnectPrompt } from "./portal.prompts.js";

const html = htm.bind(h);
const NODE_URL = window.location.origin;

function pickProvocation() {
  const lines = t('portal.provocation.lines');
  const weights = t('portal.provocation.weights');
  if (!Array.isArray(lines) || lines.length === 0) return t('portal.provocation.line1');
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < lines.length; i++) {
    r -= weights[i];
    if (r <= 0) return lines[i];
  }
  return lines[lines.length - 1];
}

export function OnelinersFeed() {
  const [messages, setMessages] = useState([]);
  const [provocation] = useState(() => pickProvocation());

  useEffect(() => {
    let iv;
    // Resolve the anonymous GAII from node metadata, then poll
    fetch('/v1/site').then(r => r.json()).then(site => {
      const nodeId = site?.data?.node_id;
      if (!nodeId) return;
      const anonGaii = encodeURIComponent('shared#anonymous@' + nodeId);
      function load() {
        fetch('/v1/memory/' + anonGaii + '/anonymous.oneliners')
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d && d.ok && d.data && d.data.value && d.data.value.messages) {
              setMessages(d.data.value.messages.slice(-20).reverse());
            }
          })
          .catch(() => {});
      }
      load();
      iv = setInterval(load, 15000);
    }).catch(() => {});
    return () => { if (iv) clearInterval(iv); };
  }, []);

  return html`
    <div class="content-group">
      <div class="oneliners-header">
        <${StatusDot} status="live" />
        <span class="oneliners-label">${t('portal.oneliners.title')}</span>
      </div>
      <section class="provocation">
        <div class="provocation-line1">${provocation}</div>
      </section>
      <section class="oneliners-section">
        <div class="oneliners-feed">
          ${messages.length === 0
            ? html`<div class="oneliners-empty">${t('portal.oneliners.empty')}</div>`
            : messages.map((m, i) => html`
              <div class="oneliner" key=${i}>
                <span class="oneliner-text">${m.msg || ''}</span>
                <span class="oneliner-time">${timeAgo(m.t)}</span>
              </div>
            `)
          }
        </div>
      </section>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   COPY BUTTON COMPONENT
   ══════════════════════════════════════════════ */
// Thin wrapper over the canonical CopyButton (aliased to avoid the name clash) \u2014
// keeps the .copy-btn styling + the "<copied> \u2714" confirmed label.
function CopyButton({ text, label, copiedLabel }) {
  return html`<${BaseCopyButton} text=${text} label=${label} copiedLabel=${(copiedLabel || t('portal.prompt.copied')) + ' \u2714'} className="copy-btn" />`;
}

/* ══════════════════════════════════════════════
   PROMPT SECTION COMPONENT
   ══════════════════════════════════════════════ */
export function PromptSection() {
  const promptText = buildMainPrompt();

  return html`
    <div class="content-group">
      <section class="prompt-section">
        <div class="prompt-actions">
          <${CopyButton} text=${promptText} label=${t('portal.prompt.copyBtn')} />
        </div>
        <textarea class="prompt-box" readonly value=${promptText}></textarea>
        <div class="prompt-note">${t('portal.promptLangNote')}</div>
      </section>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   USER WORLD ACCORDION
   ══════════════════════════════════════════════ */
function UserWorldAccordion() {
  const [stats, setStats] = useState({ wallet: '-', agents: '-', memory: '-', work: '-', services: '-', apps: '-', files: '-' });
  const [identity, setIdentity] = useState({ owner: '-', ghii: '-' });

  useEffect(() => {
    async function loadSummary() {
      const s = getCurrentSession();
      if (!s || !s.fetch) return;

      setIdentity({ owner: s.owner || '-', ghii: s.ghii || '-' });

      const safe = (p) => p.then(v => v).catch(() => null);
      const responses = await Promise.all([
        safe(s.fetch('/v1/wallet')),
        safe(s.fetch('/v1/agents')),
        safe(s.fetch('/v1/memory')),
        safe(s.fetch('/v1/work/inbox')),
        safe(s.fetch('/v1/actions')),
        safe(s.fetch('/v1/storage')),
        safe(fetch('/v1/apps').then(r => r.ok ? r.json() : null))
      ]);

      const wallet = responses[0]?.data;
      const agents = responses[1]?.data?.agents || [];
      const memories = responses[2]?.data?.entries || [];
      const work = responses[3]?.data?.items || [];
      const actions = responses[4]?.data?.actions || [];
      const files = responses[5]?.data?.files || [];
      const apps = responses[6]?.data?.apps || [];

      const ownActions = actions.filter(a => s.gaii && a.provider_gaii === s.gaii);
      const ownApps = apps.filter(a => s.owner && a.owner === s.owner);

      setStats({
        wallet: wallet?.balance != null ? wallet.balance : '-',
        agents: agents.length,
        memory: memories.length,
        work: work.length,
        services: ownActions.length,
        apps: ownApps.length,
        files: files.length
      });
    }
    loadSummary();
  }, []);

  const statItems = [
    ['wallet', stats.wallet], ['agents', stats.agents], ['memory', stats.memory],
    ['work', stats.work], ['services', stats.services], ['apps', stats.apps], ['files', stats.files]
  ];

  return html`
    <div class="user-world">
      <!-- Profile Overview -->
      <details class="user-world-item" open>
        <summary class="user-world-summary">\u{1F464} ${t('portal.userWorld.profile.title')}</summary>
        <div class="user-world-content">
          <div class="user-world-desc">${t('portal.userWorld.profile.desc')}</div>
          <div class="user-meta">
            <div class="user-meta-key">${t('portal.userWorld.profile.owner')}</div><div class="user-meta-value">${identity.owner}</div>
            <div class="user-meta-key">${t('portal.userWorld.profile.ghii')}</div><div class="user-meta-value">${identity.ghii}</div>
            <div class="user-meta-key">${t('portal.userWorld.profile.node')}</div><div class="user-meta-value">${NODE_URL}</div>
          </div>
          <div class="user-world-grid">
            ${statItems.map(([key, val]) => html`
              <div class="stat-card" key=${key}>
                <div class="stat-card-label">${t('portal.userWorld.stats.' + key)}</div>
                <div class="stat-card-value">${val}</div>
              </div>
            `)}
          </div>
          <div class="user-link-row">
            <a class="user-link-btn" href="/v1/profile">${t('portal.userWorld.profile.openProfile')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=wallet">${t('portal.userWorld.profile.openWallet')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=memory">${t('portal.userWorld.profile.openMemory')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=work">${t('portal.userWorld.profile.openWork')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=services">${t('portal.userWorld.profile.openServices')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=apps">${t('portal.userWorld.profile.openApps')}</a>
          </div>
        </div>
      </details>

      <!-- Marketplace -->
      <details class="user-world-item">
        <summary class="user-world-summary">\u{1F6D2} ${t('portal.userWorld.marketplace.title')}</summary>
        <div class="user-world-content">
          <div class="user-world-desc">${t('portal.userWorld.marketplace.desc')}</div>
          <div class="user-link-row">
            <a class="user-link-btn" href="/v1/marketplace">${t('portal.userWorld.marketplace.open')}</a>
            <a class="user-link-btn" href="/v1/profile?tab=services">${t('portal.userWorld.marketplace.manage')}</a>
          </div>
        </div>
      </details>

      <!-- Recent Services -->
      <details class="user-world-item">
        <summary class="user-world-summary">\u{1F9ED} ${t('portal.userWorld.services.title')}</summary>
        <div class="user-world-content">
          <div class="user-world-desc">${t('portal.userWorld.services.desc')}</div>
          <div class="user-link-row">
            <a class="user-link-btn" href="/v1/hobbies">${t('portal.userWorld.services.hobbies')}</a>
            <a class="user-link-btn" href="/v1/guides">${t('portal.userWorld.services.guides')}</a>
            <a class="user-link-btn" href="/v1/aimeat-os">${t('portal.userWorld.services.aimeatOs')}</a>
            <a class="user-link-btn" href="/v1/openclaw">${t('portal.userWorld.services.openclaw')}</a>
            <a class="user-link-btn" href="/app-catalog.html">${t('portal.userWorld.services.catalog')}</a>
          </div>
        </div>
      </details>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   THE WORLD (EXPANDED CONTENT)
   ══════════════════════════════════════════════ */
export function TheWorld({ navigate }) {
  const fullBuilder = buildFullBuilderPrompt();
  const agentPr = buildAgentPrompt();
  const connectPr = buildConnectPrompt();

  const handleRegister = useCallback(() => {
    if (!hasAuth()) return;
    const existing = AIMEAT.auth.getSession();
    if (existing && existing.token) {
      navigate('/v1/profile');
      return;
    }
    // Trigger login modal
    const slot = document.getElementById('headerAuth');
    const loginBtn = slot && slot.querySelector('#aimeat-login-btn');
    if (loginBtn) /** @type {HTMLElement} */ (loginBtn).click();
  }, [navigate]);

  return html`
    <div class="world open">
      <div class="world-divider"></div>

      <${UserWorldAccordion} navigate=${navigate} />

      <!-- Full App Builder -->
      <div class="world-card">
        <div class="world-card-title">\u{1F3A8} ${t('portal.world.fullBuilder.title')}</div>
        <div class="world-card-desc">${t('portal.world.fullBuilder.desc')}</div>
        <textarea class="prompt-box" readonly value=${fullBuilder}></textarea>
        <div class="prompt-actions">
          <${CopyButton} text=${fullBuilder} label=${t('portal.world.fullBuilder.copyBtn')} copiedLabel=${t('portal.world.fullBuilder.copied')} />
        </div>
      </div>

      <!-- Apps -->
      <div class="world-card">
        <div class="world-card-title">\u{1F680} ${t('portal.world.apps.title')}</div>
        <div class="world-card-desc">${t('portal.world.apps.desc')}</div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
          <a href="/app-catalog.html" class="world-card-cta">\u{1F680} ${t('portal.world.catalog.openBtn')}</a>
          <a href="/app-catalog.html" download="app-catalog.html" class="world-card-cta">\u{1F4E5} ${t('portal.world.catalog.downloadBtn')}</a>
        </div>
      </div>

      <!-- AI Agents -->
      <div class="world-card">
        <div class="world-card-title">\u{1F916} ${t('portal.world.agents.title')}</div>
        <div class="world-card-desc">${t('portal.world.agents.desc')}</div>
        <textarea class="prompt-box" readonly value=${agentPr}></textarea>
        <div class="prompt-actions">
          <${CopyButton} text=${agentPr} label=${t('portal.world.agents.copyBtn')} copiedLabel=${t('portal.world.agents.copied')} />
        </div>
      </div>

      <!-- Connect Runtime -->
      <div class="world-card">
        <div class="world-card-title">\u{1F527} ${t('portal.world.connect.title')}</div>
        <div class="world-card-desc">${t('portal.world.connect.desc')}</div>
        <textarea class="prompt-box" readonly value=${connectPr}></textarea>
        <div class="prompt-actions">
          <${CopyButton} text=${connectPr} label=${t('portal.world.connect.copyBtn')} copiedLabel=${t('portal.world.connect.copied')} />
        </div>
        <div style="margin-top:0.75rem;text-align:center">
          <a href="/v1/openclaw" class="connect-link">${t('portal.world.connect.readMore')} \u2192</a>
        </div>
      </div>

      <!-- Services / Builders -->
      <div class="world-card">
        <div class="world-card-title">\u2699\uFE0F ${t('portal.world.builders.title')}</div>
        <div class="world-card-desc">${t('portal.world.builders.desc')}</div>
        <button class="world-register-btn" type="button" onClick=${handleRegister}>${t('portal.world.builders.registerBtn')}</button>
      </div>

      <!-- Morsels footer -->
      <div class="footer">
        <span class="heart-icon">\u{1F496}</span> ${t('portal.morsels.economy')}
      </div>
    </div>
  `;
}
