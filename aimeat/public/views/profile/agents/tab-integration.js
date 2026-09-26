/**
 * @file tab-integration.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Integration tab for agent detail view. Shows onboarding checklist
 *   during onboarding or production status (readiness, connection, platform, identity,
 *   what came after onboarding, and how to attach the agent elsewhere) after completion.
 * @version-history
 *   v1.24.0 -- 2026-09-26 -- onto the components: the sections are the section Card in a CardGrid (their
 *     head the section title with its date beside it, as the other agent tabs have it), the rows the
 *     Facts, the steps Marks in their Status tones, the hints and empty lines the Note, every way on an
 *     Action or the Loud one (the copies are their `copy`), the webhook address a TextField with its
 *     actions, the delivery log the List with its More line. The file writes no class any more.
 *   v1.23.0 -- 2026-09-26 -- The comment on the quick-connect block says it draws its own look (Jouni's decision "MCP guide", the option classic); no markup changes.
 *   v1.22.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.21.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.20.0 -- 2026-09-25 -- A list of things, one per row, is the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.19.0 -- 2026-09-25 -- Every time a thing happened or runs out is the Timestamp (.poster-time); a place keeps only its layout (a unification: Jouni's decision Timestamp).
 *   v1.18.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger), a unification: Jouni's decision Status.
 *   v1.17.0 -- 2026-09-25 -- The key and value rows are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.16.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.15.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.14.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.13.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.12.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.11.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control
 *     cut where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-14 -- The poster face (agent-integration-poster.css). Readiness leads, and its steps are
 *     chips instead of a pill row plus two name lists that said the same thing; the delivery log moves
 *     inside Connection under its rows; every row is a key/value pair, every action an underlined door
 *     and the prompt for the agent the one slab. The old card and button classes are gone from the
 *     markup; agents-detail.css keeps its rules for the tabs that still wear them.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.10.0 -- 2026-08-27 -- The short way into an MCP connection, on both halves of this tab: above
 *     the onboarding checklist (none of which can be ticked before the agent reaches this node) and
 *     inside the production Connection card (the same agent on a second machine is the same
 *     attachment made again). The server is named after the agent, so a person running several can
 *     tell the entries apart in their own client's list.
 *   v1.9.0 -- 2026-08-09 -- Reads the server's agent state instead of computing one.
 *   v1.8.0 -- 2026-07-17 -- Card scheme generalized: pf-agd-prod-grid renamed to the
 *     shared pf-agd-card-grid; production sections carry pf-agd-card / --full.
 *   v1.9.0 -- 2026-07-16 -- Mount folds webhook + delivery-log + onboarding-checklist into GET
 *     /v1/agents/:name/integration/overview (getIntegrationOverview); skill-bundle version stays a
 *     separate request; individual reads kept as fallback.
 *   v1.8.0 -- 2026-06-30 -- Onboarding checklist step labels use tOr() so a missing
 *     agentOnboarding.steps.* key falls back to the server-provided step.title (which carries
 *     the howTo-enriched onboarding payload) instead of rendering the raw i18n key.
 *   v1.7.0 -- 2026-06-10 -- Webhook fields (URL, fail count, Test/Edit) hidden while delivery
 *     is polling; a "+ Set up webhook" reveal opens the URL form for switching methods.
 *   v1.6.0 -- 2026-06-02 -- Component unification (#1): the 3 copy buttons (agent prompt,
 *     install command, curl) now use the canonical <CopyButton> with precomputed text
 *     payloads -- dropped 3 copied-state useState hooks, 3 hand-rolled handlers, the
 *     copied-flag params threaded through both render functions, and the local
 *     copyToClipboard import.
 *   v1.7.0 -- 2026-07-17 -- Production view: sections become cards in a responsive
 *     two-column grid (pf-agd-prod-grid; Readiness + Delivery log full-width) and the
 *     ambiguous second "Version" row is labelled "Bundle version" (new i18n key).
 *   v1.6.0 -- 2026-07-17 -- Onboarding view: merge the checklist title + readiness score +
 *     duplicate "Progress: N/M  X%" row into ONE canonical section header above the
 *     progress bar (the zone-2 banner already repeats the same progress).
 *   v1.5.0 -- 2026-05-31 -- Live-update refresh no longer toggles the full-tab loading
 *     placeholder (added a showSpinner option). During Hello Integration the agent
 *     posts steps/telemetry rapidly, so the frequent SSE ticks were re-rendering the
 *     "Loading..." state on every tick -- the tab flashed like a full reload.
 *   v1.4.0 -- 2026-05-28 -- Treat webhook with empty url as polling: status dot, label, and
 *                            the webhook section all key off (webhook && webhook.url), not just
 *                            the webhook object existing. A record with url="" is still polling.
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 *   v1.1.0 -- 2026-05-24 -- Fix 9 UI audit findings: pending icon, readiness score, webhook edit,
 *     strengths/gaps, last validated, roles badge, platform version, bundle update, copy install cmd
 *   v1.3.0 -- 2026-05-24 -- Audit fix: always show delivery log section, add warn icon for step pills
 *   v1.2.0 -- 2026-05-24 -- Add delivery status indicator dot, show polling fallback interval
 *   v1.10.0 -- 2026-08-08 -- Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t, tOr } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { McpQuickConnect } from '/components/McpInstall.js';
import { Card, CardGrid } from '/components/Card.js';
import { Facts } from '/components/Facts.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Who, When, Cell, More } from '/components/List.js';
import { TextField } from '/components/TextField.js';
import { Space } from '/components/Layout.js';
import { agentState } from './state-detector.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';
import {
  getOnboarding, startOnboarding, getIntegrationOverview,
  getWebhookConfig, testWebhook, updateWebhook,
  getSkillBundleVersion, getSkillBundleUrl, updateSkillBundle,
  getDeliveryLog
} from '/js/services/agent-integration.js';

const html = htm.bind(h);

/** The mark in front of a step's name. Only the glyphs the interface is allowed to print. */
const STEP_MARK = { passed: '✓', failed: '✗', warn: '✗' };
/** The Status an onboarding step wears: passed is fine, failed is danger, a warning needs a look,
 *  a step not taken yet is off (the same tones as agent-card-badges.js stepStatusClass). */
