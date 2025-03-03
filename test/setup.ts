/* eslint-disable no-empty-function */
/* eslint-disable no-console */

import { log } from "console";
import { beforeAll, beforeEach, vi } from "vitest";
import { Logger } from "../src/shared/Logger.ts";
import { Config } from "../src/shared/Config.ts";

beforeEach(async () => {
    vi.mock(`../src/shared/Logger.ts`, async (original) => {
        let originalModule = await original()
        return {
            Logger: {
                winston: undefined,
                log: (message: string, context: string) => {
                },
                debug: (message: string, context: string) => {
                },
                debugWarn: (message: string, context: string) => {
                },
                warn: (message: string, context: string) => {
                },
                error: (message: string, context: string) => {
                },
                info: (message: string, context: string) => {
                }
            }
        };
    });

    vi.mock(`../src/shared/Config.ts`, async (importOriginal) => {
        // eslint-disable-next-line quotes
        const originalModule = await importOriginal() as typeof import('../src/shared/Config.ts');
        process.env.NODE_ENV = `test`;
        return {
            Config: originalModule.DEFAULT_CONFIG
        };
    });
});