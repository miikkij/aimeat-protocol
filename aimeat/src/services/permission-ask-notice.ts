/**
 * @file src/services/permission-ask-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person hears it from the node, not only from their AI: when one of their agents
 *   is refused something they can allow with one press, a notice with an Allow button lands in the
 *   bell, and the same question goes to their own email address with a button to the allow page.
 *
 *   WHY. The agent is told what to say (services/permission-ask.ts), and an agent does not always
 *   say it: a person's ChatGPT passed her the name of a permission and no address (2026-10-17). The
 *   node knows the refusal at the moment it answers it, so it asks the person itself.
 *
 *   WHEN. Once per newly opened refusal of a set of permissions, never per call: agent-refusals.ts
 *   calls the listener only when a refusal is new, not declined, and no other open refusal of the
 *   agent already needs the same permissions. A permission the person declined is not asked again
 *   while that refusal stays open. Only words one press may give: the rest stay on the agent's page.
 *
 *   EMAIL. Only to a verified notification address, only while the switch `email.agentAsks` on the
 *   Email page is on (it is unless switched off), and logged in the mail log as `agent_ask`.
 * @structure permissionAskNotice(agent, words, baseUrl) · sendPermissionAsk(deps, ownerGhii, agent, words)
 * @usage initAgentRefusals(storage, (owner, agent, words) => sendPermissionAsk({ storage, config }, owner, agent, words));
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AgentRecord } from '../storage/types/identity.js';
import { notify, type NotifyInput } from './notify.js';
import { readNotificationSettings, appendMailLog } from './notification-settings.js';
import { getActiveEmailService } from './email.js';
import { wrapHtml } from './email-templates.js';
import { allowUrl, plainPermission, oneClickWords } from './permission-ask.js';
import { createT, toLocale, type Locale } from '../i18n.js';
import { escapeHtml as esc } from '../utils/html-escape.js';
import { logger } from '../utils/logger.js';

export const PERMISSION_ASK_TYPE = 'agent_permission_ask';

const agentLabel = (agent: AgentRecord) => agent.displayName || agent.name;

/** What the agent asks for, in plain words in `locale`, one sentence per permission. */
function asks(words: readonly string[], locale: Locale): string {
  return words.map((w) => plainPermission(w, locale) ?? w).join(' ');
}

/** The bell notice: the question, the page to open, and Allow on the notice itself. */
export function permissionAskNotice(agent: AgentRecord, words: readonly string[], baseUrl: string): NotifyInput {
  const page = allowUrl(baseUrl, agent.name, words);
  const path = page.slice(page.indexOf('/v1/'));
  const name = agentLabel(agent);
  const what = asks(words, 'en');
  return {
    type: PERMISSION_ASK_TYPE,
    title: `${name} asks you to allow something`,
    body: `${name} tried to do this for you and could not, because you have not allowed it yet: ${what}`,
    link: path,
    i18n: { key: PERMISSION_ASK_TYPE, vars: { agent: name, what } },
    actions: [{
      id: 'allow',
      label: 'Allow',
      kind: 'api',
      method: 'POST',
      endpoint: `/v1/agents/${encodeURIComponent(agent.name)}/allow`,
      body: { scopes: [...words] },
      style: 'primary',
      i18n: { key: `${PERMISSION_ASK_TYPE}.allow` },
    }],
  };
}

/** The email: the same question in the person's language, and a button to the allow page. */
function permissionAskEmail(agent: AgentRecord, words: readonly string[], baseUrl: string, locale: Locale) {
  const t = createT(locale);
  const page = allowUrl(baseUrl, agent.name, words);
  const vars = { agent: agentLabel(agent) };
  const subject = t('agentAllow.email.subject', vars);
  const lead = t('agentAllow.email.lead', vars);
  const what = words.map((w) => plainPermission(w, locale) ?? w);
  const button = t('agentAllow.email.button');
  const after = t('agentAllow.email.after');
  const html = wrapHtml(subject, `
    <p>${esc(lead)}</p>
    <ul>${what.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    <p style="text-align: center;"><a href="${esc(page)}" class="btn">${esc(button)}</a></p>
    <p>${esc(after)}</p>
    <p class="url-fallback">${esc(page)}</p>
  `, locale);
  const text = [subject, '', lead, '', ...what.map((s) => `- ${s}`), '', `${button}: ${page}`, '', after].join('\n');
  return { subject, html, text };
}

/** Tell the person, in the bell and by email. Never throws: the refusal already stands. */
export async function sendPermissionAsk(
  deps: { storage: Storage; config: AimeatConfig },
  ownerGhii: string,
  agent: AgentRecord,
  words: readonly string[],
): Promise<void> {
  if (!oneClickWords(words)) return;
  try {
    await notify(deps.storage, ownerGhii, permissionAskNotice(agent, words, deps.config.baseUrl));
    const email = getActiveEmailService();
    if (!email?.enabled) return;
    const ghii = await deps.storage.getGHII(ownerGhii);
    if (!ghii?.notificationEmail || !ghii.emailVerifiedAt) return;
    const prefs = await readNotificationSettings(deps.storage, ownerGhii);
    if (prefs.email.agentAsks === false) return;
    const mail = permissionAskEmail(agent, words, deps.config.baseUrl, toLocale(ghii.locale));
    const sent = await email.sendRaw(ghii.notificationEmail, mail.subject, mail.html, mail.text);
    if (sent) await appendMailLog(deps.storage, ownerGhii, { kind: 'agent_ask', subject: mail.subject });
  } catch (err) {
    logger.warn('permission-ask-notice: the person could not be told; the refusal still stands', {
      owner: ownerGhii, agent: agent.gaii, error: String(err),
    });
  }
}