const STEP_TONE = { passed: 'fine', failed: 'danger', warn: 'attention' };

export default function TabIntegration({ agent, onboarding, showToast, agentName }) {
  const state = agentState(agent);
  const [webhook, setWebhook] = useState(null);
  const [bundleVersion, setBundleVersion] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [postChecklist, setPostChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [showAllDeliveries, setShowAllDeliveries] = useState(false);
  const [allDeliveries, setAllDeliveries] = useState(null);
  const [editingWebhook, setEditingWebhook] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [updatingBundle, setUpdatingBundle] = useState(false);

  const loadData = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      // Mount fold: ONE composite (webhook + delivery log + onboarding checklist) plus the skill-bundle
      // version, which stays separate (bundle-generation pipeline, not a read). On composite failure, fall
      // back to the individual reads. Each composite sub-object mirrors the matching endpoint's `.data`.
      const [ov, sbResp] = await Promise.all([
        getIntegrationOverview(agentName),
        getSkillBundleVersion(agentName).catch(err => { swallowed('tab-integration: TabIntegration', err); return null; }),
      ]);
      setBundleVersion(sbResp?.data || null);
      if (ov) {
        setWebhook(ov.webhook || null);
        setDeliveries(ov.deliveries?.deliveries || []);
        setPostChecklist(ov.onboarding?.post_onboarding_checklist || null);
      } else {
        const [whResp, dlResp, obResp] = await Promise.all([
          getWebhookConfig(agentName).catch(err => { swallowed('tab-integration: TabIntegration', err); return null; }),
          getDeliveryLog(agentName, 10).catch(err => { swallowed('tab-integration: TabIntegration', err); return null; }),
          getOnboarding(agentName).catch(err => { swallowed('tab-integration: TabIntegration', err); return null; }),
        ]);
        setWebhook(whResp?.data || null);
        setDeliveries(dlResp?.data?.deliveries || []);
        setPostChecklist(obResp?.data?.post_onboarding_checklist || null);
      }
    } catch (err) { swallowed('tab-integration: TabIntegration', err); }
    if (showSpinner) setLoading(false);
  }, [agentName]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    // Background refresh on every live-update WITHOUT toggling the full-tab
    // "Loading..." placeholder. During Hello Integration the agent posts steps
    // + telemetry rapidly, so this fires often; showing the spinner each time
    // made the whole tab flash like a reload. Initial mount still shows it.
    return onLiveUpdate(['agents', 'agent-onboarding'], () => loadRef.current({ showSpinner: false }));
  }, []);

  async function handleTestWebhook(e) {
    e.stopPropagation();
    setTesting(true);
    try {
      const resp = await testWebhook(agentName);
      if (resp?.data?.success) {
        showToast(t('profile.agents.webhook.testSuccess'));
      } else {
        showToast(t('profile.agents.webhook.testFailed'), true);
      }
      loadData();
    } catch (err) {
      swallowed('tab-integration: handleTestWebhook', err);
      showToast(t('profile.agents.webhook.testFailed'), true);
    }
    setTesting(false);
  }

  async function handleRerun(e) {
    e.stopPropagation();
    setRerunning(true);
    try {
      await startOnboarding(agentName);
      showToast(t('profile.agents.detail.integration.rerunStarted'));
      loadData();
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.integration.startError'), true);
    }
    setRerunning(false);
  }

  // Copy payloads (the Action's and the Loud's `copy` own the copy + copied-state).
  const skillBundleUrl = `${location.origin}${getSkillBundleUrl(agentName)}`;
  const curlText = `curl -o skill-bundle.zip ${skillBundleUrl}`;
  const installPlatform = onboarding?.platformName || onboarding?.detectedPlatform || '';
  const installCmdText = (installPlatform.toLowerCase().includes('hermes') || installPlatform.toLowerCase().includes('openclaw'))
    ? `hermes skills install ${skillBundleUrl}`
    : `curl -o skill-bundle.zip ${skillBundleUrl} && unzip skill-bundle.zip`;
  const agentPromptText = `Download and install your skill bundle from AIMEAT.

Your skill bundle URL: ${skillBundleUrl}

Steps:
1. Authenticate with your agent token: POST ${location.origin}/v1/auth/token
   Sign the challenge with your private key to get a JWT.

2. Download the skill bundle ZIP:
   GET ${skillBundleUrl}
   Header: Authorization: Bearer <your-jwt>
   Save the response as a ZIP file.

3. Extract the ZIP. It contains:
   - SKILL.md -- your operating instructions, directives, and API reference
   - Reference documents for task lifecycle, messaging, telemetry protocols
   - Platform-specific scripts (if applicable)

4. Read SKILL.md first -- it has your personalized directives, rules, and all the API endpoints you need.

If you already have a JWT token, you can do this in one step:
curl -H "Authorization: Bearer <jwt>" -o skill-bundle.zip "${skillBundleUrl}" && unzip skill-bundle.zip && cat */SKILL.md`;

  function handleEditWebhook(e) {
    e.stopPropagation();
    setWebhookDraft(webhook?.url || agent.webhook_url || '');
    setEditingWebhook(true);
  }

  async function handleSaveWebhook(e) {
    e.stopPropagation();
    setSavingWebhook(true);
    try {
      await updateWebhook(agentName, { url: webhookDraft });
      showToast(t('profile.agents.detail.integration.webhookUpdated'));
      setEditingWebhook(false);
      loadData();
    } catch (err) {
      swallowed('tab-integration: handleSaveWebhook', err);
      showToast(t('profile.agents.detail.integration.webhookUpdateError'), true);
    }
    setSavingWebhook(false);
  }

  function handleCancelWebhook(e) {
    e.stopPropagation();
    setEditingWebhook(false);
  }

  async function handleUpdateBundle(e) {
    e.stopPropagation();
    setUpdatingBundle(true);
    try {
      await updateSkillBundle(agentName);
      showToast(t('profile.agents.detail.integration.update'));
      loadData();
    } catch (err) { swallowed('tab-integration: handleUpdateBundle', err); }
    setUpdatingBundle(false);
  }

  if (loading) {
    return html`<${Note} kind="loading">${t('profile.loading')}<//>`;
  }

  // System agents (Secretary / company Secretary / specialists) are auto-provisioned and never run the
  // device-auth "Hello Integration" onboarding — show a short note instead of the 0/11 checklist.
  if (state === 'system') {
    return html`<${Note} kind="quiet">${t('profile.agents.detail.internalAgentNote')}<//>`;
  }

  const isOnboarding = state === 'new' || state === 'onboarding';

  if (isOnboarding) {
    return renderOnboardingView({ onboarding, agentName, handleRerun, rerunning, curlText, installCmdText, agentPromptText });
  }

  async function handleShowAll() {
    if (showAllDeliveries) { setShowAllDeliveries(false); return; }
    try {
      const resp = await getDeliveryLog(agentName, 200);
      setAllDeliveries(resp?.data?.deliveries || []);
    } catch (err) { swallowed('tab-integration: handleShowAll', err); }
    setShowAllDeliveries(true);
  }

  const displayDeliveries = showAllDeliveries && allDeliveries ? allDeliveries : deliveries;

  return renderProductionView({
    agent, onboarding, webhook, bundleVersion, displayDeliveries, postChecklist,
    handleTestWebhook, testing, handleRerun, rerunning, handleShowAll, showAllDeliveries,
    editingWebhook, webhookDraft, setWebhookDraft, handleEditWebhook, handleSaveWebhook,
    handleCancelWebhook, savingWebhook, handleUpdateBundle, updatingBundle,
    curlText, installCmdText, agentPromptText,
  });
}

