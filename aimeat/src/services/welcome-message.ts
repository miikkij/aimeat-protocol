/**
 * @file src/services/welcome-message.ts
 * @description The message the operator sends every new account, so the mailbox is not empty on the
 *   day the person arrives.
 *
 *   It is a REAL direct message, not a rendered placeholder: a human wrote the words, the node
 *   delivered them, and replying to it reaches that human. That distinction is the whole reason
 *   this exists rather than a hardcoded greeting in the inbox view — the mailbox may only show
 *   things that actually arrived.
 *
 *   The words live in the managed prompt store (`operator-welcome`, group `portal`), which is
 *   already a versioned, locale-aware, operator-editable text store with an admin UI. Nothing here
 *   owns the copy; this file only decides who sends it, to whom, and when.
 *
 *   **First line is the subject.** One editable field controls both the subject and the body, so an
 *   operator changing the greeting cannot end up with a subject that contradicts it.
 * @structure
 *   - sendOperatorWelcome(storage, config, ownerName) — resolve, render, deliver. Never throws.
 *   - splitSubjectAndBody(text) — first non-empty line + the rest (exported for the test)
 * @usage
 *   // At a registration door, fire-and-forget — a welcome must never fail a signup:
 *   void import('./welcome-message.js')
 *     .then(m => m.sendOperatorWelcome(storage, config, owner.name))
 *     .catch(err => logger.warn('welcome message failed', { error: String(err) }));
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolveOperatorFeeGhii } from './marketplace-fee.js';
import { resolvePromptContent, substituteVariables } from './prompt-variables.js';
import { sendDirectMessage } from './message-send.js';
import { logger } from '../utils/logger.js';

/** The seeded prompt that holds the operator's words. */
export const WELCOME_PROMPT_ID = 'operator-welcome';

/**
 * Split the editable text into its subject and body: the first non-empty line is the subject, the
 * remainder is the message. An operator who writes a single line gets that line as the subject and
 * as the body, which reads correctly rather than arriving with an empty message.
 */
export function splitSubjectAndBody(text: string): { subject: string; body: string } {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    const subject = (lines[i] ?? '').trim();
    const body = lines.slice(i + 1).join('\n').trim();
    return { subject, body: body || subject };
}

/**
 * Deliver the operator's welcome to a newly created account.
 *
 * Silently does nothing — by design, never throwing — when:
 *   - the node has no operator account yet (the very first registration, see below),
 *   - the recipient IS the operator (a self-send writes two rows under one primary key and would
 *     take the signup down with it),
 *   - the prompt has been deleted or emptied by the operator, which is a legitimate way to turn
 *     this off.
 */
export async function sendOperatorWelcome(
    storage: Storage, config: AimeatConfig, ownerName: string,
): Promise<void> {
    const recipientGhii = `${ownerName}@${config.nodeId}`;

    const operatorGhii = await resolveOperatorFeeGhii(storage, config);
    // No operator yet: this is the node's first account, which is the operator's own. Nobody is
    // there to welcome them, and inventing a sender would be a lie about who is talking.
    if (!operatorGhii) return;
    // The operator's own later accounts, and the first-owner case where the cache has warmed: a
    // message from yourself to yourself collides on (id, ownerGhii) inside sendDirectMessage's
    // own-agent branch. Guarding here rather than there keeps the general path untouched.
    if (operatorGhii === recipientGhii) return;

    const prompt = await storage.getSystemPrompt(WELCOME_PROMPT_ID);
    if (!prompt || prompt.active === false) return;

    const ghii = await storage.getGHII(recipientGhii);
    // No locale on the record → resolvePromptContent returns `content`, the English default.
    const raw = resolvePromptContent(prompt, ghii?.locale);
    const rendered = substituteVariables(raw, {
        node_url: config.baseUrl,
        display_name: ghii?.displayName || ownerName,
    });
    const { subject, body } = splitSubjectAndBody(rendered);
    if (!subject) return;

    const result = await sendDirectMessage({ config, storage, peers: new Map() }, {
        senderGhii: operatorGhii,
        recipientGhii,
        subject,
        body,
        // Straight into the mailbox. Without this the operator's first words land in the
        // first-contact requests bucket, where the newcomer has to accept a stranger before
        // reading the message that explains where they are.
        skipContactGate: true,
    });
    if (!result.ok) {
        logger.warn('welcome message not delivered', { to: recipientGhii, code: result.code });
    }
}
