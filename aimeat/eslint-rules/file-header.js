/**
 * @file file-header.js
 * @description Custom ESLint rule that enforces file headers with @file and @description tags
 *   on all TypeScript source files. Warns when headers are missing.
 *
 * @usage
 *   Used in eslint.config.js via local plugin import.
 *
 * @version-history
 *   v1.0.0 — 2026-03-13 — Initial implementation
 */

/** @type {import('eslint').Rule.RuleModule} */
export const fileHeader = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce file header comments with @file and @description tags',
    },
    schema: [],
    messages: {
      missingHeader: 'File is missing a header comment with @file and @description tags. See docs/coding-guidelines/file-headers.md',
    },
  },

  create(context) {
    return {
      Program(node) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const comments = sourceCode.getAllComments();

        // Look for a block comment at the top of the file with @file and @description
        const headerComment = comments.find(
          (comment) =>
            comment.type === 'Block' &&
            comment.loc.start.line <= 5 &&
            comment.value.includes('@file') &&
            comment.value.includes('@description')
        );

        if (!headerComment) {
          context.report({
            node,
            messageId: 'missingHeader',
            loc: { line: 1, column: 0 },
          });
        }
      },
    };
  },
};