/* ── The pieces every section is built from ────────────────────────────────────────────────── */

/**
 * One row of the Facts (components/Facts.js). A value nobody has reported is the missing value
 * (grey); a machine string is an identifier (code).
 */
function kv(key, value, { dim = false, mono = false } = {}) {
  return { k: key, v: value, missing: dim, mono };
}

/** Every step of Hello Integration as a Status: its tone carries the result. */
function stepChips(steps) {
  if (!steps.length) return null;
  return html`
    <${Space} below="medium"><${Marks}>
      ${steps.map(s => html`
        <${Mark} key=${s.id} kind="status" tone=${STEP_TONE[s.status] || 'off'}>
          ${STEP_MARK[s.status] || '·'} ${tOr('agentOnboarding.steps.' + s.id, s.name || s.title || s.id)}
        <//>`)}
    <//><//>`;
}

/**
 * The bundle actions, in one row: the prompt is the loud one, the rest are doors.
 * Before the first install the middle door says what it does ("Copy install command"); after it,
 * the same payload is the way to install the bundle again.
 */
/**
 * @param {{ agentName: string, curlText: string, installCmdText: string, agentPromptText: string,
 *   handleUpdateBundle?: () => void, updatingBundle?: boolean, installLabel?: string }} props
 */
function bundleDoors({ agentName, curlText, installCmdText, agentPromptText, handleUpdateBundle, updatingBundle, installLabel }) {
  return html`
    <${Actions} under>
      <${Loud} copy=${agentPromptText}
        copiedLabel=${'✓ ' + t('profile.agents.detail.integration.promptCopied')}>
        ${t('profile.agents.detail.integration.copyAgentPrompt')}
      <//>
      <${Action} small copy=${installCmdText}
        copiedLabel=${'✓ ' + t('profile.agents.detail.integration.installCommandCopied')}>
        ${installLabel || t('profile.agents.skillBundle.reinstall')}
      <//>
      ${handleUpdateBundle ? html`
        <${Action} small onClick=${handleUpdateBundle} disabled=${updatingBundle}>
          ${updatingBundle ? '...' : t('profile.agents.detail.integration.update')}
        <//>` : null}
      <${Action} small href=${getSkillBundleUrl(agentName)} download>
        ${t('profile.agents.skillBundle.downloadZip')}
      <//>
      <${Action} small copy=${curlText}>${t('profile.agents.skillBundle.copyCurl')}<//>
    <//>`;
}

