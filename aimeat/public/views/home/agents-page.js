/**
 * @file public/views/home/agents-page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person's agents on a page of their own: the home's agents band (agents-band.js)
 *   without the rest of the home. The header's Agents link opens it, so the band is one click away
 *   whatever the person's home layout hides or how far down it puts the band.
 *
 *   The same read as the home's block (GET /v1/home/agents), with the route's largest limit, because
 *   this page exists to show the agents. More than that shows the band's own link to every agent.
 *   Unlike the home's block, it does not wait for a finished home: a person still on the first
 *   steps sees the sentence that makes an agent here too.
 *
 *   Composed from library components and the band; it has no sheet of its own.
 * @structure default AgentsPageView({ navigate })
 * @usage routed at /v1/home?agents=1 by spa.html; the header's Agents link
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Jouni, 2026-10-18: Messages and Agents in the header).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { getSession } from '/js/services/auth.js';
import { relayLiveUpdates } from '/lib/live-updates.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { FormActions } from '/components/Field.js';
import { Loud } from '/components/Action.js';
import { AgentsBand } from '/views/home/agents-band.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const HOME = '/v1/home';
/** The most workers GET /v1/home/agents lists in one read (MAX_LIMIT in src/routes/home/agents.ts). */
const LIMIT = 20;
/** The live-update domains the home's block re-reads on (views/surface/blocks-home.js AgentsBlock). */
const DOMAINS = ['agents', 'open-items', 'scheduler'];

export default function AgentsPageView({ navigate }) {
  const session = useSession();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const resp = await apiGet(`/v1/home/agents?limit=${LIMIT}`);
      setData(resp?.data ?? null);
      setLoadError('');
    } catch (err) { setLoadError(err?.message || String(err)); }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { if (session) loadRef.current(); }, [session]);
  // The page is a route of its own, so it opens the live stream itself, as machines.js does.
  useEffect(() => (session ? relayLiveUpdates(() => getSession()?.jwt) : undefined), [session]);
  useEffect(() => {
    const handler = (e) => {
      const domains = e?.detail?.domains;
      const touched = !domains || [...domains].some((d) => DOMAINS.includes(d));
      if (session && touched) loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session]);

  const goHome = useCallback((e) => { e?.preventDefault?.(); navigate(HOME); }, [navigate]);
  const back = html`<${BackLink} href=${HOME} onClick=${goHome}>↩ ${tr('home.history.back', 'Back to your home')}<//>`;

  if (!session) {
    return html`
      <${PageFrame}>
        <${PageIntro} title=${tr('home.agents.title', 'Your agents')} sub=${tr('home.agents.signInDesc', 'Sign in to see your agents.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (loadError && !data) return html`<${PageFrame}>${back}<${ErrorNote} text=${loadError} /><//>`;
  if (!data) return html`<${PageFrame} loading=${true}><${Spinner} /><//>`;

  return html`
    <${PageFrame}>
      ${back}
      <${AgentsBand} data=${data} navigate=${navigate} />
    <//>`;
}
