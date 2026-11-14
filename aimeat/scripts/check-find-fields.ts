/**
 * @file scripts/check-find-fields.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a find field that public/js/find-field-guard.js cannot see.
 *
 *   WHY. A browser's own password manager writes the saved sign-in name into a text field it takes
 *   for a user name, whatever autocomplete="off" says. In a find field the list under it then
 *   filters on that name and shows "No matches": the Settings & Controls find (LastPass, 2026-10-29
 *   and 31) and the App Catalog search (Edge on Android, 2026-11-14). The guard refuses that fill,
 *   but only on a field it recognises: an `<input type="search">` or an input marked `data-find`.
 *
 *   WHAT IT CHECKS, in every tracked .js and .html file under public/ (vendored public/lib/ left out):
 *   - an `<input>` tag whose words say it is a find field (search, find, filter, query, and the
 *     Finnish haku, hae, etsi, suodata, in its class, id, name, placeholder or label) or that carries
 *     the password-manager keep-out marks (data-lpignore, data-form-type="other") is
 *     type="search" or carries data-find. A tag with a computed type (`type=${…}`) that can be
 *     both "search" and "text" (SearchLine `text`) carries data-find; another computed type
 *     (TextField's `kind`) is left to the component that computes it; a tag of a type that is not text (checkbox, password, email, number…) is skipped too. A
 *     field that only looks like a find field carries `data-not-find`.
 *   - a `<${TextField}>` whose placeholder or label says it is a find field has the `search`
 *     prop, which makes it type="search".
 *   Each refusal names the file, the line and the fix.
 * @structure FIND_WORDS · tagsOf() · checkInput() · checkTextField() · main()
 * @usage cd aimeat && pnpm check:find-fields
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Words that say a field finds something in a list. */
const FIND_WORDS = /\b(search|find|filter|query|haku|hae\b|etsi|suodat)/i;

/** Drops the words of a quoted sentence (a fallback text such as 'find out our competitors'); keys stay. */
function withoutProse(text: string): string {
    return text.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, (lit) => (/\s/.test(lit) ? "''" : lit));
}
/** The marks a field carries to keep password managers out; a credential field is type="password". */
const KEEP_OUT = /data-lpignore|data-form-type=["']other["']/;
/** Input types that take no free text, or that a browser autofills on purpose. */
const NOT_TEXT = /\btype=["'](checkbox|radio|file|hidden|range|color|date|datetime-local|month|week|time|number|password|email|url|tel|submit|button|reset|image)["']/;

/** Every `<tag …>` in the source, `${…}` expressions kept whole, with the line it starts on. */
export function tagsOf(src: string, open: string): Array<{ line: number; text: string }> {
    const out: Array<{ line: number; text: string }> = [];
    let i = 0;
    while ((i = src.indexOf(open, i)) !== -1) {
        const next = src[i + open.length] ?? '';
        if (!/[\s/>]/.test(next)) { i += open.length; continue; }
        let j = i + open.length;
        let depth = 0;
        for (; j < src.length; j++) {
            const c = src[j];
            if (c === '$' && src[j + 1] === '{') { depth++; j++; continue; }
            if (c === '{' && depth) { depth++; continue; }
            if (c === '}' && depth) { depth--; continue; }
            if (c === '>' && !depth) break;
        }
        out.push({ line: src.slice(0, i).split('\n').length, text: src.slice(i, j + 1) });
        i = j;
    }
    return out;
}

/** The parts of a tag that name the field: its attributes, its event handlers left out. */
function namingText(tag: string): string {
    return tag.replace(/\bon[A-Z][A-Za-z]*=\$\{[^}]*\}/g, '').replace(/\bon[a-z]+=["'][^"']*["']/g, '');
}

/** A refusal for an `<input>` tag, or null when it is fine. */
export function checkInput(tag: string): string | null {
    if (NOT_TEXT.test(tag) || /\bdata-not-find\b/.test(tag) || /\bdata-find\b/.test(tag)) return null;
    const computed = /\btype=\$\{([^}]*)\}/.exec(tag);
    if (computed) {
        // A find field that is type="search" or "text" by a prop (SearchLine `text`): as text, only
        // data-find shows the guard it is a find field.
        const expr = computed[1];
        return /['"]search['"]/.test(expr) && /['"]text['"]/.test(expr)
            ? 'a find field whose type can be "text", not marked data-find'
            : null;
    }
    if (/\btype=["']search["']/.test(tag)) return null;
    const words = namingText(tag);
    if (FIND_WORDS.test(words)) return 'a find field that is neither type="search" nor marked data-find';
    if (KEEP_OUT.test(words)) return 'a field kept out of password managers that is neither type="search" nor marked data-find';
    return null;
}

/** A refusal for a `<${TextField}>` tag, or null when it is fine. */
export function checkTextField(tag: string): string | null {
    if (/\s(search)(\s|\/|>|=)/.test(tag) || /\bdata-not-find\b/.test(tag)) return null;
    if (/\b(secret|unmanaged|type=)/.test(tag)) return null;
    const named = [...tag.matchAll(/\b(placeholder|ariaLabel)=(\$\{[^}]*\}|"[^"]*"|'[^']*')/g)].map((m) => m[2]).join(' ');
    return FIND_WORDS.test(withoutProse(named)) ? 'a TextField whose words say it finds something, without the `search` prop' : null;
}

function main(): void {
    const files = execFileSync('git', ['ls-files', 'public'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map((s) => s.trim())
        .filter((f) => /\.(js|html)$/.test(f) && !f.startsWith('public/lib/'));
    const refusals: string[] = [];
    for (const file of files) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        for (const t of tagsOf(src, '<input')) {
            const why = checkInput(t.text);
            if (why) refusals.push(`${file}:${t.line}  ${why}`);
        }
        for (const t of tagsOf(src, '<${TextField}')) {
            const why = checkTextField(t.text);
            if (why) refusals.push(`${file}:${t.line}  ${why}`);
        }
    }
    if (refusals.length) {
        console.error(`check:find-fields: ${refusals.length} find field(s) the autofill guard cannot see.\n`);
        for (const r of refusals) console.error(`  ${r}`);
        console.error('\nFix: give the field type="search" (TextField: the `search` prop; SearchLine and SearchBar are guarded already),'
            + '\nor mark a find field drawn as type="text" with data-find. A field that only looks like a find field carries data-not-find.'
            + '\nWhy: the browser writes the sign-in name into it (public/js/find-field-guard.js).');
        process.exit(1);
    }
    console.log(`check:find-fields: ok (${files.length} files, every find field is guarded)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