/** The webhook address while it is being typed. Same handlers as before. */
function webhookForm({ webhookDraft, setWebhookDraft, handleSaveWebhook, handleCancelWebhook, savingWebhook }) {
  return html`
    <${Space} above="large">
      <${TextField} type="url" value=${webhookDraft} onInput=${setWebhookDraft} placeholder="https://..."
        ariaLabel=${t('profile.agents.webhook.url')}
        actions=${html`
          <${Action} small onClick=${handleSaveWebhook} disabled=${savingWebhook}>
            ${savingWebhook ? '...' : t('common.save')}
          <//>
          <${Action} small soft onClick=${handleCancelWebhook}>${t('common.cancel')}<//>`} />
    <//>`;
}

/* ── The sections themselves ───────────────────────────────────────────────────────────────── */

/** How far the agent got through Hello Integration, and the door that runs it again. */
function readinessSection({ steps, onboarding, handleRerun, rerunning }) {
  const level = onboarding?.readinessLevel;
  const score = onboarding?.readinessScore;
  const scored = score != null ? ` (${score})` : '';
  const label = level
    ? `${t('profile.agents.detail.readiness')} · ${level}${scored}`
    : t('profile.agents.detail.readiness');

  const lastValidatedTs = steps.reduce((latest, s) => {
    if (!s.validatedAt) return latest;
    const d = new Date(s.validatedAt).getTime();
    return d > latest ? d : latest;
  }, 0);
  const aside = lastValidatedTs > 0
    ? `${t('profile.agents.detail.integration.lastValidated')} ${timeAgo(lastValidatedTs)}`
    : '';

  const hasGaps = steps.some(s => s.status !== 'passed') || steps.length === 0;
  const hint = hasGaps
    ? tOr('profile.agents.detail.integration.readinessHintGaps',
      'Some steps have not passed yet. Run Hello Integration again once the agent can complete them.')
    : tOr('profile.agents.detail.integration.readinessHintFull',
      'Every step of Hello Integration passed, and nothing is missing. Run it again after the agent code or its platform changes.');

  return html`
    <${Card} tone="section" wide title=${label} aside=${aside ? html`<${Mark} kind="time">${aside}<//>` : null}>
      ${stepChips(steps)}
      <${Note}>${hint}<//>
      <${Actions} under>
        <${Action} small onClick=${handleRerun} disabled=${rerunning}>
          ${rerunning ? '...' : t('profile.agents.detail.integration.rerun')}
        <//>
      <//>
    <//>`;
}

