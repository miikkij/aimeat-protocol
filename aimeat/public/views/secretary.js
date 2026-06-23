/**
 * @file secretary.js
 * @description Secretary view. Phase 0 = identity/provisioning status. Phase 1 = the "hire" onboarding:
 *   a prompt-driven interview (copy to the user's own AI) produces a JSON result that authors the
 *   Secretary's brain (prose directives) AND an AI-designed self-organism + workspaces. The interview
 *   asks only about needs/goals/work — never about organisms/workspaces; the AI translates needs →
 *   structure. Pure frontend orchestration over generic endpoints (directives + organisms + memory).
 *   Reached from the header Secretary button (shown once OpenRouter is configured).
 *   Full design: docs/plans/2026-06-23-secretary-feature.md.
 * @structure SECRETARY_ICON · buildInterviewPrompt(owner) · extractJson(text) · SecretaryView (default).
 * @usage routed at /v1/secretary by spa.html (+ portal.ts spaRoutes).
 * @version-history
 *   v0.2.0 — 2026-06-23 — Phase 1: hire onboarding (interview → brain + self-organism).
 *   v0.1.0 — 2026-06-23 — Phase 0 shell: provisioning status + identity.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import { escHtml } from '/js/utils.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { CopyButton } from '/components/CopyButton.js';
import { useToast } from '/components/Toast.js';
import { createOrganism, createWorkspace } from '/js/services/organisms.js';

// Heart-shaped shield with a quill across it — the Secretary's mark.
export const SECRETARY_ICON = html`
  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
    <path d="M12 20.6C6.4 16.7 3.4 13.2 3.4 9.2 3.4 6.5 5.4 4.6 7.9 4.6c1.7 0 3.2.9 4.1 2.4.9-1.5 2.4-2.4 4.1-2.4 2.5 0 4.5 1.9 4.5 4.6 0 4-3 7.5-8.6 11.4z"
          fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M16 8l-5.6 5.6M10.4 13.6l-1.5 2.4 2.4-1.5"
          fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

/** The prompt-driven onboarding interview. The user's own AI runs it, then returns the JSON contract. */
export function buildInterviewPrompt(owner) {
  return `I want to set up my personal Secretary inside AIMEAT${owner ? ` (my username is "${owner}")` : ''}.

Act as that Secretary getting to know me. Interview me with a few focused questions about:
- what I'm trying to achieve right now (my goals and the projects/threads I'm juggling),
- the kinds of tasks I'd want help with, and
- how I like to communicate (tone, language, level of detail).

Do NOT ask me about "organisms", "workspaces", folders, schemas, or any technical structure — figure the right structure out yourself from what I tell you. Keep it conversational; ask, wait for my answers, then continue.

When you have enough, design two things and output them as ONE JSON object inside a single \`\`\`json code block, with EXACTLY this shape and nothing else:

\`\`\`json
{
  "brain": {
    "purpose": "1-3 sentences: who my Secretary is and how it helps me",
    "rules": [
      { "id": "r1", "description": "a concrete operating rule for how it should work" }
    ]
  },
  "organism": {
    "name": "a short name for my personal space",
    "description": "one line describing it",
    "workspaces": [
      { "name": "workspace name", "purpose": "what it holds and why it's needed" }
    ]
  }
}
\`\`\`

Constraints: 3–7 brain rules; 2–6 workspaces, each designed from my actual needs (you choose names + purposes). Output ONLY the JSON code block — no commentary before or after.`;
}

/** Robustly pull a JSON object out of an AI's pasted text (may be wrapped in ``` fences / prose). */
export function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{') {
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
  }
  return JSON.parse(s);
}

