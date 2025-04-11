import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [`**/*.test.ts`],
        setupFiles: [`./test/setup.ts`],
        //globalSetup: './test/setup.ts',
        reporters: process.env.GITHUB_ACTIONS ? [`github-actions`, [`verbose`, { summary: true }]] : [[`default`]],
        mockReset: true,
        testTimeout: 10000,
        pool: `forks`,
    }
});