/*
import { test, expect, describe, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Express } from 'express';
import { startServer, stopServer } from '../../src/index.ts';
import { Server } from 'http';
import { Categories, DatabaseHelper, DatabaseManager, GameVersionInfer, ModAPIPublicResponse, ModInfer, ModVersionAPIPublicResponse, ModVersionInfer, Platform, Status, SupportedGames, UserInfer, UserRoles } from '../../src/shared/Database.ts';

const api = supertest(`http://localhost:8488/api`);
let server: { server: Server, app: Express, database: DatabaseManager };
let shouldAuthenticateWithRole: UserRoles|null = null;

describe.sequential.skip(`API - Editing`, () => {
    let defaultModData: Omit<ModInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        // Do not mock these files for a full server run.
        vi.unmock(`../../src/shared/Logger.ts`);
        vi.unmock(`../../src/shared/Config.ts`);

        vi.mock(`../../src/shared/AuthHelper.ts`, () => ({
            validateSession: async (req: any, res: any, role: UserRoles|boolean = UserRoles.Admin, gameName:SupportedGames|null|boolean = null, handleRequest:boolean = true) => {
                if (shouldAuthenticateWithRole) {
                    return { 
                        user: {
                            ...server.database.serverAdmin,
                            id: 1,
                            roles: {
                                sitewide: [shouldAuthenticateWithRole]
                            } 
                        }
                    };
                } else {
                    if (handleRequest) {
                        res.status(401).send({ message: `Unauthorized.` });
                    }
                    return { user: null };
                }
            }
        }));

        vi.mock(`../../src/shared/Config.ts`, async (importOriginal) => {
            const originalModule = await importOriginal() as typeof import('../../src/shared/Config.ts');
            process.env.NODE_ENV = `test`;
            return {
                Config: {
                    ...originalModule.DEFAULT_CONFIG,
                    database: {
                        ...originalModule.DEFAULT_CONFIG.database,
                        url: `:memory:`,
                    },
                    server: {
                        ...originalModule.DEFAULT_CONFIG.server,
                        port: 8488,
                        url: `http://localhost:8488`,
                        sessionSecret: `secret`
                    }
                }
            };
        });


        process.env.NODE_ENV = `test`;
        server = await startServer();
        defaultModData = defaultModData = {
            authorIds: [1],
            category: Categories.Core,
            description: `Test Description`,
            gameName: SupportedGames.BeatSaber,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            lastUpdatedById: 1,
            name: `Test Mod`,
            status: Status.Private,
            summary: `Test Summary`,
        };
        //console.log(JSON.stringify(server.database.serverAdmin));
    });

    afterAll(async () => {
        await stopServer(false);
    });

    beforeEach(() => {
        shouldAuthenticateWithRole = null;
    });

    test(`/mods/:modId - priavte`, async () => {
        shouldAuthenticateWithRole = UserRoles.LargeFiles;
        const newMod = await server.database.Mods.create({
            ...defaultModData
        });
        const response = await api.patch(`/mods/1`).send({
            name: `Test Mod 2`,
            summary: `Test Summary 2`,
            description: `Test Description 2`,
            category: Categories.Core,
            gitUrl: `https://beatsaber.com`,
        });
        expect(response.status).toBe(200);
        const mod = response.body;
        expect(mod).toBeDefined();
        expect(mod).toHaveProperty(`mod`);
        expect(mod.mod).toHaveProperty(`name`);
        expect(mod.mod.name).toBe(`Test Mod 2`);
    });
});
*/