/** How work reaches the agent, and what has been delivered over that road. */
function connectionSection(p) {
  const { agent, webhook, displayDeliveries } = p;
  const hasWebhook = !!(webhook && webhook.url);
  const interval = agent.pollingInterval || agent.polling_interval || '60s';
  const delivery = hasWebhook
    ? t('profile.agents.detail.deliveryWebhook')
    : tOr('profile.agents.detail.integration.pollingEvery', 'Polling, every {interval}').replace('{interval}', interval);

  const webhookValue = hasWebhook ? webhook.url : html`
    ${t('profile.agents.detail.integration.webhookNotConfigured')} ·${' '}
    <${Action} small soft onClick=${p.handleEditWebhook}>
      ${t('profile.agents.detail.integration.setupWebhook')}
    <//>`;

  return html`
    <${Card} tone="section" title=${t('profile.agents.detail.connection')}>
      <${Facts} rows=${[
        kv(t('profile.agents.detail.integration.deliveryMethod'), delivery),
        kv(t('profile.agents.webhook.url'), webhookValue, { dim: !hasWebhook }),
        hasWebhook && kv(t('profile.agents.webhook.failCount'), webhook.failCount ?? 0),
        hasWebhook && kv(t('profile.agents.webhook.lastSuccess'), webhook.lastSuccessAt ? timeAgo(webhook.lastSuccessAt) : '--'),
        kv(t('profile.agents.detail.lastSeen'), agent.last_seen ? timeAgo(agent.last_seen) : '--'),
        kv(
          tOr('profile.agents.detail.integration.deliveries', 'Deliveries'),
          displayDeliveries.length || t('profile.agents.detail.integration.noDeliveries'),
          { dim: displayDeliveries.length === 0 },
        ),
      ]} />
      ${p.editingWebhook ? webhookForm(p) : (hasWebhook ? html`
        <${Actions} under>
          <${Action} small onClick=${p.handleTestWebhook} disabled=${p.testing}>
            ${p.testing ? '...' : t('profile.agents.webhook.test')}
          <//>
          <${Action} small soft onClick=${p.handleEditWebhook}>
            ${t('profile.agents.detail.integration.editWebhook')}
          <//>
        <//>` : null)}
      ${deliveryLog(p)}
    <//>`;
}

