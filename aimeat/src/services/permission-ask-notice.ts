/**
 * @file src/services/permission-ask-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person hears it from the node, not only from their AI: when one of their agents
 *   is refused a permission, a notice lands in the bell and the same question goes to their own email
 *   address. A permission one press may give carries an Allow button and the allow page; any other
 *   carries the agent's page, where the person decides on it with its own tick.
 *
 *   WHY. The agent is told what to say (services/permission-ask.ts), and an agent does not always
 *   say it: a person's ChatGPT passed her the name of a permission and no address (2026-10-17). The
 *   node knows the refusal at the moment it answers it, so it asks the person itself. Until
 *   2026-10-18 only the one-press words were told; a refusal of a powerful word (ai:use,
 *   memory:purge) or of one outside every wildcard (messages:send-as-owner) reached nobody, and Jouni
 *   asked for it: "näkyykö tämä myös mulla jotenkin notifikaatioissa sitten että agentti tarvii lisää
 *   lupia? että osaan reagoida ja ne tulee myös mailiin".
 *
 *   WHEN. Once per newly opened refusal of a set of permissions, never per call: agent-refusals.ts
 *   calls the listener only when a refusal is new, not declined, and no other open refusal of the
 *   agent already needs the same permissions. A permission the person declined is not asked again
 *   while that refusal stays open.
 *
 *   NOT THE OPERATOR'S WORDS. A word only an operator's own agent can use (OPERATOR_WORDS) gives
 *   nothing on an account that does not run the node, so such a person is not told about it; when
 *   nothing else is left, nothing is sent.
 *
 *   EMAIL. Only to a verified notification address, only while the switch `email.agentAsks` on the
 *   Email page is on (it is unless switched off), and logged in the mail log as `agent_ask`.
 * @structure PERMISSION_ASK_TYPE · permissionAskNotice(agent, words, baseUrl) ·
 *   permissionPageNotice(agent, words, baseUrl) · tellPermissionAnswer(deps, agent, words, outcome, by) ·
 *   sendPermissionAsk(deps, ownerGhii, agent, words)
 * @usage initAgentRefusals(storage, (owner, agent, words) => sendPermissionAsk({ storage, config }, owner, agent, words));
 * @version-history
 *   v1.2.0 — 2026-10-25 — The one-press notice carries Don't allow beside Allow, and
 *     tellPermissionAnswer() tells the agent either answer (secaudit2026oct22, the approval standard).
 *   v1.1.0 — 2026-10-18 — A refusal that one press cannot answer reaches the bell and the email too,
 *     with no Allow button and the agent's page; the operator's words are left out on an account that
 *     does not run the node.
 *   v1.0.0 — 2026-10-17 — Initial (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AgentRecord } from '../storage/types/identity.js';
import { notify, type NotifyInput } from './notify.js';
import { readNotificationSettings, appendMailLog } from './notification-settings.js';
import { getActiveEmailService } from './email.js';
import { wrapHtml } from './email-templates.js';
import { allowUrl, agentPageUrl, plainPermission, oneClickWords, OPERATOR_WORDS } from './permission-ask.js';
import { createT, toLocale, type Locale } from '../i18n.js';
import { localAccountName } from '../utils/gaii.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { escapeHtml as esc } from '../utils/html-escape.js';
import { logger } from '../utils/logger.js';
import { tellAsker } from './approval-standard.js';

export const PERMISSION_ASK_TYPE = 'agent_permission_ask';
/** The i18n key of the notice whose permission is given on the agent's page, not with one press. */
const PAGE_KEY = 'agent_permission_ask_page';

const agentLabel = (agent: AgentRecord) => agent.displayName || agent.name;

/** What the agent asks for, in plain words in `locale`, one sentence per permission. */
function asks(words: readonly string[], locale: Locale): string {
  return words.map((w) => plainPermission(w, locale) ?? w).join(' ');
}

/** The path of an absolute address on this node, for a notice's link. */
const pathOf = (url: string) => url.slice(url.indexOf('/v1/'));

