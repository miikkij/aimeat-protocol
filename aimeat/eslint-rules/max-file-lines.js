/**
 * @file max-file-lines.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule that warns when a file exceeds a configurable line count.
 *   Encourages splitting large files into smaller, focused modules. The count starts after the
 *   file's leading header comment (the first block comment, when nothing but a shebang or blank lines
 *   comes before it), so the header's description and version history never push a file over the
 *   limit and are never cut to fit it. A file with no leading header counts every line.
 *
 * @usage
 *   Used in eslint.config.js via local plugin import.
 *   Configure with: 'aimeat/max-file-lines': ['warn', { max: 500 }]
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 *   v1.1.0 — 2026-08-19 — Count lines the way wc -l does. ESLint 10.6+ made
 *     sourceCode.lines include the empty string after a file's final newline, so every
 *     file read as one line longer and a file sitting exactly on the limit failed. The
 *     limit counts real lines, so a single trailing empty entry is discounted.
 *   v1.2.0 — 2026-11-05 — Count from the end of the leading header comment (codebase analysis
 *     2026-11-03, item D-c; Jouni 2026-11-05, decision 15). 47 files sat at 790-800 lines with
 *     80-218 of them version history, and the rule forced splits that measured history, not code.
 */

/**
 * The last line of the file's leading header comment, or 0 when the file has none. The header is the
 * first comment when it is a block comment and only a shebang or blank lines come before it.
 */
function leadingHeaderEnd(sourceCode, raw) {
  // ESLint reports a shebang as a comment of its own; it is not the header.
  const first = sourceCode.getAllComments().find((c) => c.type !== 'Shebang');
  if (!first || first.type !== 'Block') return 0;
  for (let i = 0; i < first.loc.start.line - 1; i++) {
    const line = raw[i].trim();
    if (line !== '' && !(i === 0 && line.startsWith('#!'))) return 0;
  }
  return first.loc.end.line;
}

/** @type {import('eslint').Rule.RuleModule} */
export const maxFileLines = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce a maximum number of lines per file',
    },
    schema: [
      {
        type: 'object',
        properties: {
          max: { type: 'number', default: 500 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        'File has {{actual}} lines after its header, exceeding the maximum of {{max}}. Consider splitting into smaller modules.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const max = options.max || 500;

    return {
      Program(node) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const raw = sourceCode.lines;
        // A file ending in a newline yields a final empty entry; wc -l does not count it.
        const total = raw.length > 0 && raw[raw.length - 1] === '' ? raw.length - 1 : raw.length;
        const lines = total - leadingHeaderEnd(sourceCode, raw);

        if (lines > max) {
          context.report({
            node,
            messageId: 'tooLong',
            data: {
              actual: String(lines),
              max: String(max),
            },
            loc: { line: 1, column: 0 },
          });
        }
      },
    };
  },
};
