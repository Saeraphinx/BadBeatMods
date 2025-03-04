import { test, expect, describe, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { startServer, stopServer } from '../src/index.ts';

const api = supertest(`http://localhost:8485/api`);

describe(`API`, () => {
    beforeAll(async () => {
        // Do not mock these files for a full server run.
        vi.unmock(`../src/shared/Logger.ts`);
        vi.unmock(`../src/shared/Config.ts`);
        await startServer();
    });

    afterAll(async () => {
        await stopServer(false);
    });

    test(`/status`, async () => {
        const response = await api.get(`/status`);
        expect(response.status).toBe(200);
    });
});

