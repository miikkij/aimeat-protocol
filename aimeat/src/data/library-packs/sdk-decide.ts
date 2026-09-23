/**
 * @file sdk-decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-decide.js (TARGET-080), typed questions to the decision
 *   model. Its own file because library-packs/sdk.ts is at the line ceiling; placed right after
 *   aimeat-ai in SDK_PACKS, beside the text model and never inside it.
 * @structure DECIDE_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.3.0 — 2026-09-23 — Decision providers: providers() and `provider` in the aiDoc.
 *   v1.2.0 — 2026-09-20 — Decision rules: AIMEAT.decide.rule(id) and rules() in the aiDoc and the prompt line.
 *   v1.1.0 — 2026-09-19 — The aiDoc points a living document at its `decide` node.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { LibraryPack } from './types.js';

export const DECIDE_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-decide',
    kind: 'sdk',
    category: 'ai',
    title: 'AI decisions',
    description: 'Typed questions to the decision model (TypeSafe Jev): yes/no probabilities, pick-one and scales. Classifies, routes, screens and gates; writes no text. The node scrubs personal data first, meters the call and records the decision.',
    url: '/v1/libs/aimeat-decide.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-decide.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.decide',
    aiDoc: 'CHECK FIRST that the owner can use it: aimeat_appdev_overview answers decision_model.available; when false, do not build the feature on it and tell the owner the reason. In the app, gate the feature on await AIMEAT.decide.isAvailable() (false when signed out, no ai:use, no TypeSafe key or turned off; AIMEAT.decide.unavailableReason() says why). Read skill node:aimeat-decide for when the model fits and the recipes. Typed decisions, not text: AIMEAT.decide.ask(state, questions, { subject, gates, thresholds, app_id }) with questions built by AIMEAT.decide.yesNo(statement), .pickOne(question, { option: meaning }) and .scale(question, [lowest, ..., highest]). Answers: answers[id].value is the probability (yesNo), the option name (pickOne, with probabilities and confidence) or the weighted level (scale). ASK EVERYTHING IN ONE CALL: cost is in the state, answers are free. WRITE INSTRUCTIONS AND OPTIONS IN ENGLISH whatever language the content is in, and translate before asking in a multilingual app. Keep counting, arithmetic and date comparison in code; add a "none of these" option to pickOne. WHAT THE APP SENDS IS THE APP\'S RESPONSIBILITY: TypeSafe runs in the USA and may keep its input. The node removes e-mails, phones, identity codes, IBANs, street addresses and the owner\'s contacts\' names, but not the people inside your app\'s own data, so send only the fields each question needs and pass the people the record mentions as names: [...] in the ask options. The publish check (ai_hints, prefixed DECIDE:) reports where an app departs from these rules. BEFORE THE FIRST CALL the app must declare in its data map (aimeat_datamap_set) a leaves row naming TypeSafe, e.g. { what: "scrubbed text of the record being judged", to: "TypeSafe (decision model, USA)", recallable: false }, or the node refuses with DATAMAP_REQUIRED. gate(state, questions, thresholds) returns passed[id]. PREFER A DECISION RULE when the owner should own the thresholds: the owner writes it once under Settings, AI, Decision model (questions, a threshold per question that counts, two bands); the app runs it with const r = await (await AIMEAT.decide.rule("send-reply")).ask({ draft, question }, { subject }) and sends ONLY the state fields the rule lists under sends; the answer adds outcome ("act" | "ask" | "stop"), result, passed and rule { id, version }, and the app branches on outcome. The app cannot send questions, thresholds or bands beside a rule (RULE_FIXES_QUESTIONS), a field outside sends is refused (STATE_OUTSIDE_RULE), and a rule the owner made for agents only is not found. AIMEAT.decide.rules() lists the rules this app may run; tell the owner which rule id the app expects and what fields it sends. The older form is a record the app keeps itself, read by questionSet(key). decisions({ subject }) reads what was decided about a record; review(id, "confirmed"|"overridden") records the human in the loop. run.start(questions, { items | keys | prefix, fields }) + run.waitFor(id) does many records. Errors on err.code: DATAMAP_REQUIRED, NO_API_KEY, QUOTA_EXHAUSTED, RATE_LIMITED, INVALID_REQUEST (err.details.violations). Never ship a TypeSafe key in an app. PROVIDERS: TypeSafe Jev is the default decision provider; AIMEAT.decide.providers() lists every one this account may use, each with kind ("hosted" or "local"), limits (max_choice_options, context_tokens) and data_statement (where the content goes; show it where the person picks). Pass { provider: id } in ask() options to choose; the answer names provider { id, kind, chosen_by }. A LOCAL decision model needs no key and costs nothing, and a provider that does not leave the machine needs no data-map row; a hosted one other than TypeSafe needs a leaves row naming it. A question a provider cannot carry is refused before sending (PROVIDER_CANNOT_CARRY, err.details.violations names the provider and its limit), so size pickOne to the max_choice_options of the chosen provider. IN A LIVING DOCUMENT (aimeat-living) do not call ask() yourself: a `decide` node asks when its input text changes and moves a statechart by its own events above a threshold, sending anything below it to a person; AIMEAT.living.describe("decide") has the fields.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['classify', 'route', 'score', 'screen', 'triage', 'decision', 'luokittelu', 'reititys', 'pisteytys', 'seulonta'],
    sizeEstimate: '~3KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'ai',
    promptLine: '- aimeat-decide.js — typed decisions (yes/no probability, pick one, scale) on the decision model; English questions; app must declare TypeSafe in its data map (`AIMEAT.decide.ask`); run the owner\'s named decision rule with `AIMEAT.decide.rule(id)`. Requires aimeat-auth.',
  },
];