export default function SecretaryView() {
  useViewCSS('/css/views/secretary.css');
  const { showToast, ToastContainer } = useToast();
  // undefined = loading, null = not provisioned, object = the Secretary agent.
  const [secretary, setSecretary] = useState(undefined);
  const [brain, setBrain] = useState(null);        // merged directives (purpose/rules)
  const [config, setConfig] = useState(null);      // secretary.config (selfOrganism summary)
  const [result, setResult] = useState('');
  const [applying, setApplying] = useState(false);

  const owner = (secretary && secretary.owner)
    || (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession()?.owner)
    || '';

  const load = useCallback(async () => {
    const agentsResp = await apiGet('/v1/agents').catch(() => null);
    const agents = (agentsResp && agentsResp.data && agentsResp.data.agents) || [];
    const sec = agents.find((a) => (a.tags || []).includes('system:secretary'))
      || agents.find((a) => a.name === 'secretary')
      || null;
    setSecretary(sec);
    if (sec) {
      const [dir, cfg] = await Promise.all([
        apiGet('/v1/agents/secretary/directives').catch(() => null),
        apiGet('/v1/memory/secretary.config').catch(() => null),
      ]);
      setBrain((dir && dir.data) || null);
      setConfig((cfg && cfg.data && cfg.data.value) || null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hired = !!(brain && brain.purpose);
  const interviewPrompt = buildInterviewPrompt(owner);

  const applyResult = useCallback(async () => {
    setApplying(true);
    try {
      const json = extractJson(result);
      const b = json.brain || {};
      const org = json.organism || {};
      if (!b.purpose || !org.name || !Array.isArray(org.workspaces) || org.workspaces.length === 0) {
        throw new Error(t('secretary.hireBadShape'));
      }
      // 1) Brain → the Secretary's agent-layer directives. Guarantee the scout-before-build rule.
      const rules = Array.isArray(b.rules) ? b.rules.slice() : [];
      if (!rules.some((r) => /discover|scout|already exist/i.test(r.description || ''))) {
        rules.push({ id: 'scout-before-build', description: 'Before building or delegating anything, first search what already exists (map then find via aimeat_discover) and reuse it.' });
      }
      await apiPut('/v1/agents/secretary/directives', { purpose: b.purpose, rules });

      // 2) Self-organism + workspaces (owner owns it; the Secretary designed it).
      const created = await createOrganism({ name: org.name, description: org.description || '', visibility: 'private', join_policy: 'open' });
      const orgId = created && created.data && created.data.organism && created.data.organism.id;
      const wsSummary = [];
      if (orgId) {
        for (const ws of org.workspaces.slice(0, 12)) {
          const name = String(ws.name || '').trim();
          if (!name) continue;
          const entry = await createWorkspace(orgId, name);
          if (entry && entry.id && ws.purpose) {
            await apiPost('/v1/memory', { key: `organism.${orgId}.w.${entry.id}.meta.readme`, value: `# ${name}\n\n${ws.purpose}`, visibility: 'private' });
          }
          wsSummary.push({ name, purpose: ws.purpose || '' });
        }
        // 3) Remember the self-organism for display + later phases.
        await apiPost('/v1/memory', { key: 'secretary.config', value: { selfOrganismId: orgId, organismName: org.name, workspaces: wsSummary }, visibility: 'private' });
      }
      showToast(t('secretary.hireDone'));
      setResult('');
      await load();
    } catch (e) {
      showToast(`${t('secretary.hireError')}: ${e.message}`, true);
    } finally {
      setApplying(false);
    }
  }, [result, load, showToast]);

  return html`
    <div class="sec">
      <header class="sec-hero">
        <span class="sec-hero-icon">${SECRETARY_ICON}</span>
        <div>
          <h1 class="sec-title">${t('secretary.title')}</h1>
          <p class="sec-desc">${t('secretary.desc')}</p>
        </div>
      </header>

      ${secretary === undefined
        ? html`<div class="sec-empty">…</div>`
        : secretary === null
        ? html`<div class="sec-empty">${t('secretary.notReady')}</div>`
        : !hired
        ? html`
            <section class="sec-card sec-hire">
              <h2 class="sec-h2">${t('secretary.hireTitle')}</h2>
              <p class="sec-desc">${t('secretary.hireIntro')}</p>

              <div class="sec-step"><span class="sec-step-n">1</span> ${t('secretary.hireStep1')}</div>
              <div class="sec-prompt-box">${interviewPrompt}</div>
              <${CopyButton} text=${interviewPrompt} className="btn-outline" label=${t('secretary.copyPrompt')} copiedLabel=${'✓ ' + t('secretary.copied')} />

              <div class="sec-step"><span class="sec-step-n">2</span> ${t('secretary.hireStep2')}</div>
              <textarea class="sec-paste" rows="8" placeholder=${t('secretary.pastePlaceholder')}
                value=${result} onInput=${(e) => setResult(e.target.value)}></textarea>
              <div class="sec-actions">
                <button class="btn-primary" disabled=${!result.trim() || applying} onClick=${applyResult}>
                  ${applying ? t('secretary.applying') : t('secretary.apply')}
                </button>
              </div>
            </section>`
        : html`
            <section class="sec-card">
              <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.hiredStatus')}</div>
              <h2 class="sec-h2">${t('secretary.brain')}</h2>
              <p class="sec-purpose">${escHtml(brain.purpose)}</p>
              ${Array.isArray(brain.rules) && brain.rules.length > 0 && html`
                <ul class="sec-rules">
                  ${brain.rules.filter((r) => r.source !== 'system').map((r) => html`<li key=${r.id}>${escHtml(r.description)}</li>`)}
                </ul>`}
              ${config && config.organismName && html`
                <h2 class="sec-h2">${t('secretary.selfOrganism')}</h2>
                <p class="sec-orgname">🗂 ${escHtml(config.organismName)}</p>
                ${Array.isArray(config.workspaces) && html`
                  <ul class="sec-ws">
                    ${config.workspaces.map((w, i) => html`<li key=${i}><strong>${escHtml(w.name)}</strong>${w.purpose ? html` — ${escHtml(w.purpose)}` : null}</li>`)}
                  </ul>`}`}
              <p class="sec-soon">${t('secretary.soon')}</p>
            </section>

            <section class="sec-card sec-meta-card">
              <dl class="sec-meta">
                <dt>${t('secretary.identity')}</dt>
                <dd><code>${escHtml(secretary.gaii)}</code></dd>
                <dt>${t('secretary.scopes')}</dt>
                <dd class="sec-scopes">
                  ${(secretary.default_scopes || []).map((s) => html`<span class="sec-scope" key=${s}>${s}</span>`)}
                </dd>
              </dl>
            </section>`}
      <${ToastContainer} />
    </div>`;
}
