/**
 * @file src/services/extension-fetch-scrub.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Remove from an outbound call's response every value the node itself put into that
 *   call's request, before the response reaches the extension's sandbox.
 *
 *   WHY. ctx.fetch fills `{{secret:NAME}}` from the owner's vault (or the extension's shared map), and
 *   in a provider run adds the owner's AI key, on the host side of the sandbox (services/extension-ctx.ts),
 *   so the script can send a credential and never hold it. The response went back to the script as it
 *   arrived, so a host that echoes the request (a debug endpoint, an error that quotes "invalid key
 *   sk-…") handed the script the value after all, and the script could write it to its world-readable
 *   `ext:` namespace (secrets audit 2026-10-09, item 10). Scrubbing on the host side keeps the promise
 *   whatever the far end does.
 *
 *   WHAT IS REPLACED, each with SCRUB_PLACEHOLDER, in the body and in every response header value:
 *     - the value itself, URL-encoded, and JSON-escaped (a JSON echo escapes quotes and backslashes)
 *     - its base64 and base64url forms, at all three byte alignments: inside a longer base64 blob the
 *       value's characters depend on where it starts, so the part that is fixed at each alignment is
 *       matched too
 *     - the same forms of each whole header value that carried a secret (`Bearer sk-…`, or the
 *       `user:password` of a Basic credential), which is how such a header is most often echoed
 *   A value shorter than MIN_SCRUB_LENGTH is not matched: it cannot be told apart from ordinary text,
 *   replacing it would garble every answer, and a credential that short is guessable anyway.
 * @structure SCRUB_PLACEHOLDER · MIN_SCRUB_LENGTH · scrubFormsOf · scrubText · scrubResponse
 * @usage const forms = scrubFormsOf(inserted); const clean = scrubResponse(text, headers, forms);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, item 10).
 */

/** What a removed value reads as in the answer the script receives. */
export const SCRUB_PLACEHOLDER = '[redacted]';

/** Shorter values are not matched (see the file header). */
export const MIN_SCRUB_LENGTH = 4;

/** The shortest part of a misaligned base64 form that is still matched: shorter is noise. */
const MIN_BASE64_FRAGMENT = 8;

/** The characters of the base64 (or base64url) form of `bytes` that do not depend on what surrounds
 *  them when they start `shift` bytes into a longer buffer. */
function alignedBase64(bytes: Buffer, shift: number, url: boolean): string {
  const padded = Buffer.concat([Buffer.alloc(shift), bytes]);
  let text = padded.toString(url ? 'base64url' : 'base64').replace(/=+$/, '');
  // The leading characters carry bits of the prefix; the trailing ones of whatever follows.
  const lead = shift === 0 ? 0 : Math.ceil((shift * 8) / 6);
  const tailBits = (padded.length * 8) % 6;
  text = text.slice(lead, tailBits === 0 ? text.length : text.length - 1);
  return text;
}

/** Every form of these values that a script could read back, longest first, without duplicates. */
export function scrubFormsOf(values: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.length < MIN_SCRUB_LENGTH) continue;
    forms.add(value);
    forms.add(encodeURIComponent(value));
    forms.add(JSON.stringify(value).slice(1, -1));
    const bytes = Buffer.from(value, 'utf8');
    forms.add(bytes.toString('base64'));
    for (const url of [false, true]) {
      for (let shift = 0; shift < 3; shift++) {
        const fragment = alignedBase64(bytes, shift, url);
        if (fragment.length >= MIN_BASE64_FRAGMENT) forms.add(fragment);
      }
    }
  }
  return [...forms].filter(f => f.length >= MIN_SCRUB_LENGTH).sort((a, b) => b.length - a.length);
}

/** `text` with every form replaced. */
export function scrubText(text: string, forms: readonly string[]): string {
  let out = text;
  for (const form of forms) {
    if (out.includes(form)) out = out.split(form).join(SCRUB_PLACEHOLDER);
  }
  return out;
}

/** The response as the script may see it: the body and every header value scrubbed. */
export function scrubResponse(
  text: string, headers: Record<string, string>, forms: readonly string[],
): { text: string; headers: Record<string, string> } {
  if (!forms.length) return { text, headers };
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) clean[k] = scrubText(v, forms);
  return { text: scrubText(text, forms), headers: clean };
}
