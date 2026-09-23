/**
 * @file tab-integration.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Integration tab for agent detail view. Shows onboarding checklist
 *   during onboarding or production status (readiness, connection, platform, identity,
 *   what came after onboarding, and how to attach the agent elsewhere) after completion.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: sections are the small Section, the Hello
 *     Integration steps a checklist, rows key/value pairs, the delivery log the shared table, the
 *     buttons Actions and copies CopyActions. No class of its own is left, so
 *     agent-integration-poster.css is no longer read by this file. Same words, data and handlers.
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
import {
  Section, Columns, Stack, KeyValue, Table, Field, Action, CopyAction, CheckItem, Chip, Text,
} from '/components/poster-parts.js';
import { McpQuickConnect } from '/components/McpInstall.js';
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

  // Copy-button payloads (the canonical <CopyButton> owns the copy + copied-state).
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
    return html`<${Text} tone="muted">${t('profile.loading')}<//>`;
  }

  // System agents (Secretary / company Secretary / specialists) are auto-provisioned and never run the
  // device-auth "Hello Integration" onboarding — show a short note instead of the 0/11 checklist.
  if (state === 'system') {
    return html`<${Text} tone="muted">${t('profile.agents.detail.internalAgentNote')}<//>`;
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

/** A value that is absent or not yet reached reads quieter than one that is there. */
function dimmed(value, dim) {
  return dim ? html`<${Text} kind="caption" tone="muted">${value}<//>` : value;
}

/**
 * Every step of Hello Integration as a checklist item: ticked when it passed. A failed or warned
 * step keeps its ✗ in the words, as the chip did; a step not reached yet is the dashed square.
 */
function stepChecks(steps) {
  if (!steps.length) return '';
  return html`
    <${Stack} direction="wrap" density="compact">
      ${steps.map(s => html`
        <${CheckItem} key=${s.id} done=${s.status === 'passed'}>
          ${STEP_MARK[s.status] && s.status !== 'passed' ? STEP_MARK[s.status] + ' ' : ''}${tOr('agentOnboarding.steps.' + s.id, s.name || s.title || s.id)}
        <//>`)}
    <//>`;
}

/**
 * The bundle actions, in one row: the prompt is the loud one, the rest are underlined words.
 * Before the first install the middle one says what it does ("Copy install command"); after it,
 * the same payload is the way to install the bundle again.
 * @param {{ agentName: string, curlText: string, installCmdText: string, agentPromptText: string,
 *   handleUpdateBundle?: () => void, updatingBundle?: boolean, installLabel?: string }} props
 */
function bundleDoors({ agentName, curlText, installCmdText, agentPromptText, handleUpdateBundle, updatingBundle, installLabel }) {
  return html`
    <${Stack} direction="wrap" align="center">
      <${CopyAction} kind="primary" text=${agentPromptText}
        label=${t('profile.agents.detail.integration.copyAgentPrompt')}
        copiedLabel=${'✓ ' + t('profile.agents.detail.integration.promptCopied')} />
      <${CopyAction} text=${installCmdText}
        label=${installLabel || t('profile.agents.skillBundle.reinstall')}
        copiedLabel=${'✓ ' + t('profile.agents.detail.integration.installCommandCopied')} />
      ${handleUpdateBundle ? html`
        <${Action} onClick=${handleUpdateBundle} disabled=${updatingBundle}>
          ${updatingBundle ? '...' : t('profile.agents.detail.integration.update')}
        <//>` : ''}
      <${Action} href=${getSkillBundleUrl(agentName)} download=${true}>
        ${t('profile.agents.skillBundle.downloadZip')}
      <//>
      <${CopyAction} text=${curlText} label=${t('profile.agents.skillBundle.copyCurl')} />
    <//>`;
}

/** The webhook address while it is being typed. Same handlers as before. */
function webhookForm({ webhookDraft, setWebhookDraft, handleSaveWebhook, handleCancelWebhook, savingWebhook }) {
  return html`
    <${Stack} density="compact">
      <${Field} type="url" value=${webhookDraft}
        onInput=${e => setWebhookDraft(e.target.value)} placeholder="https://..." />
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${handleSaveWebhook} disabled=${savingWebhook}>
          ${savingWebhook ? '...' : t('common.save')}
        <//>
        <${Action} kind="text" onClick=${handleCancelWebhook}>${t('common.cancel')}<//>
      <//>
    <//>`;
}

/* ── The sections themselves ───────────────────────────────────────────────────────────────── */

