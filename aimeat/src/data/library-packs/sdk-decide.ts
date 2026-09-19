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
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { LibraryPack } from './types.js';

export const DECIDE_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-decide',
    kind: 'sdk',
    category: 'ai',
    title: 'AI decisions',
    description: 'Typed questions to the decision model (TypeSafe Jev): yes/no probabilities, pick-one and scales, in well under a second. Classifies, routes, screens and gates; writes no text. The node scrubs personal data first, meters the call and records the decision.',
    url: '/v1/libs/aimeat-decide.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-decide.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.decide',
    aiDoc: 'Typed decisions, not text: AIMEAT.decide.ask(state, questions, { subject, gates, thresholds, app_id }) with questions built by AIMEAT.decide.yesNo(statement), .pickOne(question, { option: meaning }) and .scale(question, [lowest, ..., highest]). Answers: answers[id].value is the probability (yesNo), the option name (pickOne, with probabilities and confidence) or the weighted level (scale). ASK EVERYTHING IN ONE CALL: cost is in the state, answers are free. WRITE INSTRUCTIONS AND OPTIONS IN ENGLISH whatever language the content is in, and translate before asking in a multilingual app. Keep counting, arithmetic and date comparison in code; add a "none of these" option to pickOne. WHAT THE APP SENDS IS THE APP\'S RESPONSIBILITY: TypeSafe runs in the USA and may keep its input. The node removes e-mails, phones, identity codes, IBANs, street addresses and the owner\'s contacts\' names, but not the people inside your app\'s own data, so send only the fields each question needs and pass the people the record mentions as names: [...] in the ask options. The publish check (ai_hints, prefixed DECIDE:) reports where an app departs from these rules. BEFORE THE FIRST CALL the app must declare in its data map (aimeat_datamap_set) a leaves row naming TypeSafe, e.g. { what: "scrubbed text of the record being judged", to: "TypeSafe (decision model, USA)", recallable: false }, or the node refuses with DATAMAP_REQUIRED. gate(state, questions, thresholds) returns passed[id]. Keep questions and thresholds in one owner-editable memory record read by questionSet(key). decisions({ subject }) reads what was decided about a record; review(id, "confirmed"|"overridden") records the human in the loop. run.start(questions, { items | keys | prefix, fields }) + run.waitFor(id) does many records. Errors on err.code: DATAMAP_REQUIRED, NO_API_KEY, QUOTA_EXHAUSTED, RATE_LIMITED, INVALID_REQUEST (err.details.violations). Never ship a TypeSafe key in an app.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['classify', 'route', 'score', 'screen', 'triage', 'decision', 'luokittelu', 'reititys', 'pisteytys', 'seulonta'],
    sizeEstimate: '~3KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'ai',
    promptLine: '- aimeat-decide.js — typed decisions (yes/no probability, pick one, scale) on the decision model; English questions; app must declare TypeSafe in its data map (`AIMEAT.decide.ask`). Requires aimeat-auth.',
  },
];
