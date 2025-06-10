import { test, expect, describe, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { Express } from 'express';
import { startServer } from '../../src/index.ts';
import { Server } from 'http';
import { DatabaseHelper, DatabaseManager, EditQueue, GameVersionInfer, Platform, Project, ProjectAPIPublicResponse, ProjectInfer, Status, SupportedGames, User, UserInfer, UserRoles, Version, VersionAPIPublicResponse, VersionInfer } from '../../src/shared/Database.ts';
// #region setup
const api = supertest(`http://localhost:8486/api`);
let server: Awaited<ReturnType<typeof startServer>>;
let shouldAuthenticateWithRole: UserRoles | false | true = false;

// eslint-disable-next-line quotes
import * as fakeData from '../fakeData.json' with { type: 'json' };
import { satisfies, SemVer } from 'semver';
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

type ProjectVersionPair = {
    project: ProjectAPIPublicResponse;
    version: VersionAPIPublicResponse;
};

vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendProjectLog: vi.fn(async (project: Project, userMakingChanges: User, logType: WebhookLogType, reason?:string) => {}),
        sendVersionLog: vi.fn(async (version: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project, reason?:string) => {}),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
    };
});
// #endregion

describe.sequential(`API`, async () => {
    let { sendProjectLog, sendEditLog, sendVersionLog } = await import(`../../src/shared/ModWebhooks.ts`);
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
                sendProjectLog: vi.fn(async (project: Project, userMakingChanges: User, logType: WebhookLogType) => {}),
                sendVersionLog: vi.fn(async (version: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project) => {}),
                sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
            };
        });

        process.env.NODE_ENV = `test`;
        server = await startServer();
        await server.database.Games.bulkCreate(fakeData.games.map((game) => ({
            ...game,
            createdAt: new Date(game.createdAt),
            updatedAt: new Date(game.updatedAt),
        })), { individualHooks: true });
        await server.database.GameVersions.bulkCreate(gameVersions, { individualHooks: true });
        await server.database.Projects.bulkCreate(projects, { individualHooks: true });
        await server.database.Versions.bulkCreate(versions, { individualHooks: true });
        await DatabaseHelper.refreshAllCaches();
        //console.log(JSON.stringify(server.database.serverAdmin));
        defaultModData = {
            authorIds: [1],
            category: `Core`,
            description: `Test Description`,
            gameName: `BeatSaber`,
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
            expect(response.status, response.body.message).toBe(200);
        });

        test(`/auth - no auth`, async () => {
            const response = await api.get(`/auth`);
            expect(response.status, response.body.message).toBe(401);
        });

        test(`/auth - authed`, async () => {
            shouldAuthenticateWithRole = true;
            const response = await api.get(`/auth`);
            expect(response.status, response.body.message).toBe(200);
            shouldAuthenticateWithRole = false;
        });
    });

    describe.sequential(`Get Mods`, () => {
        test(`/mods - no param`, async () => {
            const response = await api.get(`/mods`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            for (let currentMod of response.body.mods) {
                expect(currentMod).toHaveProperty(`project`);
                expect(currentMod).toHaveProperty(`version`);
            }
        });

        test(`/mods - gv only`, async () => {
            const response = await api.get(`/mods?gameVersion=1.0.0`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods as ProjectVersionPair[];
            for (let currentMod of mods) {
                expect(currentMod).toHaveProperty(`project`);
                expect(currentMod).toHaveProperty(`version`);
                let dependancies = mods.filter((mod) => mod.version.dependencies.find((dep) => dep.parentId === mod.project.id && satisfies(mod.version.modVersion, dep.sv)));
                expect(dependancies.length).toBe(currentMod.version.dependencies.length);
                expect(currentMod.version.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
            }
        });

        test(`/mods - gv and universal platform`, async () => {
            const response = await api.get(`/mods?gameVersion=1.0.0&platform=${Platform.UniversalPC}`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`mods`);
            expect(response.body.mods).toBeInstanceOf(Array);
            expect(response.body.mods.length).toBeGreaterThan(0);
            let mods = response.body.mods as ProjectVersionPair[];
            for (let currentMod of mods) {
                expect(currentMod).toHaveProperty(`project`);
                expect(currentMod).toHaveProperty(`version`);
                let dependancies = mods.filter((mod) => mod.version.dependencies.find((dep) => dep.parentId === mod.project.id && satisfies(mod.version.modVersion, dep.sv)));
                expect(dependancies.length).toBe(currentMod.version.dependencies.length);
                expect(currentMod.version.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
                expect(currentMod.version.platform).toBe(Platform.UniversalPC);
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
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toBeInstanceOf(Array);
            expect(response.body.length).toBe(1);
            let apimv = response.body[0];
            expect(apimv).toHaveProperty(`id`);
            expect(apimv).toHaveProperty(`projectId`);
            expect(apimv.id).toBe(modVersion.id);
            expect(apimv.projectId).toBe(modVersion.projectId);
        });

        test(`/hashlookup - ziphash`, async () => {
            let modVersion = DatabaseHelper.cache.versions[0];
            let zipHash = modVersion.zipHash;
            const response = await api.get(`/hashlookup?hash=${zipHash}`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toBeInstanceOf(Array);
            expect(response.body.length).toBe(1);
            let apimv = response.body[0];
            expect(apimv).toHaveProperty(`id`);
            expect(apimv).toHaveProperty(`projectId`);
            expect(apimv.id).toBe(modVersion.id);
            expect(apimv.projectId).toBe(modVersion.projectId);
        });

        test(`/multi/hashlookup - contentHash`, async () => {
            let contentHash1 = DatabaseHelper.cache.versions[0].contentHashes[0].hash;
            let contentHash2 = DatabaseHelper.cache.versions[1].contentHashes[0].hash;
            const response = await api.get(`/multi/hashlookup?hash=${contentHash1}&hash=${contentHash2}`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toBeInstanceOf(Object);
            expect(Object.keys(response.body).length).toBe(2);
            expect(response.body[contentHash1]).toBeDefined();
            expect(response.body[contentHash2]).toBeDefined();
        });

        test(`/multi/hashlookup - zipHash`, async () => {
            let zipHash1 = DatabaseHelper.cache.versions[0].zipHash;
            let zipHash2 = DatabaseHelper.cache.versions[1].zipHash;
            const response = await api.get(`/multi/hashlookup?hash=${zipHash1}&hash=${zipHash2}`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toBeInstanceOf(Object);
            expect(Object.keys(response.body).length).toBe(2);
            expect(response.body[zipHash1]).toBeDefined();
            expect(response.body[zipHash2]).toBeDefined();
        });
    });

    describe.sequential(`Edit Mods`, () => {
        beforeEach(() => {
            shouldAuthenticateWithRole = false;
        });

        test(`/projects/:projectId - priavte as author`, async () => {
            shouldAuthenticateWithRole = UserRoles.LargeFiles; // this removes admin role
            const newMod = await server.database.Projects.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [1],
            });
            const response = await api.patch(`/projects/${newMod.id}`).send({
                name: `Test Mod private author`,
                summary: `Test Summary 2`,
                description: `Test Description 2`,
                category: `Core`,
                gitUrl: `https://beatsaber.com`,
            });
            expect(response.status, response.body.message).toBe(200);
            const mod = response.body;
            expect(mod).toBeDefined();
            expect(mod).toHaveProperty(`project`);
            expect(mod.project).toHaveProperty(`name`);
            expect(mod.project.name).toBe(`Test Mod private author`);
        });

        test(`/projects/:modId - priavte as non-author`, async () => {
            shouldAuthenticateWithRole = UserRoles.LargeFiles; // this removes admin role
            const newMod = await server.database.Projects.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [2],
            });
            expect(newMod).toBeDefined();
            const response = await api.patch(`/projects/${newMod.id}`).send({
                name: `Test Mod 2`,
            });
            expect(response.status, response.body.message).toBe(401);
        });

        test(`/projects/:modId - private as approver`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const newMod = await server.database.Projects.create({
                ...defaultModData,
                name: stuff.fakeName,
                authorIds: [2],
            });
            const response = await api.patch(`/projects/${newMod.id}`).send({
                name: `Test Mod private approver`,
            });
            expect(response.status, response.body.message).toBe(200);
            const mod = response.body;
            expect(mod).toBeDefined();
            expect(mod).toHaveProperty(`project`);
            expect(mod.project).toHaveProperty(`name`);
            expect(mod.project.name).toBe(`Test Mod private approver`);
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
                category: `Core`,
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
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`edits`);
            expect(response.body.edits).toBeInstanceOf(Array);
            expect(response.body.edits.length).toBeGreaterThan(0);
            let edits = response.body.edits;
            for (let edit of edits) {
                expect(edit).toHaveProperty(`edit`);
                expect(edit).toHaveProperty(`project`);
                expect(edit).toHaveProperty(`original`);
                expect(edit.edit).toHaveProperty(`id`);
                expect(edit.project).toHaveProperty(`id`);
                expect(edit.original).toHaveProperty(`id`);
            }
        });

        test(`/approval/:queuetype - versions`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/versions?gameName=${gnToCheck}`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`versions`);
            expect(response.body.versions).toBeInstanceOf(Array);
            expect(response.body.versions.length).toBeGreaterThan(0);
            let versions = response.body.versions;
            for (let version of versions) {
                expect(version).toHaveProperty(`version`);
                expect(version).toHaveProperty(`project`);
                expect(version.version).toHaveProperty(`id`);
                expect(version.version).toHaveProperty(`projectId`);
                expect(version.version.projectId).toBe(version.project.id);
                expect(version.version).toHaveProperty(`status`);
                expect(version.version.status).toBe(Status.Pending);
            }
        });

        test(`/approval/:queuetype - versions (w/ unverified)`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/versions?gameName=${gnToCheck}&includeUnverified=true`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`versions`);
            expect(response.body.versions).toBeInstanceOf(Array);
            expect(response.body.versions.length).toBeGreaterThan(0);
            let versions = response.body.versions;
            let hasSeenUnverified = false;
            let hasSeenPending = false;
            for (let version of versions) {
                expect(version).toHaveProperty(`version`);
                expect(version).toHaveProperty(`project`);
                expect(version.project).toHaveProperty(`id`);
                expect(version.version).toHaveProperty(`projectId`);
                expect(version.version.projectId).toBe(version.project.id);
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
            const response = await api.get(`/approval/projects?gameName=${gnToCheck}`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`projects`);
            expect(response.body.projects).toBeInstanceOf(Array);
            expect(response.body.projects.length).toBeGreaterThan(0);
            let projects = response.body.projects;
            for (let project of projects) {
                expect(project).toHaveProperty(`name`);
                expect(project.name).toBeDefined();
                expect(project).toHaveProperty(`status`);
                expect(project.status).toBe(Status.Pending);
            }
        });

        test(`/approval/:queuetype - projects (w/ unverified)`, async () => {
            shouldAuthenticateWithRole = UserRoles.Approver;
            const response = await api.get(`/approval/projects?gameName=${gnToCheck}&includeUnverified=true`);
            expect(response.status, response.body.message).toBe(200);
            expect(response.body).toBeDefined();
            expect(response.body).toHaveProperty(`projects`);
            expect(response.body.projects).toBeInstanceOf(Array);
            expect(response.body.projects.length).toBeGreaterThan(0);
            let projects = response.body.projects;
            let hasSeenUnverified = false;
            let hasSeenPending = false;
            for (let project of projects) {
                expect(project).toHaveProperty(`name`);
                expect(project.name).toBeDefined();
                expect(project).toHaveProperty(`status`);
                expect(project.status).toBeOneOf([Status.Pending, Status.Unverified]);
                if (project.status === Status.Unverified) {
                    hasSeenUnverified = true;
                } else if (project.status === Status.Pending) {
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
                await testStatusChange(testMod, init, action, expected, sendProjectLog)();
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
                await testStatusChange(testModVersion, init, action, expected, sendVersionLog)();
            })
        });
    });

    describe.sequential.skip(`Games`, () => {
    });
});

