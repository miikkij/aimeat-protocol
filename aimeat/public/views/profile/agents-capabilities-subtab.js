/**
 * @file agents-capabilities-subtab.js
 * @description Capabilities sub-tab for agent detail view.
 *   Shows technical skills with type/verification badges,
 *   domain knowledge with language tags, and action queue support
 *   derived from the agent's scopes.
 * @structure
 *   - AgentCapabilitiesSubtab (default export) -- main component
 *   - TechnicalSkills -- badge list of technical capabilities
 *   - DomainKnowledge -- domain expertise + language tags
 *   - ActionQueueSupport -- scope-derived work accept/deliver indicators
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 2
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getCapabilities } from '/js/services/agent-capabilities.js';

function tFallback(key, fallback) {
  const val = t(key);
  return val !== key ? val : fallback;
}

function TechnicalSkills({ capabilities }) {
  if (!capabilities || capabilities.length === 0) return null;

  return html`
    <div class="agd-directive-section">
      <h4>${tFallback('profile.agents.capabilities.technical', 'Technical Skills')}</h4>
      <div class="agd-cap-list">
        ${capabilities.map(cap => html`
          <span class="agd-cap-badge">
            <span class="agd-cap-name">${cap.name}</span>
            <span class="agd-cap-type agd-cap-type-${cap.type}">${cap.type}</span>
            ${cap.verified
              ? html`<span class="agd-cap-verified">${tFallback('profile.agents.capabilities.verified', 'verified')}</span>`
              : html`<span class="agd-cap-unverified">${tFallback('profile.agents.capabilities.selfReported', 'self-reported')}</span>`
            }
          </span>
        `)}
      </div>
    </div>
  `;
}

function DomainKnowledge({ domains }) {
  if (!domains || domains.length === 0) return null;

  const languages = domains.filter(d => d.startsWith('Language: '));
  const otherDomains = domains.filter(d => !d.startsWith('Language: '));

  return html`
    <div class="agd-directive-section">
      <h4>${tFallback('profile.agents.capabilities.domain', 'Domain Knowledge')}</h4>
      ${otherDomains.length > 0 && html`
        <div class="agd-cap-list">
          ${otherDomains.map(d => html`
            <span class="agd-cap-badge agd-cap-domain">${d}</span>
          `)}
        </div>
      `}
      ${languages.length > 0 && html`
        <div class="agd-cap-langs">
          <span class="agd-cap-lang-label">${tFallback('profile.agents.capabilities.languages', 'Languages')}:</span>
          ${languages.map(l => html`
            <span class="agd-cap-badge agd-cap-lang">${l.replace('Language: ', '')}</span>
          `)}
        </div>
      `}
    </div>
  `;
}

function ActionQueueSupport({ scopes }) {
  const scopeList = scopes ?? [];
  const hasAll = scopeList.includes('*');
  const canAccept = hasAll || scopeList.includes('work:accept');
  const canDeliver = hasAll || scopeList.includes('work:deliver');

  if (!canAccept && !canDeliver) return null;

  return html`
    <div class="agd-directive-section">
      <h4>${tFallback('profile.agents.capabilities.actionQueue', 'Action Queue Support')}</h4>
      <div class="agd-cap-queue-list">
        ${canAccept && html`
          <div class="agd-cap-queue-item">
            <span class="agd-cap-check">✓</span>
            <span>${tFallback('profile.agents.capabilities.canAccept', 'Can accept work')}</span>
          </div>
        `}
        ${canDeliver && html`
          <div class="agd-cap-queue-item">
            <span class="agd-cap-check">✓</span>
            <span>${tFallback('profile.agents.capabilities.canDeliver', 'Can deliver work')}</span>
          </div>
        `}
      </div>
    </div>
  `;
}

export default function AgentCapabilitiesSubtab({ agentName, session, showToast, agent }) {
  const [techCaps, setTechCaps] = useState(null);
  const [domainCaps, setDomainCaps] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const resp = await getCapabilities(agentName);
        if (cancelled) return;
        setTechCaps(resp?.data?.technical_capabilities ?? []);
        setDomainCaps(resp?.data?.domain_capabilities ?? []);
      } catch {
        if (!cancelled) {
          setTechCaps([]);
          setDomainCaps([]);
        }
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [agentName]);

  // Listen for live updates
  useEffect(() => {
    const handler = async () => {
      try {
        const resp = await getCapabilities(agentName);
        setTechCaps(resp?.data?.technical_capabilities ?? []);
        setDomainCaps(resp?.data?.domain_capabilities ?? []);
      } catch { /* ignore */ }
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [agentName]);

  if (loading) {
    return html`<div class="agd-empty">⏳</div>`;
  }

  const scopes = agent?.default_scopes ?? [];
  const hasTech = techCaps && techCaps.length > 0;
  const hasDomain = domainCaps && domainCaps.length > 0;
  const hasQueue = scopes.includes('*') || scopes.includes('work:accept') || scopes.includes('work:deliver');

  if (!hasTech && !hasDomain && !hasQueue) {
    return html`<div class="agd-empty">${tFallback('profile.agents.capabilities.empty', 'No capabilities reported yet')}</div>`;
  }

  return html`
    <div>
      <${TechnicalSkills} capabilities=${techCaps} />
      <${DomainKnowledge} domains=${domainCaps} />
      <${ActionQueueSupport} scopes=${scopes} />
    </div>
  `;
}
