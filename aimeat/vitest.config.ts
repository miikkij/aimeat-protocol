import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
        environment: 'node',
    },
});
