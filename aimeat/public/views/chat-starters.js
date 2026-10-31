/**
 * @file public/views/chat-starters.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The openings an empty conversation offers: the standing ones, the one for the
 *   person's next stage, and a buyer's three. Moved out of views/chat.js unchanged when it passed 800
 *   lines (max-file-lines), a pure extraction.
 * @structure STARTERS · STAGE_STARTERS · BUYER_STARTERS · startersFor(journey)
 * @usage import { BUYER_STARTERS, startersFor } from './chat-starters.js';
 * @version-history
 *   v1.0.0 — 2026-10-31 — Moved out of views/chat.js unchanged (max-file-lines).
 */

/**
 * The openings offered on an empty conversation.
 *
 * Each one is a request a person could have typed. The first is their next stage (STAGE_STARTERS
 * below); "take something off my plate" starts the conversation this place is actually for: what
 * they are trying to get done, in their words, which is the thing everything else attaches to. A person who reads a feature list has told the agent nothing; a person who says
 * what keeps slipping has told it enough to build the whole thing.
 *
 * The button sends the sentence rather than filling the box with it — a half-written prompt waiting
 * to be edited is one more decision, and the point of these is to remove decisions.
 */
export const STARTERS = [
    { id: 'work', key: 'chat.starterWorkAsk', fallback: 'Something on my plate keeps slipping. Ask me about it, then suggest one thing you could take over.',
      label: 'chat.starterWork', labelFallback: 'Take something off my plate' },
    { id: 'connect', key: 'chat.starterConnectAsk', fallback: 'I already pay for an AI subscription. How do I connect it here so it can do this work?',
      label: 'chat.starterConnect', labelFallback: 'Connect my own AI' },
    // The one that names a COMPANY rather than a task. Three of these are things a person does;
    // this is a thing their company gets, and it is the only starter whose first move creates
    // something with a public address, so the agent asks before it reserves one.
    { id: 'company', key: 'chat.starterCompanyAsk', fallback: 'Set up my company here, and give it a memory of its own.',
      label: 'chat.starterCompany', labelFallback: 'Set up my company' },
];

/**
 * The first starter is the person's next stage on their path (GET /v1/home/state `journey`, the same
 * step the home, Settings and the help page show). A newcomer's is the profile: their AI interviews
 * them, and the answers become their business card on their own page (Jouni, 2026-10-03). The id is
 * what the funnel records (routes/chat.ts, /^[a-z-]{1,32}$/).
 */
export const STAGE_STARTERS = {
    'first-result': { id: 'profile', key: 'chat.starterProfileAsk', label: 'chat.starterProfile' },
    ai: { id: 'ai', key: 'chat.starterAiAsk', label: 'chat.starterAi' },
    connect: STARTERS[1],
    organise: { id: 'place', key: 'chat.starterPlaceAsk', label: 'chat.starterPlace' },
    apps: { id: 'apps', key: 'chat.starterAppsAsk', label: 'chat.starterApps' },
    agents: { id: 'agents', key: 'chat.starterAgentsAsk', label: 'chat.starterAgents' },
    share: { id: 'share', key: 'chat.starterShareAsk', label: 'chat.starterShare' },
};

/**
 * A buyer's three, concrete (Jouni's review of v31, K32). The news one has a topic to fill in, so
 * it goes into the box (`fill`) instead of being sent half-written.
 */
export const BUYER_STARTERS = [
    { id: 'shopping-app', key: 'chat.buyerAppAsk', fallback: 'Make me a shopping list app.',
      label: 'chat.buyerApp', labelFallback: 'Make me a shopping list app' },
    { id: 'news', key: 'chat.buyerNewsAsk', fallback: 'Gather the news every morning on the topic ', fill: true,
      label: 'chat.buyerNews', labelFallback: 'Gather the news every morning on …' },
    { id: 'what', key: 'chat.buyerWhatAsk', fallback: 'Tell me what you can do for me.',
      label: 'chat.buyerWhat', labelFallback: 'Tell me what you can do for me' },
];

/** The next stage's starter first, then the standing ones it does not repeat; four at most. */
export function startersFor(journey) {
    const next = journey ? journey.next : 'first-result';
    const first = next ? STAGE_STARTERS[next] : null;
    const connected = !!journey?.stages?.find((s) => s.id === 'connect')?.done;
    const rest = STARTERS.filter((st) => st !== first && !(st.id === 'connect' && connected));
    return (first ? [first, ...rest] : rest).slice(0, 4);
}
