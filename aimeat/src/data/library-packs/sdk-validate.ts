/**
 * @file sdk-validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-validate.js: what a person typed, checked against a
 *   JSON Schema, with a message per field in their language, the hint a format field shows, Finnish
 *   formats with check digits, rules between fields and the "may I continue" question. Its own file
 *   because library-packs/sdk.ts is near the line ceiling.
 * @structure VALIDATE_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */
import type { LibraryPack } from './types.js';

export const VALIDATE_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-validate',
    kind: 'sdk',
    category: 'core',
    title: 'Input validation',
    description: 'Check what a person typed against a JSON Schema: a message per field in English, Finnish or Spanish, the hint a format field shows, Finnish Business ID, personal identity code, IBAN, postal code and phone with check digits, rules between fields, and whether the fields of a step are ready.',
    url: '/v1/libs/aimeat-validate.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-validate.js"></script>'],
    requires: [],
    license: 'MIT',
    apiSurface: 'AIMEAT.validate',
    tierHint: 'T1',
    status: 'preview',
    modelTier: 'needs-doc',
    interviewTriggers: ['form', 'validation', 'validate', 'input', 'lomake', 'validointi', 'tarkistus', 'y-tunnus', 'iban', 'henkilötunnus', 'formulario'],
    sizeEstimate: '~30KB',
    promptGroup: 'core',
    promptLine: '- aimeat-validate.js: check form input against a JSON Schema; per-field messages (en/fi/es), format hints, Finnish IDs and IBAN, step readiness. The Atelier form() runs the same checks.',
    aiDoc: [
      'AIMEAT.validate checks a value against a JSON Schema (draft-07) and answers per field in the person\'s language. Pure computation: no fetch, no storage. The Atelier kit\'s form() runs the same core, so an app on the kit declares rules on its fields (required, format, pattern, minLength, maxLength, min, max, sameAs, messages) or passes { schema } and does not load this file.',
      'ONE SCHEMA FOR THE PERSON, THE AGENT AND THE NODE. Write the rules once as a JSON Schema. The same object can lock a workspace space (aimeat_workspace_update { schemas }, or PUT /v1/memory/:key/schema), so an agent\'s write is refused by the rule that refuses a person\'s typing, and an agent can read the rules before it writes. Use draft-07 words: rules between fields are `dependencies` ({ company: ["iban"] }: iban is required when company is given) and `if`/`then`; the node refuses `dependentRequired`.',
      'const v = AIMEAT.validate.compile(schema); const r = v.check(values, { lang: "fi", labels: { company: "Yritys" } }) returns { valid, errors, fields, form }. errors: [{ field, rule, message, hint, params, fields? }] in the order of the schema properties. fields[name] is the first problem of that field. form holds problems of no one field (an anyOf between fields), with fields: [names]. lang defaults to the platform language (AIMEAT.auth.getLang), then <html lang>, then English. labels name other fields inside a message; the schema title is used otherwise.',
      'AN EMPTY ANSWER IS NO ANSWER: "" and null are taken out before the check, so an empty optional field passes and an empty required one says "Fill in this field." rather than a format error. { keepEmpty: true } turns that off.',
      'Formats: email, uri, url, date, time, date-time, uuid, hostname, ipv4, ipv6 and AIMEAT\'s fi-business-id (Y-tunnus, check digit), fi-personal-id (henkilötunnus, date and check character, the 2023 century signs), iban (country length and mod 97, spaces allowed), fi-postal-code, phone (6 to 15 digits, optional +). The node checks the AIMEAT formats too. A format message says the reason: a wrong check digit reads differently from a wrong shape. AIMEAT.validate.formats() lists them; formatTests[name](value) answers true or the reason.',
      'Words: v.hint(field, lang) is what the field expects (x-hint, else the format\'s example), shown under the field before anything is typed. Per field, x-messages: { pattern: { fi: "Kolme isoa kirjainta.", en: "Three capital letters." } } replaces the message of one rule; x-hint: text or { en, fi, es }. x-same-as: "email" requires the value to equal the sibling email (a repeated address or password). All three are accepted by the node\'s schema lock.',
      'Steps: v.ready(values, ["ytunnus", "iban"]) is true when those fields are right; v.missing(values, names) lists the ones still wrong, in form order. A Next button stays held (aria-disabled, still focusable) until ready, says which fields are missing, and on a press shows their messages and moves focus to the first. With the Atelier form this is form.gate(button, names); spec { gate: true } does it for the submit button.',
      'When to check: when the person leaves a field (blur), then on every keystroke until it is right; all fields on submit. Show the message next to the field (aria-describedby, role=alert), not in a toast. Check again on the node: the browser check is for the person, the schema lock is the guarantee.',
      'AIMEAT.validate.addFormat(name, value => true | false | "reason", { hint, message }) adds a format of the page. The node does not know it and refuses a schema lock that names it, so use it only for browser-side checks.',
    ].join('\n'),
    changelog: [{ version: '1.0.0', date: '2026-10-05', summary: 'JSON Schema checks with per-field messages in en/fi/es, format hints, Finnish IDs and IBAN, rules between fields and step readiness.' }],
  },
];