/** How far the agent got through Hello Integration, and the action that runs it again. */
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
    <${Section} size="small" density="compact" title=${label} count=${aside || undefined}>
      <${Stack} density="compact">
        ${stepChecks(steps)}
        <${Text} tone="muted">${hint}<//>
        <${Stack} direction="wrap">
          <${Action} onClick=${handleRerun} disabled=${rerunning}>
            ${rerunning ? '...' : t('profile.agents.detail.integration.rerun')}
          <//>
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
    <${Stack} direction="wrap" align="center" density="compact">
      ${dimmed(t('profile.agents.detail.integration.webhookNotConfigured'), true)}
      <${Action} kind="text" onClick=${p.handleEditWebhook}>
        ${t('profile.agents.detail.integration.setupWebhook')}
      <//>
    <//>`;

  return html`
    <${Section} size="small" density="compact" title=${t('profile.agents.detail.connection')}>
      <${Stack} density="compact">
        <div>
          <${KeyValue} label=${t('profile.agents.detail.integration.deliveryMethod')} value=${delivery} />
          <${KeyValue} label=${t('profile.agents.webhook.url')} value=${webhookValue} mono=${hasWebhook} />
          ${hasWebhook ? html`<${KeyValue} label=${t('profile.agents.webhook.failCount')} value=${webhook.failCount ?? 0} />` : ''}
          ${hasWebhook ? html`<${KeyValue} label=${t('profile.agents.webhook.lastSuccess')}
            value=${webhook.lastSuccessAt ? timeAgo(webhook.lastSuccessAt) : '--'} />` : ''}
          <${KeyValue} label=${t('profile.agents.detail.lastSeen')} value=${agent.last_seen ? timeAgo(agent.last_seen) : '--'} />
          <${KeyValue} label=${tOr('profile.agents.detail.integration.deliveries', 'Deliveries')}
            value=${dimmed(displayDeliveries.length || t('profile.agents.detail.integration.noDeliveries'), displayDeliveries.length === 0)} />
        </div>
        ${p.editingWebhook ? webhookForm(p) : (hasWebhook ? html`
          <${Stack} direction="wrap" align="center">
            <${Action} onClick=${p.handleTestWebhook} disabled=${p.testing}>
              ${p.testing ? '...' : t('profile.agents.webhook.test')}
            <//>
            <${Action} kind="text" onClick=${p.handleEditWebhook}>
              ${t('profile.agents.detail.integration.editWebhook')}
            <//>
          <//>` : '')}
        ${deliveryLog(p)}
      <//>
    <//>`;
}

/** The delivery log, under the connection rows. The action lengthens the list, as it always did. */
function deliveryLog({ displayDeliveries, handleShowAll, showAllDeliveries }) {
  if (!displayDeliveries.length) return '';
  const headers = [
    t('profile.agents.detail.integration.time'),
    t('profile.agents.detail.integration.event'),
    t('profile.agents.detail.integration.channel'),
    t('profile.agents.detail.integration.result'),
    t('profile.agents.detail.integration.latency'),
  ];
  const rows = displayDeliveries.map(d => [
    d.timestamp ? timeAgo(d.timestamp) : '--',
    d.eventType || d.event || '--',
    d.channel || '--',
    html`<${Text} kind="mono" tone=${d.success ? 'success' : 'danger'}>${d.success ? '✓' : '✗'}<//>`,
    d.latencyMs ? `${(d.latencyMs / 1000).toFixed(1)}s` : '--',
  ]);
  return html`
    <${Stack} density="compact">
      <${Table} headers=${headers} rows=${rows} density="compact"
        label=${tOr('profile.agents.detail.integration.deliveries', 'Deliveries')} />
      <${Stack} direction="wrap">
        <${Action} kind="text" onClick=${handleShowAll}>
          ${showAllDeliveries ? t('profile.agents.detail.showLess') : t('profile.agents.detail.showAll')}
        <//>
      <//>
    <//>`;
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
    <${Section} size="small" density="compact" title=${tOr('profile.agents.detail.integration.platformAndBundle', 'Platform and skill bundle')}>
      <${Stack} density="compact">
        <div>
          <${KeyValue} label=${t('profile.agents.detail.platform')}
            value=${dimmed(platformName ? `${platformName} · ${detection}` : notReported, !platformName)} />
          <${KeyValue} label=${t('profile.agents.detail.integration.platformVersion')}
            value=${dimmed(platformVersion || notReported, !platformVersion)} />
          <${KeyValue} label=${t('profile.agents.skillBundle.bundleVersionLabel')}
            value=${dimmed(bundleVersion?.version || notReported, !bundleVersion?.version)} mono=${!!bundleVersion?.version} />
        </div>
        ${bundleDoors({ ...p, agentName: agent.name })}
      <//>
    <//>`;
}