/** The delivery log, under the connection rows. The door lengthens the list, as it always did. */
function deliveryLog({ displayDeliveries, handleShowAll, showAllDeliveries }) {
  if (!displayDeliveries.length) return null;
  return html`
    <${List} cols="when-name-who-state-n" apart head=${[
      t('profile.agents.detail.integration.time'),
      t('profile.agents.detail.integration.event'),
      t('profile.agents.detail.integration.channel'),
      t('profile.agents.detail.integration.result'),
      t('profile.agents.detail.integration.latency'),
    ]}>
      ${displayDeliveries.map((d, i) => html`
        <${Row} key=${d.id || i}>
          <${When}>${d.timestamp ? timeAgo(d.timestamp) : '--'}<//>
          <${Name}>${d.eventType || d.event || '--'}<//>
          <${Who}>${d.channel || '--'}<//>
          <${Cell}><${Mark} kind="status" tone=${d.success ? 'fine' : 'danger'}>${d.success ? '✓' : '✗'}<//><//>
          <${Who}>${d.latencyMs ? `${(d.latencyMs / 1000).toFixed(1)}s` : '--'}<//>
        <//>`)}
    <//>
    <${More} onMore=${handleShowAll}
      label=${showAllDeliveries ? t('profile.agents.detail.showLess') : t('profile.agents.detail.showAll')} />`;
}

/** What the agent runs on, and the bundle it was given. */
function bundleSection(p) {
  const { agent, onboarding, bundleVersion } = p;
  const platformName = onboarding?.platformName || onboarding?.detectedPlatform || '';
  const detection = onboarding?.detectedPlatform
    ? t('profile.agents.detail.integration.autoDetected')
    : t('profile.agents.detail.integration.manual');
  const platformVersion = onboarding?.platform?.version || onboarding?.platformVersion || null;
  const notReported = tOr('profile.agents.detail.integration.notReported', 'Not reported');

  return html`
    <${Card} tone="section" title=${tOr('profile.agents.detail.integration.platformAndBundle', 'Platform and skill bundle')}>
      <${Facts} rows=${[
        kv(
          t('profile.agents.detail.platform'),
          platformName ? `${platformName} · ${detection}` : notReported,
          { dim: !platformName },
        ),
        kv(t('profile.agents.detail.integration.platformVersion'), platformVersion || notReported, { dim: !platformVersion }),
        kv(
          t('profile.agents.skillBundle.bundleVersionLabel'),
          bundleVersion?.version || notReported,
          { dim: !bundleVersion?.version, mono: !!bundleVersion?.version },
        ),
      ]} />
      ${bundleDoors({ ...p, agentName: agent.name })}
    <//>`;
}

/** Who the agent is, in the words the node uses about it everywhere else. */
function identitySection(agent) {
  return html`
    <${Card} tone="section" title=${t('profile.agents.detail.identity')}>
      <${Facts} rows=${[
        kv('GAII', agent.gaii || '--', { mono: !!agent.gaii, dim: !agent.gaii }),
        agent.public_key && kv(t('profile.agents.publicKey'), truncateKey(agent.public_key), { mono: true }),
        kv(t('profile.agents.created'), agent.created_at ? fmtDate(agent.created_at) : '--'),
        agent.roles?.length && kv(
          t('profile.agents.detail.integration.roles'),
          html`<${Marks}>${agent.roles.map(r => html`<${Mark} key=${r}>${r}<//>`)}<//>`,
        ),
      ]} />
    <//>`;
}

/** The four things an agent does for itself once Hello Integration is behind it. */
function afterOnboardingSection(pc) {
  const yes = (key, fallback) => tOr(`profile.agents.detail.integration.${key}`, fallback);
  const tagsUnknown = pc.shared_tags_in_use === null;
  return html`
    <${Card} tone="section" title=${t('profile.agents.detail.integration.postOnboardingSetup')}>
      <${Facts} rows=${[
        kv(
          t('profile.agents.detail.integration.commandsRegistered'),
          pc.commands_registered ? yes('valueRegistered', 'Registered') : yes('valueNoneRegistered', 'None registered'),
          { dim: !pc.commands_registered },
        ),
        kv(
          t('profile.agents.detail.integration.configPublished'),
          pc.config_published ? yes('valuePublished', 'Published') : yes('valueNotPublished', 'Not published'),
          { dim: !pc.config_published },
        ),
        kv(
          t('profile.agents.detail.integration.sharedTagsInUse'),
          tagsUnknown
            ? t('profile.agents.detail.integration.notApplicable')
            : (pc.shared_tags_in_use ? yes('valueInUse', 'In use') : yes('valueNotInUse', 'Not in use')),
          { dim: tagsUnknown || !pc.shared_tags_in_use },
        ),
        kv(
          t('profile.agents.detail.integration.knowledgePackages'),
          pc.knowledge_packages_published ? yes('valuePublished', 'Published') : yes('valueNoPackages', 'No packages'),
          { dim: !pc.knowledge_packages_published },
        ),
      ]} />
    <//>`;
}

