/**
 * @file public/components/ChatAi.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat's AI on the chat page (Jouni, 2026-11-07): what the page says when the chat
 *   cannot answer, and the model, region and key it answers with when it can. Both read GET
 *   /v1/chat/status (`state`, `fix`, `technical`, `ai`) and write through the writers that already
 *   exist: PUT /v1/ai/routing (the chat agent's model, the person's region) and
 *   PUT|DELETE /v1/agents/chat/ai-keys (the chat's own OpenRouter key). Built from the library's
 *   components only, so it has no sheet of its own.
 *
 *   ChatUnavailable: the chat is off (no chat agent, or one that does not start, which only the
 *   operator changes) or has no AI (no key may pay). Says which, who can change it, and that this chat is for a person without a
 *   paid AI service that connects over MCP; the developer's sentence stays behind "Technical details".
 *
 *   ChatAiSettings: the model (a picker when the person may choose, the name and the operator's lock
 *   when not), the region (a choice when the operator lets people choose, "EU models only" when only
 *   the EU is allowed) and which key pays, with a key for the chat alone.
 * @structure ChatUnavailable({ status }) · ChatAiSettings({ status, onChanged })
 * @usage html`<${ChatUnavailable} status=${status} />` · html`<${ChatAiSettings} status=${status} onChanged=${reload} />`
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (Jouni, 2026-11-07).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiPut, apiDelete } from '/js/api.js';
import { ConversationCap } from '/components/ConversationFrame.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark } from '/components/Mark.js';
import { Select } from '/components/Select.js';
import { ModelPicker } from '/components/ModelPicker.js';
import { TextField } from '/components/TextField.js';
import { Field, Fields } from '/components/Field.js';
import { Modal } from '/components/Modal.js';
import { inboxLinkHref } from '/components/InboxLink.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The address that reaches this node's operators, as the status names it. */
const operatorAddress = (status) => status?.operator_contact || 'support@operators';

/**
 * The chat cannot answer: why, who can change it, and the better road for a person with a paid AI.
 * @param {{ status: any }} props
 */
export function ChatUnavailable({ status }) {
    const [showTech, setShowTech] = useState(false);
    // Only the operator changes these two: no chat agent set up, or one that does not start.
    const down = status?.state === 'agent_down';
    const noAgent = status?.state === 'no_agent' || down;
    const title = down
        ? tr('chat.ai.downTitle', 'The chat does not work on this server')
        : noAgent
            ? tr('chat.ai.offTitle', 'The chat is off on this server')
            : tr('chat.ai.noAiTitle', 'The chat has no AI to answer with');
    const body = down
        ? tr('chat.ai.downBody', 'The chat agent does not start on this server. The operator can fix this.')
        : noAgent
            ? tr('chat.ai.offBody', 'This server has no chat agent set up. The operator can turn the chat on.')
            : (status?.fix?.message || tr('chat.ai.noAiBody', 'No AI key can pay for the chat on this server. Add your own OpenRouter key, or ask the operator.'));
    const technical = status?.technical || status?.fix?.code || '';
    const subject = noAgent ? tr('chat.ai.mailSubjectOff', 'Turning on the chat') : tr('chat.ai.mailSubjectNoAi', 'AI for the chat');
    const advice = tr('chat.ai.mcpAdvice', 'You need this chat only when you have no paid AI service with MCP support. If you use Claude, ChatGPT or Grok, connect it to this server and do your work through it.');
    // In place of the message box: nothing can be typed here, and this says why and what to do.
    return html`
        <${ConversationCap} title=${title} body=${`${body} ${advice}`}
            ways=${[
                !noAgent && { loud: true, href: status?.fix?.settings_url || '/v1/profile?tab=ai', label: tr('chat.ai.addOwnKey', 'Add your own OpenRouter key') },
                { loud: noAgent, href: '/v1/connect-your-ai', label: `${tr('chat.ai.connectOwnAi', 'Connect the AI you already use')} →` },
                { href: inboxLinkHref(operatorAddress(status), subject), label: `${tr('chat.ai.askOperator', 'Write to the operator')} →` },
            ]}>
            ${technical && html`
                <${Action} small tone="quiet" aria-expanded=${showTech ? 'true' : 'false'} onClick=${() => setShowTech((v) => !v)}>
                    ${showTech ? tr('chat.ai.hideTechnical', 'Hide technical details') : tr('chat.ai.showTechnical', 'Technical details')}
                <//>
                ${showTech && html`<${Note} kind="quiet" mono>${technical}<//>`}`}
        <//>`;
}

const REGION_WORDS = () => ({
    eu: tr('chat.ai.regionEu', 'EU'),
    us: tr('chat.ai.regionUs', 'United States'),
    any: tr('chat.ai.regionAny', 'Any country'),
});

const KEY_WORDS = () => ({
    chat: tr('chat.ai.keyChat', "The chat's own OpenRouter key"),
    own: tr('chat.ai.keyOwn', 'Your own OpenRouter key'),
    node: tr('chat.ai.keyNode', "This server's key, from your AI allowance"),
    shared: tr('chat.ai.keyShared', "The operator's shared key"),
});

/**
 * The model, region and key the chat answers with, and what the person may change here.
 * @param {{ status: any, onChanged?: () => void }} props
 */
