import { test, expect, describe, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Express } from 'express';
import { startServer } from '../../src/index.ts';
import { Server } from 'http';
import { Categories, DatabaseHelper, DatabaseManager, EditQueue, GameVersionInfer, Mod, ModAPIPublicResponse, ModInfer, ModVersion, ModVersionAPIPublicResponse, ModVersionInfer, Platform, Status, SupportedGames, User, UserInfer, UserRoles } from '../../src/shared/Database.ts';
// #region setup
const api = supertest(`http://localhost:8486/api`);
let server: Awaited<ReturnType<typeof startServer>>;
let shouldAuthenticateWithRole: UserRoles | false | true = false;

// eslint-disable-next-line quotes
import * as fakeData from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { WebhookLogType } from '../../src/shared/ModWebhooks.ts';

let gameVersions: GameVersionInfer[] = [];
for (let gv of fakeData.gameVersions) {
    gameVersions.push({
        ...gv,
        gameName: gv.gameName as SupportedGames,
        createdAt: new Date(gv.createdAt),
        updatedAt: new Date(gv.updatedAt),
        linkedVersionIds: [],
    });
}

let users: UserInfer[] = [];
for (let user of fakeData.users) {
    users.push({
        ...user,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
    });
}

let projects: ModInfer[] = [];
for (let project of fakeData.projects) {
    projects.push({
        ...project,
        gameName: project.gameName as SupportedGames,
        category: project.category as Categories,
        status: project.status as Status,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
    });
}

let versions: ModVersionInfer[] = [];
for (let version of fakeData.versions) {
    versions.push({
        ...version,
        modVersion: new SemVer(version.modVersion.raw),
        platform: version.platform as Platform,
        status: version.status as Status,
        createdAt: new Date(version.createdAt),
        updatedAt: new Date(version.updatedAt),
    });
}

vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendModLog: vi.fn(async (mod: Mod, userMakingChanges: User, logType: WebhookLogType) => {}),
        sendModVersionLog: vi.fn(async (modVersion: ModVersion, userMakingChanges: User, logType: WebhookLogType, modObj?: Mod) => {}),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ModInfer | ModVersionInfer) => {}),
    };
});
// #endregion

