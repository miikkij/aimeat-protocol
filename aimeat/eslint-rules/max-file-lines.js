/**
 * @file max-file-lines.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule that warns when a file exceeds a configurable line count.
 *   Encourages splitting large files into smaller, focused modules.
 *
 * @usage
 *   Used in eslint.config.js via local plugin import.
 *   Configure with: 'aimeat/max-file-lines': ['warn', { max: 500 }]
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 */

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
        'File has {{actual}} lines, exceeding the maximum of {{max}}. Consider splitting into smaller modules.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const max = options.max || 500;

    return {
      Program(node) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const lines = sourceCode.lines.length;

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
