import { test, expect, describe, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { Express } from 'express';
import { startServer, stopServer } from '../src/index.ts';
import { Server } from 'http';
import { DatabaseManager, SupportedGames, UserRoles } from '../src/shared/Database.ts';

const api = supertest(`http://localhost:8485/api`);
let server: { server: Server, app: Express, database: DatabaseManager };
let shouldAuthenticate = false;

describe.sequential(`API`, () => {
    beforeAll(async () => {
        // Do not mock these files for a full server run.
        vi.unmock(`../src/shared/Logger.ts`);
        vi.unmock(`../src/shared/Config.ts`);

        vi.mock(`../src/shared/AuthHelper.ts`, () => ({
            validateSession: async (req: any, res: any, role: UserRoles|boolean = UserRoles.Admin, gameName:SupportedGames|null|boolean = null, handleRequest:boolean = true) => {
                if (shouldAuthenticate) {
                    return { user: server.database.serverAdmin };
                } else {
                    if (handleRequest) {
                        res.status(401).send({ message: `Unauthorized.` });
                    }
                    return { user: null };
                }
            }
        }));

        process.env.NODE_ENV = `test`;
        server = await startServer();
    });

    afterAll(async () => {
        await stopServer(false);
    });

    test(`/status`, async () => {
        const response = await api.get(`/status`);
        expect(response.status).toBe(200);
    });

    test(`/auth - no auth`, async () => {
        const response = await api.get(`/auth`);
        expect(response.status).toBe(401);
    });

    test(`/auth - authed`, async () => {
        shouldAuthenticate = true;
        const response = await api.get(`/auth`);
        expect(response.status).toBe(200);
        shouldAuthenticate = false;
    });


});