/** The bell notice: the question, the page to open, and Allow on the notice itself. */
export function permissionAskNotice(agent: AgentRecord, words: readonly string[], baseUrl: string): NotifyInput {
  const path = pathOf(allowUrl(baseUrl, agent.name, words));
  const name = agentLabel(agent);
  const what = asks(words, 'en');
  return {
    type: PERMISSION_ASK_TYPE,
    title: `${name} asks you to allow something`,
    body: `${name} tried to do this for you and could not, because you have not allowed it yet: ${what}`,
    link: path,
    i18n: { key: PERMISSION_ASK_TYPE, vars: { agent: name, what } },
    // Both answers on the notice (services/approval-standard.ts): a question with only Allow cannot be answered no.
    actions: [{
      id: 'deny',
      label: 'Don\'t allow',
      kind: 'api',
      method: 'POST',
      endpoint: `/v1/agents/${encodeURIComponent(agent.name)}/refusals/decline`,
      body: { needed: [...words] },
      style: 'default',
      i18n: { key: `${PERMISSION_ASK_TYPE}.deny` },
    }, {
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

/** The bell notice for a permission one press does not give: no Allow button, the agent's page instead. */
export function permissionPageNotice(agent: AgentRecord, words: readonly string[], baseUrl: string): NotifyInput {
  const path = pathOf(agentPageUrl(baseUrl, agent.name));
  const name = agentLabel(agent);
  const what = asks(words, 'en');
  return {
    type: PERMISSION_ASK_TYPE,
    title: `${name} needs a permission you give on its page`,
    body: `${name} tried to do this for you and could not, because you have not allowed it: ${what} `
      + "You give this permission on the agent's page, if you want to.",
    link: path,
    i18n: { key: PAGE_KEY, vars: { agent: name, what } },
    actions: [{ id: 'open', label: "Open the agent's page", kind: 'navigate', link: path, i18n: { key: `${PAGE_KEY}.open` } }],
  };
}

/** The email: the same question in the person's language, and a button to the page where they decide. */
function permissionAskEmail(agent: AgentRecord, words: readonly string[], baseUrl: string, locale: Locale, onePress: boolean) {
  const t = createT(locale);
  const page = onePress ? allowUrl(baseUrl, agent.name, words) : agentPageUrl(baseUrl, agent.name);
  const prefix = onePress ? 'agentAllow.email' : 'agentAllowPage.email';
  const vars = { agent: agentLabel(agent) };
  const subject = t(`${prefix}.subject`, vars);
  const lead = t(`${prefix}.lead`, vars);
  const what = words.map((w) => plainPermission(w, locale) ?? w);
  const button = t(`${prefix}.button`);
  const after = t(`${prefix}.after`);
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

/** The words this person is told about: an operator's word only when their account runs the node. */
async function wordsToTell(storage: Storage, ownerGhii: string, words: readonly string[]): Promise<string[]> {
  if (!words.some((w) => OPERATOR_WORDS.includes(w))) return [...words];
  const operator = isOperatorAccount(await storage.getOwner(localAccountName(ownerGhii)));
  return operator ? [...words] : words.filter((w) => !OPERATOR_WORDS.includes(w));
}

/**
 * Tell the agent how its person answered what it asked for (services/approval-standard.ts): Allow on
 * the allow page or the bell, Don't allow on the bell or the agent's page. Never throws.
 */
export async function tellPermissionAnswer(
  deps: { storage: Storage; config: AimeatConfig },
  agent: Pick<AgentRecord, 'gaii' | 'name' | 'owner'>,
  words: readonly string[], outcome: 'allowed' | 'declined', decidedBy: string,
): Promise<void> {
  const what = words.length
    ? words.map((w) => (plainPermission(w) ?? w).replace(/\.$/, '')).join('; ')
    : 'the permissions you were refused';
  await tellAsker(deps, {
    accountGhii: agent.owner.includes('@') ? agent.owner : `${agent.owner}@${deps.config.nodeId}`,
    asker: agent.gaii, outcome, decidedBy, what,
    contextId: `permission-ask:${agent.name}`,
    sentence: outcome === 'allowed'
      ? `Your person allowed it: ${what}. Call the tool again; it works now.`
      : `Your person did not allow it: ${what}. Do not ask again for this; do the work without it or tell them what it would need.`,
    data: { scopes: [...words] },
    messageKind: 'permission-ask',
  });
}

/** Tell the person, in the bell and by email. Never throws: the refusal already stands. */
export async function sendPermissionAsk(
  deps: { storage: Storage; config: AimeatConfig },
  ownerGhii: string,
  agent: AgentRecord,
  refused: readonly string[],
): Promise<void> {
  try {
    const onePress = oneClickWords(refused);
    const words = onePress ? [...refused] : await wordsToTell(deps.storage, ownerGhii, refused);
    if (words.length === 0) return;
    const notice = onePress
      ? permissionAskNotice(agent, words, deps.config.baseUrl)
      : permissionPageNotice(agent, words, deps.config.baseUrl);
    await notify(deps.storage, ownerGhii, notice);
    const email = getActiveEmailService();
    if (!email?.enabled) return;
    const ghii = await deps.storage.getGHII(ownerGhii);
    if (!ghii?.notificationEmail || !ghii.emailVerifiedAt) return;
    const prefs = await readNotificationSettings(deps.storage, ownerGhii);
    if (prefs.email.agentAsks === false) return;
    const mail = permissionAskEmail(agent, words, deps.config.baseUrl, toLocale(ghii.locale), onePress);
    const sent = await email.sendRaw(ghii.notificationEmail, mail.subject, mail.html, mail.text);
    if (sent) await appendMailLog(deps.storage, ownerGhii, { kind: 'agent_ask', subject: mail.subject });
  } catch (err) {
    logger.warn('permission-ask-notice: the person could not be told; the refusal still stands', {
      owner: ownerGhii, agent: agent.gaii, error: String(err),
    });
  }
}
