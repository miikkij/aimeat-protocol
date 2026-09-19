/**
 * @file build-app-prompt-decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The build specification's section on the decision model (TARGET-080): when an app
 *   should reach for AIMEAT.decide rather than a text model, how to check first that the owner can
 *   use it at all, and the rules the app is responsible for.
 *
 *   CHECK BEFORE BUILDING. The specification is the same for every owner, so it cannot say whether
 *   THIS owner has a TypeSafe key. It says where to find out (the appdev overview's
 *   `decision_model`, `aimeat_decide_settings`, `GET /v1/ai/decide/settings`) and tells the builder
 *   not to build a feature on the model when the answer is no. The app then gates the feature at
 *   runtime on `AIMEAT.decide.isAvailable()`, like every AI feature.
 *
 *   Its own file because services/build-app-prompt.ts is at the 800-line limit.
 * @structure buildDecideSection(nodeUrl)
 * @usage body += buildDecideSection(nodeUrl);   // after the aimeat-ai section
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */

export function buildDecideSection(nodeUrl: string): string {
  let body = '';
  body += '### Decisions without text: the decision model (aimeat-decide.js)\n';
  body += 'For a step that classifies, screens, routes, scores or gates (which folder, does this need an answer today, how upset is the customer, which of these candidates) use the decision model, not a text model: typed questions, answers with probabilities, and no prose to parse. It writes no text, so anything that must be written stays with `aimeat-ai` or the prompt-driven workflow.\n';
  body += '**Check first that this owner can use it.** `aimeat_appdev_overview` answers `decision_model.available` (or `aimeat_decide_settings` / `GET /v1/ai/decide/settings` → `available`). When it is false, do not build the feature on it: tell the owner the reason it gives, or design the feature without it. Read skill `node:aimeat-decide` before designing: it has the recipes and the cases the model is wrong for.\n';
  body += '```javascript\n';
  body += '// <script src="' + nodeUrl + '/v1/libs/aimeat-decide.js"></' + 'script>   (after aimeat-auth; the app requests ai:use)\n';
  body += 'if (await AIMEAT.decide.isAvailable()) {\n';
  body += '  const r = await AIMEAT.decide.ask({ subject: mail.subject, body: mail.body }, {   // only the fields the questions need\n';
  body += '    urgent: AIMEAT.decide.yesNo("The sender needs an answer today."),\n';
  body += '    topic: AIMEAT.decide.pickOne("What is the message mainly about?", { invoice: "A bill or a payment", meeting: "Arranging a meeting", other: "Anything else" }),\n';
  body += '  }, { subject: mail.key, gates: "which folder the mail goes to", thresholds: { urgent: 0.8 }, names: [mail.fromName], app_id: "my-app" });\n';
  body += '  if (r.answers.urgent.value >= 0.8) markUrgent(mail);\n';
  body += '} else { hideDecisionFeature(AIMEAT.decide.unavailableReason()); }\n';
  body += '```\n';
  body += 'The rules the app is responsible for: questions and options in ENGLISH whatever language the content is in; every question in ONE call; send only the fields the questions need and pass the people the record mentions as `names` (the node removes e-mails, phones, identity codes, IBANs, street addresses and the owner\'s contacts, not the people inside your data); declare TypeSafe in the data map (`leaves`: `{ what, to: "TypeSafe (decision model, USA)", recallable: false }`) or the first call is refused with DATAMAP_REQUIRED; never call TypeSafe from the app or hold its key. The publish response reports departures as `ai_hints` starting `DECIDE:`.\n\n';
  return body;
}
