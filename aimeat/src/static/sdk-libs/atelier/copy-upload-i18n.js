/**
 * @file atelier/copy-upload-i18n.js
 * @description The words of the dropzone's uploads and of the prompt panel's copy-by-hand line, in
 *   the kit's three languages. Each language is written in that language. The keys carry their own
 *   prefix (`upload.` or `copy.`), and a host overrides any of them by defining the same key
 *   through i18n.use().
 * @structure STRINGS (en/fi/es) · tu(key, vars): host override first, then this dictionary
 * @usage
 *   import { tu } from './copy-upload-i18n.js';
 *   tu('upload.saved', { key: 'photos/cat.png' });
 * @version-history
 *   v0.62.0 — 2026-10-01 — Initial: dropzone uploads and the kit's copy helper, and the dropzone's
 *     own label and refusals (`drop.`), whose English is the text the zone always had.
 */
import { i18n } from './i18n.js';

const STRINGS = {
  en: {
    'drop.label': 'Drop the file, or press to pick',
    'drop.tooBig': '{name} is over {mb} MB.',
    'drop.wrongKind': '{name} is not a kind this takes.',
    'upload.waiting': 'Waiting',
    'upload.sending': 'Uploading…',
    'upload.percent': 'Uploading… {n}%',
    'upload.saved': 'Saved as {key}',
    'upload.open': 'Open',
    'upload.failed': 'Did not upload: {why}',
    'copy.promptByHand': 'The browser did not allow copying. The whole prompt is selected: press Ctrl+C, or Cmd+C on a Mac.',
  },
  fi: {
    'drop.label': 'Pudota tiedosto tähän tai valitse se painamalla',
    'drop.tooBig': '{name} on yli {mb} Mt.',
    'drop.wrongKind': 'Tämä ei ota vastaan tiedostoa {name}: tiedostotyyppi ei käy.',
    'upload.waiting': 'Odottaa vuoroaan',
    'upload.sending': 'Lähetetään…',
    'upload.percent': 'Lähetetään… {n} %',
    'upload.saved': 'Tallennettu nimellä {key}',
    'upload.open': 'Avaa',
    'upload.failed': 'Lähetys ei onnistunut: {why}',
    'copy.promptByHand': 'Selain ei sallinut kopiointia. Koko kehote on valittu: paina Ctrl+C tai Macissa Cmd+C.',
  },
  es: {
    'drop.label': 'Suelta el archivo o presiona para elegirlo',
    'drop.tooBig': '{name} pesa más de {mb} MB.',
    'drop.wrongKind': '{name} no es de un tipo que se acepte aquí.',
    'upload.waiting': 'En espera',
    'upload.sending': 'Subiendo…',
    'upload.percent': 'Subiendo… {n} %',
    'upload.saved': 'Guardado como {key}',
    'upload.open': 'Abrir',
    'upload.failed': 'No se subió: {why}',
    'copy.promptByHand': 'El navegador no permitió copiar. La instrucción completa está seleccionada: pulsa Ctrl+C, o Cmd+C en un Mac.',
  },
};

/**
 * The lookup of the upload and copy words: a host's own definition of the same key (through
 * i18n.use()) wins; otherwise this dictionary answers in the platform language, falling back to
 * English, then to the key.
 * @param {string} key  a key with its prefix, `drop.`, `upload.` or `copy.`
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function tu(key, vars) {
  const hosted = i18n.t(key, vars);
  if (hosted !== key) return hosted;
  const lang = i18n.lang();
  const table = /** @type {Record<string, string>} */ (
    (STRINGS[/** @type {'en'|'fi'|'es'} */ (lang)] || STRINGS.en));
  const text = table[key] || STRINGS.en[key] || key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}
