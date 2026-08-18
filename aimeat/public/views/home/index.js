/**
 * @file public/views/home/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v2.3.0 — 2026-08-18 — The status pieces moved to status-parts.js and the view answers Jouni's
 *     round on his real account: the mailbox with its flag, the fleet as one line instead of a
 *     worst-agent hero card, stars + folds on the chip lists, the favourite-apps row, the avatar
 *     on the nameplate, and the framed centre column.
 *   v2.2.0 — 2026-08-18 — The home shows what is RELEVANT TO YOU: the shared spaces you belong to
 *     and the knowledge packages you made, by name; which mind answers in the chat (your own AI
 *     over MCP when one is connected, the house model otherwise); and an achievements strip
 *     derived from the account's real state — the funnel markers, the counts, the chat status —
 *     with the Experience Center chip as the one self-marking door. home.prefs.hideAchievements
 *     (the settings toggle) hides the strip.
 *   v2.1.0 — 2026-08-18 — Things({usage}): what the person has made (apps, shared spaces, notes,
 *     files), each count a door to its surface, between the agent card and the feed. Reads the
 *     cached /v1/owner/usage summary the profile already uses.
 *   v2.0.0 — 2026-08-18 — The finished home turns from an instruction sheet into a STATUS VIEW
 *     (Jouni, on seeing his own: the strongest content was at the bottom and the screen read as
 *     warnings). Order now: what your agents are doing (AgentCard + feed), open items only while
 *     they are fresh (a week), one clear door to the chat at the top. The four room cards leave
 *     the front page — the person the rooms were for is carried by the chat now — and the
 *     "Your welcome mat is up" tutorial card collapses into one line with the address once the
 *     mat exists. The uninitialised (onboarding) home is untouched.
 *   v1.1.0 — 2026-08-16 — The install suggestion (InstallCta) renders in both states: the browser
 *     never proposes installing on its own, so the home does.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 3).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { Spinner } from '/components/Spinner.js';
import { swallowed } from '/js/swallowed.js';
import { StepMat, StepMatDone } from '/views/home/step-mat.js';
import { StepAgent } from '/views/home/step-agent.js';
import { MailboxRow, FleetLine, ChatDoor, Things, FavoriteApps, Achievements } from '/views/home/status-parts.js';
import { OpenItemsList } from '/components/OpenItemsList.js';
import { StepBranchB } from '/views/home/step-branch-b.js';
import { HomeFeed } from '/views/home/feed.js';
import { HomeHeader } from '/views/home/header.js';
import { HomeSettingsDialog } from '/views/home/settings-dialog.js';
import { InstallCta } from '/components/InstallCta.js';

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
 * The greeting. It no longer carries the name: the name is on the nameplate in the header a line
 * above (views/home/header.js), and printing it twice inside sixty pixels reads as a bug.
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

export default function HomeView({ navigate }) {
  const session = useSession();
  const [state, setState] = useState(null);
  const [feed, setFeed] = useState([]);
  const [usage, setUsage] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [packages, setPackages] = useState([]);
  const [chatStatus, setChatStatus] = useState(null);
  const [mcpNames, setMcpNames] = useState([]);
  const [markers, setMarkers] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [mail, setMail] = useState(null);
  const [favorites, setFavorites] = useState(null);
  const [ownApps, setOwnApps] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);


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
      // The feed is secondary to the steps: if it fails the page still works, but the failure is
      // recorded rather than swallowed, because a feed that silently never loads looks identical
      // to an account where nothing has happened.
      try {
        const f = await apiGet('/v1/home/feed');
        if (f?.data?.items) setFeed(f.data.items);
      } catch (e) {
        swallowed('home: feed', e);
      }
      // The status view's extra reads, all best-effort and all in one round: the page works
      // without any of them, and every failure is recorded rather than swallowed. Only fetched for
      // a FINISHED home — the onboarding steps need none of this.
      if (r.data.state?.initialized) {
        const grab = (path, fn, label) =>
          apiGet(path).then((x) => fn(x?.data)).catch((e) => swallowed('home: ' + label, e));
        await Promise.all([
          grab('/v1/owner/usage', (d) => { if (d) setUsage(d); }, 'usage'),
          grab(`/v1/organisms?member=${encodeURIComponent(r.data.state.owner)}&include=counts`,
            (d) => setOrgs((d?.organisms ?? d?.items ?? []).map((o) => ({
              id: o.id, name: o.name || o.id, workspace_count: o.workspace_count,
              updatedAt: o.updated_at || o.updatedAt,
            }))), 'organisms'),
          grab('/v1/knowledge/tab', (d) => setPackages((d?.packages ?? [])
            .filter((p) => String(p.key || '').endsWith('/manifest'))
            .map((p) => ({ key: p.key, name: p.value?.name || p.value?.title || p.key.split('/')[1], updatedAt: p.updated_at }))), 'knowledge'),
          grab('/v1/chat/status', (d) => { if (d) setChatStatus(d); }, 'chat status'),
          grab('/v1/chat-instances', (d) => setMcpNames([...new Set((d?.chat_instances ?? [])
            .filter((i) => String(i.id || '').startsWith('mcp-'))
            .map((i) => String(i.platform || '').replace(/^mcp-/, '')).filter(Boolean)
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1)))]), 'chat instances'),
          grab('/v1/memory?prefix=onboarding.', (d) => setMarkers(new Set(
            (d?.items ?? d?.entries ?? []).map((m) => m.key))), 'markers'),
          grab('/v1/memory/home.prefs?soft=1', (d) =>
            setPrefs(d?.exists === false ? {} : (d?.value ?? {})), 'prefs'),
          grab('/v1/messages/inbox?per_page=1', (d) => setMail({ unread: d?.unread ?? 0 }), 'mail'),
          grab('/v1/memory/app-catalog.favorites?soft=1', (d) =>
            setFavorites(d?.exists === false ? { refs: [] } : (d?.value ?? { refs: [] })), 'app favorites'),
          grab('/v1/apps?limit=200', (d) => setOwnApps(d?.apps ?? []), 'apps'),
        ]);
      }
    } catch (e) {
      setLoadError(e.message || String(e));
    }
  }, []);

  // home.prefs is ONE record (a record, not a cell): the achievements toggle, the self-marked
  // tries, the stars and the apps-row choice all live in it, written whole on every change.
  const writePrefs = useCallback(async (next) => {
    setPrefs(next);
    await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: 'home.prefs', value: next, visibility: 'private' }) })
      .catch((e) => swallowed('home: prefs write', e));
  }, []);
  const markTried = useCallback((what) =>
    writePrefs({ ...(prefs ?? {}), tried: { ...(prefs?.tried ?? {}), [what]: new Date().toISOString() } }),
  [prefs, writePrefs]);
  const toggleStar = useCallback((id) => {
    const stars = prefs?.stars ?? [];
    return writePrefs({ ...(prefs ?? {}),
      stars: stars.includes(id) ? stars.filter((x) => x !== id) : [...stars, id] });
  }, [prefs, writePrefs]);
  const setAppsMode = useCallback((mode) =>
    writePrefs({ ...(prefs ?? {}), appsRecency: mode }), [prefs, writePrefs]);

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

  // ── The home, once it exists: a status view. What your agents are doing first, the door to the
  // chat above it all, and nothing that tutors a person whose home has been up for weeks. ──
  if (state.initialized) {
    const matUrl = state.mat?.standaloneUrl || state.mat?.url || '';
    return html`
      <div class="koti">
        <${HomeHeader} name=${name} owner=${state.owner} onOpenSettings=${() => setSettingsOpen(true)} />
        <header class="koti-welcome">
          <h1 class="koti-h1">${tr('home.readyTitle', 'Your home is up and running.')}</h1>
          <p class="koti-welcome-sub">
            ${tr('home.readySub', 'Your welcome mat is out and your first agent is home.')}
          </p>
          ${matUrl && html`
            <p class="koti-matline">
              ${tr('home.matCompact', 'Your welcome mat:')}${' '}
              <a href=${matUrl} target="_blank" rel="noopener">${matUrl.replace(/^https?:\/\//, '')}</a>
            </p>`}
        </header>
        <${MailboxRow} mail=${mail} />
        <${ChatDoor} chatStatus=${chatStatus} mcpNames=${mcpNames} />
        <${FleetLine} agent=${state.agent} />
        <${Things} usage=${usage} orgs=${orgs} packages=${packages} prefs=${prefs} onStar=${toggleStar} />
        <${FavoriteApps} apps=${ownApps} favorites=${favorites} owner=${state.owner} prefs=${prefs} onMode=${setAppsMode} />
        <${Achievements} state=${state} usage=${usage} markers=${markers} chatStatus=${chatStatus}
          orgs=${orgs} packages=${packages} prefs=${prefs} onTried=${markTried} />
        <${HomeFeed} items=${feed} />
        <${OpenItemsList} maxAgeDays=${7} />
        <${InstallCta} />
        <${HomeSettingsDialog} open=${settingsOpen} onClose=${() => setSettingsOpen(false)}
          session=${session} showToast=${showToast} />
      </div>`;
  }

  const step = state.step;
  // Branch B inserts a step: get an app that can connect, which pushes the agent to number 3.
  // It is driven by needsBetterApp (live) rather than by branch (write-once, historical), so
  // re-pasting a mat from a capable app collapses this step by itself.
  const onBranchB = state.needsBetterApp || (state.branch === 'B' && !state.mat.done);

  return html`
    <div class="koti">
      <${HomeHeader} name=${name} onOpenSettings=${() => setSettingsOpen(true)} />
      <${Welcome} />

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
      <${InstallCta} />
      <${HomeFeed} items=${feed} />
        <${HomeSettingsDialog} open=${settingsOpen} onClose=${() => setSettingsOpen(false)}
          session=${session} showToast=${showToast} />
      ${toast && html`<div class="koti-toast" role="status">${toast}</div>`}
    </div>`;
}
