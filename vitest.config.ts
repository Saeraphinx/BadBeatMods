import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [`**/*.test.ts`],
        setupFiles: [`./test/setup.ts`],
        //globalSetup: './test/setup.ts',
        //reporters: [`hanging-process`],
        alias: {
            "@shared": `./src/shared`
        }
    }
});