/** Who the agent is, in the words the node uses about it everywhere else. */
function identitySection(agent) {
  return html`
    <${Section} size="small" density="compact" title=${t('profile.agents.detail.identity')}>
      <div>
        <${KeyValue} label="GAII" value=${dimmed(agent.gaii || '--', !agent.gaii)} mono=${!!agent.gaii} />
        ${agent.public_key ? html`<${KeyValue} label=${t('profile.agents.publicKey')} value=${truncateKey(agent.public_key)} mono=${true} />` : ''}
        <${KeyValue} label=${t('profile.agents.created')} value=${agent.created_at ? fmtDate(agent.created_at) : '--'} />
        ${agent.roles?.length ? html`<${KeyValue} label=${t('profile.agents.detail.integration.roles')}
          value=${html`<${Stack} direction="wrap" density="compact">${agent.roles.map(r => html`<${Chip} key=${r}>${r}<//>`)}<//>`} />` : ''}
      </div>
    <//>`;
}

/** The four things an agent does for itself once Hello Integration is behind it. */
function afterOnboardingSection(pc) {
  const yes = (key, fallback) => tOr(`profile.agents.detail.integration.${key}`, fallback);
  const tagsUnknown = pc.shared_tags_in_use === null;
  return html`
    <${Section} size="small" density="compact" title=${t('profile.agents.detail.integration.postOnboardingSetup')}>
      <div>
        <${KeyValue} label=${t('profile.agents.detail.integration.commandsRegistered')}
          value=${dimmed(pc.commands_registered ? yes('valueRegistered', 'Registered') : yes('valueNoneRegistered', 'None registered'), !pc.commands_registered)} />
        <${KeyValue} label=${t('profile.agents.detail.integration.configPublished')}
          value=${dimmed(pc.config_published ? yes('valuePublished', 'Published') : yes('valueNotPublished', 'Not published'), !pc.config_published)} />
        <${KeyValue} label=${t('profile.agents.detail.integration.sharedTagsInUse')}
          value=${dimmed(tagsUnknown
            ? t('profile.agents.detail.integration.notApplicable')
            : (pc.shared_tags_in_use ? yes('valueInUse', 'In use') : yes('valueNotInUse', 'Not in use')), tagsUnknown || !pc.shared_tags_in_use)} />
        <${KeyValue} label=${t('profile.agents.detail.integration.knowledgePackages')}
          value=${dimmed(pc.knowledge_packages_published ? yes('valuePublished', 'Published') : yes('valueNoPackages', 'No packages'), !pc.knowledge_packages_published)} />
      </div>
    <//>`;
}

/**
 * The same agent in a second tool, or on a second machine, is this attachment made again.
 * McpQuickConnect is itself composed from the shared set.
 */
function attachSection(serverName, label, lead) {
  return html`
    <${Section} size="small" density="compact" title=${label} description=${lead || undefined}>
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

  // The attachment comes before the checklist, because none of it can be ticked from a browser: the
  // agent has to reach this node from the tool it runs in first. The server is named after the agent,
  // so a person running several of them can tell the entries apart in their own client.
  return html`
    <${Stack}>
      ${attachSection(
        agentName,
        tOr('mcpInstall.agentTitle', 'Attach this agent to the tool it runs in'),
        tOr('mcpInstall.agentLead', 'The steps below are things the agent does over that connection, so it comes first.'),
      )}

      <${Section} size="small" density="compact"
        title=${`${t('profile.agents.detail.integration.checklistTitle')} · ${passed}/${total}`}
        count=${`${t('profile.agents.detail.integration.readinessScore')} ${pct}/100`}>
        <${Stack} density="compact">
          ${stepChecks(steps)}
          <${Text} tone="muted">
            ${passed > 0
              ? tOr('profile.agents.detail.integration.readinessHintGaps',
                'Some steps have not passed yet. Run Hello Integration again once the agent can complete them.')
              : tOr('profile.agents.detail.integration.onboardingHint',
                'Nothing is ticked yet. The agent does these steps itself, over the connection above, once it can reach this node.')}
          <//>
          <${Stack} direction="wrap">
            <${Action} onClick=${handleRerun} disabled=${rerunning}>
              ${rerunning ? '...' : (passed > 0
                ? t('profile.agents.detail.integration.rerun')
                : t('profile.agents.detail.integration.startOnboarding'))}
            <//>
          <//>
        <//>
      <//>

      <${Section} size="small" density="compact" title=${t('profile.agents.skillBundle.title')}>
        <${Stack} density="compact">
          <div>
            <${KeyValue} label=${t('profile.agents.detail.platform')} value=${dimmed(platformName || notReported, !platformName)} />
            <${KeyValue} label=${tOr('profile.agents.detail.integration.bundleAddress', 'Bundle address')} value=${bundleUrl} mono=${true} />
          </div>
          ${bundleDoors({
            agentName, curlText, installCmdText, agentPromptText,
            installLabel: t('profile.agents.detail.integration.copyInstallCommand'),
          })}
        <//>
      <//>
    <//>`;
}

function renderProductionView(p) {
  const steps = p.onboarding?.steps || [];

  return html`
    <${Stack}>
      ${readinessSection({ steps, onboarding: p.onboarding, handleRerun: p.handleRerun, rerunning: p.rerunning })}
      <${Columns} collapse=${900}>
        ${connectionSection(p)}
        ${bundleSection(p)}
      <//>
      <${Columns} collapse=${900}>
        ${identitySection(p.agent)}
        ${p.postChecklist ? afterOnboardingSection(p.postChecklist) : ''}
      <//>
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