/**
 * The same agent in a second tool, or on a second machine, is this attachment made again.
 * McpQuickConnect owns the markup and its look (css/components/mcp-install.css).
 */
function attachSection(serverName, label, lead) {
  return html`
    <${Card} tone="section" wide title=${label}>
      ${lead ? html`<${Space} below="medium"><${Note}>${lead}<//><//>` : null}
      <${McpQuickConnect} serverName=${serverName} />
    <//>`;
}

/* ── The two views ─────────────────────────────────────────────────────────────────────────── */

function renderOnboardingView({ onboarding, agentName, handleRerun, rerunning, curlText, installCmdText, agentPromptText }) {
  const steps = onboarding?.steps || [];
  const passed = steps.filter(s => s.status === 'passed').length;
  const total = steps.length || 11;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const platformName = onboarding?.platformName || onboarding?.detectedPlatform || '';
  const notReported = tOr('profile.agents.detail.integration.notReported', 'Not reported');
  const bundleUrl = `${location.origin}${getSkillBundleUrl(agentName)}`;

  return html`
    <${CardGrid} cols="sections">
      <!-- Before the checklist, because none of it can be ticked from a browser: the agent has to
           reach this node from the tool it runs in first. The server is named after the agent, so
           a person running several of them can tell the entries apart in their own client. -->
      ${attachSection(
        agentName,
        tOr('mcpInstall.agentTitle', 'Attach this agent to the tool it runs in'),
        tOr('mcpInstall.agentLead', 'The steps below are things the agent does over that connection, so it comes first.'),
      )}

      <${Card} tone="section" wide
        title=${`${t('profile.agents.detail.integration.checklistTitle')} · ${passed}/${total}`}
        aside=${html`<${Note} kind="meta" inline>${t('profile.agents.detail.integration.readinessScore')} ${pct}/100<//>`}>
        ${stepChips(steps)}
        <${Note}>
          ${passed > 0
            ? tOr('profile.agents.detail.integration.readinessHintGaps',
              'Some steps have not passed yet. Run Hello Integration again once the agent can complete them.')
            : tOr('profile.agents.detail.integration.onboardingHint',
              'Nothing is ticked yet. The agent does these steps itself, over the connection above, once it can reach this node.')}
        <//>
        <${Actions} under>
          <${Action} small onClick=${handleRerun} disabled=${rerunning}>
            ${rerunning ? '...' : (passed > 0
              ? t('profile.agents.detail.integration.rerun')
              : t('profile.agents.detail.integration.startOnboarding'))}
          <//>
        <//>
      <//>

      <${Card} tone="section" wide title=${t('profile.agents.skillBundle.title')}>
        <${Facts} rows=${[
          kv(t('profile.agents.detail.platform'), platformName || notReported, { dim: !platformName }),
          kv(tOr('profile.agents.detail.integration.bundleAddress', 'Bundle address'), bundleUrl, { mono: true }),
        ]} />
        ${bundleDoors({
          agentName, curlText, installCmdText, agentPromptText,
          installLabel: t('profile.agents.detail.integration.copyInstallCommand'),
        })}
      <//>
    <//>`;
}

function renderProductionView(p) {
  const steps = p.onboarding?.steps || [];

  return html`
    <${CardGrid} cols="sections">
      ${readinessSection({ steps, onboarding: p.onboarding, handleRerun: p.handleRerun, rerunning: p.rerunning })}
      ${connectionSection(p)}
      ${bundleSection(p)}
      ${identitySection(p.agent)}
      ${p.postChecklist ? afterOnboardingSection(p.postChecklist) : null}
      ${attachSection(
        p.agent.name,
        tOr('profile.agents.detail.integration.attachTitle', 'Attach this agent in another tool, or on another machine'),
      )}
    <//>`;
}

function truncateKey(key) {
  if (!key) return '--';
  if (key.length <= 20) return key;
  return key.slice(0, 10) + '...' + key.slice(-10);
}
