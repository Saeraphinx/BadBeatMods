import { test, expect, describe, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Express } from 'express';
import { startServer } from '../../src/index.ts';
import { Server } from 'http';
import { Categories, DatabaseHelper, DatabaseManager, EditQueue, GameVersionInfer, Platform, Project, ProjectAPIPublicResponse, ProjectInfer, Status, SupportedGames, User, UserInfer, UserRoles, Version, VersionAPIPublicResponse, VersionInfer } from '../../src/shared/Database.ts';
// #region setup
const api = supertest(`http://localhost:8486/api`);
let server: Awaited<ReturnType<typeof startServer>>;
let shouldAuthenticateWithRole: UserRoles | false | true = false;

// eslint-disable-next-line quotes
import * as fakeData from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { WebhookLogType } from '../../src/shared/ModWebhooks.ts';
import { ApprovalAction } from '../../src/api/routes/approval.ts';

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

let projects: ProjectInfer[] = [];
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

let versions: VersionInfer[] = [];
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
        sendModLog: vi.fn(async (mod: Project, userMakingChanges: User, logType: WebhookLogType, reason?:string) => {}),
        sendModVersionLog: vi.fn(async (modVersion: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project, reason?:string) => {}),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
    };
});
// #endregion

describe.sequential(`API`, async () => {
    let { sendModLog, sendEditLog, sendModVersionLog } = await import(`../../src/shared/ModWebhooks.ts`);
    let defaultModData: Omit<ProjectInfer, `id` | `name` | `createdAt` | `updatedAt` | `deletedAt`>;

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
                sendModLog: vi.fn(async (mod: Project, userMakingChanges: User, logType: WebhookLogType) => {}),
                sendModVersionLog: vi.fn(async (modVersion: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project) => {}),
                sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
            };
        });

        process.env.NODE_ENV = `test`;
        server = await startServer();
        await server.database.GameVersions.bulkCreate(gameVersions, { individualHooks: true });
        await server.database.Projects.bulkCreate(projects, { individualHooks: true });
        await server.database.Versions.bulkCreate(versions, { individualHooks: true });
        await DatabaseHelper.refreshAllCaches();
        //console.log(JSON.stringify(server.database.serverAdmin));
        defaultModData = {
            authorIds: [1],
            category: Categories.Core,
            description: `Test Description`,
            gameName: SupportedGames.BeatSaber,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            statusHistory: [],
            lastUpdatedById: 1,
            status: Status.Private,
            summary: `Test Summary`,
        };
    });

    afterAll(async () => {
        // wait a few seconds for the server to finish processing requests that request a cache refresh
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
                let currentMod = cmod as { mod: ProjectAPIPublicResponse, latest: VersionAPIPublicResponse };
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
                let currentMod = cmod as { mod: ProjectAPIPublicResponse, latest: VersionAPIPublicResponse };
                expect(currentMod).toHaveProperty(`mod`);
                expect(currentMod).toHaveProperty(`latest`);
                let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
                expect(dependancies.length).toBe(currentMod.latest.dependencies.length);
                expect(currentMod.latest.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
                expect(currentMod.latest.platform).toBe(Platform.UniversalPC);
            }
        });

        test.each([
            `all`,
            `${Status.Verified}`,
            `${Status.Unverified}`,
            `${Status.Pending}`
        ])(`/mods - gv, platform and status %s`, async (statusString, statuses) => {
            let exepectedStatuses: Status[] = [];
            switch (statusString) {
                case `all`:
                    exepectedStatuses = [Status.Verified, Status.Unverified, Status.Pending];
                    break;
                case `${Status.Verified}`:
                    exepectedStatuses = [Status.Verified];
                    break;
                case `${Status.Unverified}`:
                    exepectedStatuses = [Status.Verified, Status.Unverified];
                    break;
                case `${Status.Pending}`:
                    exepectedStatuses = [Status.Verified, Status.Pending];
                    break;
            }
            await testGetMod(exepectedStatuses, statusString.toString());
        });

        test(`/hashlookup - contentHash`, async () => {
            let modVersion = DatabaseHelper.cache.versions[0];
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
            expect(apimv.modId).toBe(modVersion.projectId);
        });

        test(`/hashlookup - ziphash`, async () => {
            let modVersion = DatabaseHelper.cache.versions[0];
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
            expect(apimv.modId).toBe(modVersion.projectId);
        });

        test(`/multi/hashlookup - contentHash`, async () => {
            let contentHash1 = DatabaseHelper.cache.versions[0].contentHashes[0].hash;
            let contentHash2 = DatabaseHelper.cache.versions[1].contentHashes[0].hash;
            const response = await api.get(`/multi/hashlookup?hash=${contentHash1}&hash=${contentHash2}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`hashes`);
            expect(response.body.hashes).toBeInstanceOf(Object);
            expect(Object.keys(response.body.hashes).length).toBe(2);
            expect(response.body.hashes[contentHash1]).toBeDefined();
            expect(response.body.hashes[contentHash2]).toBeDefined();
        });

        test(`/multi/hashlookup - zipHash`, async () => {
            let zipHash1 = DatabaseHelper.cache.versions[0].zipHash;
            let zipHash2 = DatabaseHelper.cache.versions[1].zipHash;
            const response = await api.get(`/multi/hashlookup?hash=${zipHash1}&hash=${zipHash2}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`hashes`);
            expect(response.body.hashes).toBeInstanceOf(Object);
            expect(Object.keys(response.body.hashes).length).toBe(2);
            expect(response.body.hashes[zipHash1]).toBeDefined();
            expect(response.body.hashes[zipHash2]).toBeDefined();
        });
    });

    describe.sequential(`Edit Mods`, () => {
        beforeEach(() => {
            shouldAuthenticateWithRole = false;
        });

        test(`/mods/:modId - priavte as author`, async () => {
            shouldAuthenticateWithRole = UserRoles.LargeFiles; // this removes admin role
            const newMod = await server.database.Projects.create({
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
            const newMod = await server.database.Projects.create({
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
            const newMod = await server.database.Projects.create({
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

    describe.sequential(`Approval`, () => {
        let defaultMod: Project;
        let defaultVersion: Version;
        let modEdit: EditQueue;
        let versionEdit: EditQueue;
        let gnToCheck = gameVersions[0].gameName;
        beforeAll(async () => {
            defaultMod = await server.database.Projects.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [1],
                gameName: gameVersions[0].gameName, // surely this will be the same gamename
                status: Status.Verified
            });
            defaultVersion = await server.database.Versions.create({
                ...versions[0],
                supportedGameVersionIds: [gameVersions[0].id],
                id: undefined,
                projectId: defaultMod.id,
                zipHash: `123456789`,
                status: Status.Verified,
            });
            modEdit = await defaultMod.edit({
                category: Categories.Core,
            }, server.database.serverAdmin).then((edit) => {
                if (edit.isEditObj) {
                    return edit.edit;
                } else {
                    throw new Error(`Failed to create edit.`);
                }
            });
            versionEdit = await defaultVersion.edit({
                modVersion: new SemVer(`1.0.1879`),
            }, server.database.serverAdmin).then((edit) => {
                if (edit.isEditObj) {
                    return edit.edit;
                } else {
                    throw new Error(`Failed to create edit.`);
                }
            });
            await DatabaseHelper.refreshAllCaches();
        });

        test(`/approval/:queuetype - edits`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/edits?gameName=${gnToCheck}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`edits`);
            expect(response.body.edits).toBeInstanceOf(Array);
            expect(response.body.edits.length).toBeGreaterThan(0);
            let edits = response.body.edits;
            for (let edit of edits) {
                expect(edit).toHaveProperty(`edit`);
                expect(edit).toHaveProperty(`mod`);
                expect(edit).toHaveProperty(`original`);
                expect(edit.edit).toHaveProperty(`id`);
                expect(edit.mod).toHaveProperty(`id`);
                expect(edit.original).toHaveProperty(`id`);
            }
        });

        test(`/approval/:queuetype - versions`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/modVersions?gameName=${gnToCheck}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`modVersions`);
            expect(response.body.modVersions).toBeInstanceOf(Array);
            expect(response.body.modVersions.length).toBeGreaterThan(0);
            let modVersions = response.body.modVersions;
            for (let version of modVersions) {
                expect(version).toHaveProperty(`version`);
                expect(version).toHaveProperty(`mod`);
                expect(version.mod).toHaveProperty(`id`);
                expect(version.version).toHaveProperty(`modId`);
                expect(version.version.modId).toBe(version.mod.id);
                expect(version.version).toHaveProperty(`status`);
                expect(version.version.status).toBe(Status.Pending);
            }
        });

        test(`/approval/:queuetype - versions (w/ unverified)`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/modVersions?gameName=${gnToCheck}&includeUnverified=true`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`modVersions`);
            expect(response.body.modVersions).toBeInstanceOf(Array);
            expect(response.body.modVersions.length).toBeGreaterThan(0);
            let modVersions = response.body.modVersions;
            let hasSeenUnverified = false;
            let hasSeenPending = false;
            for (let version of modVersions) {
                expect(version).toHaveProperty(`version`);
                expect(version).toHaveProperty(`mod`);
                expect(version.mod).toHaveProperty(`id`);
                expect(version.version).toHaveProperty(`modId`);
                expect(version.version.modId).toBe(version.mod.id);
                expect(version.version).toHaveProperty(`status`);
                expect(version.version.status).toBeOneOf([Status.Pending, Status.Unverified]);
                if (version.version.status === Status.Unverified) {
                    hasSeenUnverified = true;
                } else if (version.version.status === Status.Pending) {
                    hasSeenPending = true;
                }
            }
            expect(hasSeenUnverified).toBeTruthy();
            expect(hasSeenPending).toBeTruthy();
        });

        test(`/approval/:queuetype - projects`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/mods?gameName=${gnToCheck}`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods;
            for (let mod of mods) {
                expect(mod).toHaveProperty(`name`);
                expect(mod.name).toBeDefined();
                expect(mod).toHaveProperty(`status`);
                expect(mod.status).toBe(Status.Pending);
            }
        });

        test(`/approval/:queuetype - projects (w/ unverified)`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/mods?gameName=${gnToCheck}&includeUnverified=true`);
            expect(response.status).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods;
            let hasSeenUnverified = false;
            let hasSeenPending = false;
            for (let mod of mods) {
                expect(mod).toHaveProperty(`name`);
                expect(mod.name).toBeDefined();
                expect(mod).toHaveProperty(`status`);
                expect(mod.status).toBeOneOf([Status.Pending, Status.Unverified]);
                if (mod.status === Status.Unverified) {
                    hasSeenUnverified = true;
                } else if (mod.status === Status.Pending) {
                    hasSeenPending = true;
                }
            }
            expect(hasSeenUnverified).toBeTruthy();
            expect(hasSeenPending).toBeTruthy();
        });

        describe.sequential(`Mod Status Changes`, () => {
            let testMod: Project;
            let testModVersion: Version;
            beforeAll(async () => {
                testMod = await server.database.Projects.create({
                    ...defaultModData,
                    name: stuff.fakeName,
                    authorIds: [1],
                    gameName: gameVersions[0].gameName, // surely this will be the same gamename
                    status: Status.Pending
                });
                testModVersion = await server.database.Versions.create({
                    ...versions[0],
                    supportedGameVersionIds: [gameVersions[0].id],
                    id: undefined,
                    projectId: testMod.id,
                    zipHash: `123456789`,
                    status: Status.Pending,
                });
            });

            test.each([
                [Status.Pending, ApprovalAction.Accept, Status.Verified],
                [Status.Unverified, ApprovalAction.Accept, Status.Verified],
                [Status.Verified, ApprovalAction.Accept, Status.Verified],
                [Status.Pending, ApprovalAction.Deny, Status.Unverified],
                [Status.Unverified, ApprovalAction.Deny, Status.Unverified],
                [Status.Verified, ApprovalAction.Deny, Status.Unverified],
                [Status.Pending, ApprovalAction.Remove, Status.Removed],
                [Status.Unverified, ApprovalAction.Remove, Status.Removed],
                [Status.Verified, ApprovalAction.Remove, Status.Removed],
            ])('/approval/mod/:modIdParam/approve - %s %s -> %s', async (init, action, expected) => {
                await testStatusChange(testMod, init, action, expected, sendModLog)();
            })

            test.each([
                [Status.Pending, ApprovalAction.Accept, Status.Verified],
                [Status.Unverified, ApprovalAction.Accept, Status.Verified],
                [Status.Verified, ApprovalAction.Accept, Status.Verified],
                [Status.Pending, ApprovalAction.Deny, Status.Unverified],
                [Status.Unverified, ApprovalAction.Deny, Status.Unverified],
                [Status.Verified, ApprovalAction.Deny, Status.Unverified],
                [Status.Pending, ApprovalAction.Remove, Status.Removed],
                [Status.Unverified, ApprovalAction.Remove, Status.Removed],
                [Status.Verified, ApprovalAction.Remove, Status.Removed],
            ])('/approval/modversion/:modIdParam/approve - %s %s -> %s', async (init, action, expected) => {
                await testStatusChange(testModVersion, init, action, expected, sendModVersionLog)();
            })
        });
    });
});

async function testGetMod(statuses:Status[], statusString:string) {
    let seenStatuses: Status[] = [];
    const response = await api.get(`/mods?gameVersion=1.0.0&platform=${Platform.UniversalPC}&status=${statusString}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty(`mods`);
    expect(response.body).toBeDefined();
    expect(response.body.mods.length).toBeGreaterThan(0);
    expect(response.body.mods).toBeInstanceOf(Array);
    let mods = response.body.mods;
    for (let cmod of response.body.mods) {
        let currentMod = cmod as { mod: ProjectAPIPublicResponse, latest: VersionAPIPublicResponse };
        expect(currentMod).toHaveProperty(`mod`);
        expect(currentMod).toHaveProperty(`latest`);
        let dependancies = mods.filter((mod) => currentMod.latest.dependencies.includes(mod.latest.id));
        expect(dependancies.length).toBe(currentMod.latest.dependencies.length);
        expect(currentMod.latest.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
        expect(currentMod.latest.platform).toBe(Platform.UniversalPC);
        expect(statuses.includes(currentMod.mod.status)).toBeTruthy();
        expect(statuses.includes(currentMod.latest.status)).toBeTruthy();
        if (seenStatuses.includes(currentMod.mod.status) === false) {
            seenStatuses.push(currentMod.mod.status);
        }
    }
    for (let status of statuses) {
        expect(seenStatuses.includes(status)).toBeTruthy();
    }
    for (let status of seenStatuses) {
        expect(statuses.includes(status)).toBeTruthy();
    }
}

function testStatusChange(testMod:Project|Version, fromStatus:Status, action:ApprovalAction, toStatus:Status, logAction:Function) {
    return async () => {
        shouldAuthenticateWithRole = UserRoles.Approver;
        testMod.status = fromStatus;
        await testMod.save();
        let type = testMod instanceof Project ? `project` : `version`;
        const response = await api.post(`/approval/${type}/${testMod.id}/approve`).send({
            action: action,
        });
        expect(response.status).toBe(200);
        expect(response.body).toBeDefined();
        expect(response.body).toHaveProperty(`message`);
        expect(response.body.message).toBe(`${type == `mod` ? `Mod` : `ModVersion`} ${toStatus}.`);
        expect(logAction).toHaveBeenCalled();
        await testMod.reload();
        expect(testMod.status).toBe(toStatus);
    }
}

const stuff = {
    get fakeName() {
        return `Test Mod ${Date.now()}`;
    }
}