async function testGetMod(statuses:Status[], statusString:string) {
    let seenStatuses: Status[] = [];
    const response = await api.get(`/mods?gameVersion=1.0.0&platform=${Platform.UniversalPC}&status=${statusString}`);
    expect(response.status, response.body.message).toBe(200);
    expect(response.body).toHaveProperty(`mods`);
    expect(response.body.mods).toBeInstanceOf(Array);
    expect(response.body.mods.length).toBeGreaterThan(0);
    let mods = response.body.mods as ProjectVersionPair[];
    for (let currentMod of mods) {
        expect(currentMod).toHaveProperty(`project`);
        expect(currentMod).toHaveProperty(`version`);
        let dependancies = mods.filter((mod) => mod.version.dependencies.find((dep) => dep.parentId === mod.project.id && satisfies(mod.version.modVersion, dep.sv)));
        expect(dependancies.length).toBe(currentMod.version.dependencies.length);
        expect(currentMod.version.supportedGameVersions.find((gv) => gv.version === `1.0.0`)).toBeDefined();
        expect(currentMod.version.platform).toBe(Platform.UniversalPC);
        expect(statuses.includes(currentMod.project.status)).toBeTruthy();
        expect(statuses.includes(currentMod.version.status)).toBeTruthy();
        if (seenStatuses.includes(currentMod.project.status) === false) {
            seenStatuses.push(currentMod.version.status);
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
        expect(response.status, response.body.message).toBe(200);
        expect(response.body).toBeDefined();
        expect(response.body).toHaveProperty(`message`);
        expect(response.body.message).toBe(`${type == `project` ? `Project` : `Version`} ${toStatus}.`);
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