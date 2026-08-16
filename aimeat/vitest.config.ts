import { defineConfig } from 'vitest/config';

/**
 * TWO PROJECTS, FOR ONE REASON: a handful of tests EDIT files in the working tree.
 *
 * `check-ai-disclosure.test.ts` proves the disclosure gate by breaking the thing it protects —
 * deleting `aiLabel.short` from `locales/fi.json`, writing a `[TODO:fi]` placeholder, removing a
 * line from a route — running the real script, and restoring. That is the right way to test a gate:
 * a failing case nobody has seen is a gate that checks nothing.
 *
 * It is also a shared-state test. `ai-label-sdk-strings.test.ts` READS the same locale file, and
 * with files running in parallel it read a Finnish bundle that another worker had emptied a
 * millisecond earlier — "expected 'AI-generated' not to be 'AI-generated'", on a tree where nothing
 * was wrong. Measured: the whole suite passes serially (2534/2534 in 95s) and fails intermittently
 * in parallel (19s). Turning parallelism off everywhere would buy correctness with 76 seconds on
 * every commit, so the tree-mutating file and the files that read what it mutates go in a project of
 * their own, which runs its files one at a time. Everything else keeps running in parallel.
 *
 * Add a file here when it edits something another test reads, not when it is merely slow.
 */
const MUTATES_THE_TREE = [
    'test/unit/check-ai-disclosure.test.ts',
    'test/unit/ai-label-sdk-strings.test.ts',
];

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/__tests__/**', 'src/cli/**'],
            reporter: ['text', 'text-summary', 'lcov'],
            reportsDirectory: './coverage',
        },
        projects: [
            {
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
                    exclude: MUTATES_THE_TREE,
                },
            },
            {
                test: {
                    name: 'tree-mutating',
                    environment: 'node',
                    include: MUTATES_THE_TREE,
                    // One at a time, and never beside a reader of the same files.
                    fileParallelism: false,
                },
            },
        ],
    },
});