describe.sequential(`API`, async () => {
    let { sendModLog, sendEditLog, sendModVersionLog } = await import(`../../src/shared/ModWebhooks.ts`);

    beforeAll(async () => {
        // Do not mock these files for a full server run.
        vi.unmock(`../../src/shared/Logger.ts`);
        vi.unmock(`../../src/shared/Config.ts`);

        vi.mock(`../../src/shared/AuthHelper.ts`, () => ({
            validateSession: async (req: any, res: any, role: UserRoles | boolean = UserRoles.Admin, gameName: SupportedGames | null | boolean = null, handleRequest: boolean = true) => {
                let admin = await server.database.Users.findByPk(1);
                if (typeof shouldAuthenticateWithRole == `string`) {
                    return {
                        user: {
                            ...admin,
                            id: 1,
                            roles: {
                                sitewide: [shouldAuthenticateWithRole],
                                perGame: {},
                            }
                        }
                    };
                } else if (shouldAuthenticateWithRole) {
                    return { user: admin };
                } else {
                    if (handleRequest) {
                        res.status(401).send({ message: `Unauthorized.` });
                    }
                    return { user: null };
                }
            }
        }));

        vi.mock(`../../src/shared/Config.ts`, async (importOriginal) => {
            const originalModule = await importOriginal() as typeof import('../../src/shared/Config');
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
                        port: 8486,
                        url: `http://localhost:8486`,
                        sessionSecret: `secret`
                    }
                }
            };
        });

        vi.mock(import (`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
            const actual = await importOriginal();
            return {
                ...actual,
                sendModLog: vi.fn(async (mod: Mod, userMakingChanges: User, logType: WebhookLogType) => {}),
                sendModVersionLog: vi.fn(async (modVersion: ModVersion, userMakingChanges: User, logType: WebhookLogType, modObj?: Mod) => {}),
                sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ModInfer | ModVersionInfer) => {}),
            };
        });

        process.env.NODE_ENV = `test`;
        server = await startServer();
        await server.database.GameVersions.bulkCreate(gameVersions, { individualHooks: true });
        await server.database.Mods.bulkCreate(projects, { individualHooks: true });
        await server.database.ModVersions.bulkCreate(versions, { individualHooks: true });
        await DatabaseHelper.refreshAllCaches();
        //console.log(JSON.stringify(server.database.serverAdmin));
    });

    afterAll(async () => {
        await server.stopServer(false);
    });

    beforeEach(() => {
        shouldAuthenticateWithRole = false;
    });

    describe.sequential(`Status`, () => {
        test(`/status`, async () => {
            const response = await api.get(`/status`);
            expect(response.status).toBe(200);
        });

        test(`/auth - no auth`, async () => {
            const response = await api.get(`/auth`);
            expect(response.status).toBe(401);
        });

        test(`/auth - authed`, async () => {
            shouldAuthenticateWithRole = true;
            const response = await api.get(`/auth`);
            expect(response.status).toBe(200);
            shouldAuthenticateWithRole = false;
        });
    });

    describe.sequential(`Get Mods`, () => {
        test(`/mods - no param`, async () => {
            const response = await api.get(`/mods`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            expect(() => {
                let mods = response.body.mods;
                for (let currentMod of response.body.mods) {
                    expect(currentMod).toHaveProperty(`mod`);
                    expect(currentMod).toHaveProperty(`latest`);
                }
            }).toBeTruthy();
        });

        test(`/mods - gv only`, async () => {
            const response = await api.get(`/mods?gameVersion=1.0.0`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods;
            for (let cmod of response.body.mods) {
                let currentMod = cmod as { mod: ModAPIPublicResponse, latest: ModVersionAPIPublicResponse };
                expect(currentMod).toHaveProperty(`mod`);
                expect(currentMod).toHaveProperty(`latest`);
                let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
                expect(dependancies.length).toBe(currentMod.latest.dependencies.length);
                expect(currentMod.latest.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
            }
        });

        test(`/mods - gv and universal platform`, async () => {
            const response = await api.get(`/mods?gameVersion=1.0.0&platform=${Platform.UniversalPC}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods;
            for (let cmod of response.body.mods) {
                let currentMod = cmod as { mod: ModAPIPublicResponse, latest: ModVersionAPIPublicResponse };
                expect(currentMod).toHaveProperty(`mod`);
                expect(currentMod).toHaveProperty(`latest`);
                let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
                expect(dependancies.length).toBe(currentMod.latest.dependencies.length);
                expect(currentMod.latest.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
                expect(currentMod.latest.platform).toBe(Platform.UniversalPC);
            }
        });

        test(`/mods - gv, universal platform, verified status`, async () => {
            const response = await api.get(`/mods?gameVersion=1.0.0&platform=${Platform.UniversalPC}&status=${Status.Verified}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods;
            for (let cmod of response.body.mods) {
                let currentMod = cmod as { mod: ModAPIPublicResponse, latest: ModVersionAPIPublicResponse };
                expect(currentMod).toHaveProperty(`mod`);
                expect(currentMod).toHaveProperty(`latest`);
                let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
                expect(dependancies.length).toBe(currentMod.latest.dependencies.length);
                expect(currentMod.latest.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
                expect(currentMod.latest.platform).toBe(Platform.UniversalPC);
                expect(currentMod.mod.status).toBe(Status.Verified);
                expect(currentMod.latest.status).toBe(Status.Verified);
            }
        });

        test(`/mods - gv, universal platform, unverified and verified statuses`, async () => {
            let hasSeenVerified = false;
            let hasSeenUnverified = false;
            let haveSeenPending = false;
            const response = await api.get(`/mods?gameVersion=1.0.0&platform=${Platform.UniversalPC}&status=${Status.Unverified}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods;
            for (let cmod of response.body.mods) {
                let currentMod = cmod as { mod: ModAPIPublicResponse, latest: ModVersionAPIPublicResponse };
                expect(currentMod).toHaveProperty(`mod`);
                expect(currentMod).toHaveProperty(`latest`);
                let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
                expect(dependancies.length).toBe(currentMod.latest.dependencies.length);
                expect(currentMod.latest.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
                expect(currentMod.latest.platform).toBe(Platform.UniversalPC);
                expect([Status.Verified, Status.Unverified, Status.Pending].includes(currentMod.mod.status)).toBeTruthy();
                expect([Status.Verified, Status.Unverified, Status.Pending].includes(currentMod.latest.status)).toBeTruthy();
                if (currentMod.mod.status === Status.Verified) {
                    hasSeenVerified = true;
                } else if (currentMod.mod.status === Status.Unverified) {
                    hasSeenUnverified = true;
                } else if (currentMod.mod.status === Status.Pending) {
                    haveSeenPending = true;
                }
            }
            expect(hasSeenVerified).toBeTruthy();
            expect(hasSeenUnverified).toBeTruthy();
            expect(haveSeenPending).toBeTruthy();
        });

        test.skip(`/hashlookup - contentHash`, async () => {
            let modVersion = DatabaseHelper.cache.modVersions[0];
            let contentHash = modVersion.contentHashes[0].hash;
            const response = await api.get(`/hashlookup?hash=${contentHash}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`modVersions`);
            expect(response.body.modVersions).toBeInstanceOf(Array);
            expect(response.body.modVersions.length).toBe(1);
            let apimv = response.body.modVersions[0];
            expect(apimv).toHaveProperty(`id`);
            expect(apimv).toHaveProperty(`modId`);
            expect(apimv.id).toBe(modVersion.id);
            expect(apimv.modId).toBe(modVersion.modId);
        });

        test.skip(`/hashlookup - ziphash`, async () => {
            let modVersion = DatabaseHelper.cache.modVersions[0];
            let zipHash = modVersion.zipHash;
            const response = await api.get(`/hashlookup?hash=${zipHash}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`modVersions`);
            expect(response.body.modVersions).toBeInstanceOf(Array);
            expect(response.body.modVersions.length).toBe(1);
            let apimv = response.body.modVersions[0];
            expect(apimv).toHaveProperty(`id`);
            expect(apimv).toHaveProperty(`modId`);
            expect(apimv.id).toBe(modVersion.id);
            expect(apimv.modId).toBe(modVersion.modId);
        });
    });

    describe.sequential(`Edit Mods`, () => {
        let defaultModData: Omit<ModInfer, `id` | `name` | `createdAt` | `updatedAt` | `deletedAt`>;

        beforeAll(async () => {
            defaultModData = {
                authorIds: [1],
                category: Categories.Core,
                description: `Test Description`,
                gameName: SupportedGames.BeatSaber,
                gitUrl: ``,
                iconFileName: `default.png`,
                lastApprovedById: null,
                lastUpdatedById: 1,
                status: Status.Private,
                summary: `Test Summary`,
            };


        });

        beforeEach(() => {
            shouldAuthenticateWithRole = false;
        });

        test(`/mods/:modId - priavte as author`, async () => {
            shouldAuthenticateWithRole = UserRoles.LargeFiles; // this removes admin role
            const newMod = await server.database.Mods.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [1],
            });
            const response = await api.patch(`/mods/${newMod.id}`).send({
                name: `Test Mod private author`,
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
            expect(mod.mod.name).toBe(`Test Mod private author`);
        });

        test(`/mods/:modId - priavte as non-author`, async () => {
            shouldAuthenticateWithRole = UserRoles.LargeFiles; // this removes admin role
            const newMod = await server.database.Mods.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [2],
            });
            const response = await api.patch(`/mods/${newMod.id}`).send({
                name: `Test Mod 2`,
            });
            expect(response.status).toBe(401);
        });

        test(`/mods/:modId - private as approver`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const newMod = await server.database.Mods.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [2],
            });
            const response = await api.patch(`/mods/${newMod.id}`).send({
                name: `Test Mod private approver`,
            });
            expect(response.status).toBe(200);
            const mod = response.body;
            expect(mod).toBeDefined();
            expect(mod).toHaveProperty(`mod`);
            expect(mod.mod).toHaveProperty(`name`);
            expect(mod.mod.name).toBe(`Test Mod private approver`);
        });
    });
});

const stuff = {
    get fakeName() {
        return `Test Mod ${Date.now()}`;
    }
}