export function ChatAiSettings({ status, onChanged }) {
    const ai = status?.ai;
    const [keyOpen, setKeyOpen] = useState(false);
    const [modelOpen, setModelOpen] = useState(false);
    const [keyValue, setKeyValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');
    if (!ai || status?.state === 'no_agent' || status?.state === 'agent_down') return null;

    const run = async (work) => {
        setBusy(true);
        setProblem('');
        try {
            await work();
            onChanged?.();
        } catch (e) {
            setProblem(e?.message || tr('chat.ai.saveFailed', 'The change was not saved.'));
        } finally {
            setBusy(false);
        }
    };
    const setModel = (id) => run(() => apiPut('/v1/ai/routing', { routing: { agent: 'chat', model: id || null } }));
    const setRegion = (region) => run(() => apiPut('/v1/ai/routing', { routing: { rules: { openrouterRegion: region } } }));
    const saveKey = () => run(async () => {
        await apiPut('/v1/agents/chat/ai-keys', { openrouter: { api_key: keyValue.trim() } });
        setKeyValue('');
        setKeyOpen(false);
    });
    const removeKey = () => run(() => apiDelete('/v1/agents/chat/ai-keys/openrouter'));

    const model = ai.model ?? {};
    const region = ai.region;
    const key = ai.key ?? {};
    const regions = REGION_WORDS();

    const modelHint = model.locked
        ? tr('chat.ai.modelLocked', 'The operator chooses the model.')
        : (model.operator_allowed?.length ? tr('chat.ai.modelOperatorList', 'The operator allows only some models.') : undefined);
    const regionHint = region
        ? (region.can_choose
            ? tr('chat.ai.regionAll', 'This applies to all your AI on this server.')
            : tr('chat.ai.regionByOperator', 'The operator decides the region.'))
        : undefined;
    const keyWords = KEY_WORDS();

    // One field under another: the rail is too narrow for a name beside its value, and the long model
    // list opens in a dialog of its own.
    return html`
        <${Fields} column spaced>
            <${Field} label=${tr('chat.ai.model', 'Model')} hint=${modelHint}>
                <${Note} kind="quiet" mono>${model.current || tr('chat.ai.modelNone', 'Not chosen yet')}<//>
                ${model.can_choose && html`
                    <${Actions}>
                        <${Action} small disabled=${busy} onClick=${() => setModelOpen(true)}>${tr('chat.ai.modelChange', 'Change the model')}<//>
                        ${model.chosen && html`<${Action} small tone="quiet" disabled=${busy} onClick=${() => setModel('')}>${tr('chat.ai.modelReset', 'Use your account’s default')}<//>`}
                    <//>`}
            <//>
            ${region && html`
                <${Field} label=${tr('chat.ai.region', 'Region')} hint=${regionHint}>
                    ${region.can_choose
                        ? html`<${Select} value=${region.current} disabled=${busy} ariaLabel=${tr('chat.ai.region', 'Region')}
                            onChange=${setRegion} options=${region.choices.map((r) => [r, regions[r] || r])} />`
                        : html`<${Note} kind="quiet">${regions[region.current] || region.current}<//>`}
                    ${region.eu_only && html`<${Mark} kind="status" small>${tr('chat.ai.euOnly', 'EU models only')}<//>`}
                <//>`}
            <${Field} label=${tr('chat.ai.key', 'Key')}
                hint=${key.can_set_chat_key ? tr('chat.ai.keyChatOnly', 'A key of the chat’s own pays for this chat and nothing else.') : undefined}>
                <${Note} kind="quiet">${key.source ? keyWords[key.source] : tr('chat.ai.keyNone', 'No key pays for the chat yet')}<//>
                ${key.can_set_chat_key && html`
                    <${Actions}>
                        <${Action} small disabled=${busy} onClick=${() => setKeyOpen((v) => !v)}>
                            ${key.chat_key_set ? tr('chat.ai.keyChange', 'Change the chat’s key') : tr('chat.ai.keyAdd', 'Give the chat its own key')}
                        <//>
                        ${key.chat_key_set && html`<${Action} small tone="danger" disabled=${busy} onClick=${removeKey}>${tr('chat.ai.keyRemove', 'Remove the chat’s key')}<//>`}
                    <//>
                    ${keyOpen && html`
                        <${TextField} unmanaged label=${tr('chat.ai.keyLabel', 'OpenRouter key for the chat')} value=${keyValue}
                            onInput=${setKeyValue} disabled=${busy} />
                        <${Actions}>
                            <${Loud} control disabled=${busy || keyValue.trim().length < 8} onClick=${saveKey}>${tr('chat.ai.keySave', 'Save the key')}<//>
                        <//>`}`}
            <//>
            ${problem && html`<${Note} error>${problem}<//>`}
            <${Note} kind="caption">${tr('chat.ai.mcpHint', 'Do you use Claude, ChatGPT or Grok? Connect it to this server over MCP and work through it instead of this chat.')}
                ${' '}<${Action} tone="link" href="/v1/connect-your-ai">${tr('chat.ai.connectShort', 'Connect')}<//><//>
            <${Modal} open=${modelOpen} onClose=${() => setModelOpen(false)} title=${tr('chat.ai.modelDialog', 'The chat’s model')}>
                <${ModelPicker} value=${model.chosen || ''} models=${model.choices || []} allowNone=${true} disabled=${busy}
                    noneLabel=${tr('chat.ai.modelDefault', 'Your account’s default model')}
                    ariaLabel=${tr('chat.ai.model', 'Model')}
                    onChange=${(id) => { setModelOpen(false); setModel(id); }} />
            <//>
        <//>`;
}

export default ChatAiSettings;
