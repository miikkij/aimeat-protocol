/**
 * @file validate/index.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat-validate library: AIMEAT.validate checks what a person typed against a
 *   JSON Schema and says, per field and in their language, what is wrong and what the field
 *   expects. Served at /v1/libs/aimeat-validate.js. Pure computation (core.js); the Atelier form
 *   runs the same core, so an app on the kit gets this without loading a second script.
 * @structure attach('validate', { version, compile, check, hint, addFormat, formats, lang, formatTests })
 * @usage
 *   <script src="/v1/libs/aimeat-validate.js"></script>
 *   const v = AIMEAT.validate.compile(schema);
 *   const r = v.check(values, { lang: 'fi' });   // { valid, errors, fields, form }
 *   v.ready(values, ['ytunnus', 'iban']);         // true when both are filled in correctly
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */
import { attach } from '../_core/namespace.js';
import { compile, check, hint, addFormat, formats, lang } from './core.js';
import { FORMAT_TESTS } from './formats.js';

attach('validate', {
  version: '1.0.0',
  compile: compile,
  check: check,
  hint: hint,
  addFormat: addFormat,
  formats: formats,
  lang: lang,
  /** The AIMEAT format tests by name, each answering true or the reason a value fails. */
  formatTests: FORMAT_TESTS,
});
