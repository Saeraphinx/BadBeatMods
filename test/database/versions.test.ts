import { test, expect, beforeAll, afterAll, beforeEach, describe, afterEach, vi } from 'vitest';
import { DatabaseManager, GameVersion, Status, SupportedGames, Platform, User, DatabaseHelper, UserRoles, EditQueue, Version, VersionInfer, Project, ProjectInfer, Game } from '../../src/shared/Database.ts';
import { UniqueConstraintError } from 'sequelize';
// eslint-disable-next-line quotes
import { projects, users, games } from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { faker } from '@faker-js/faker';
import { WebhookLogType } from '../../src/shared/ModWebhooks.ts';


vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendProjectLog: vi.fn(async (project: Project, userMakingChanges: User, logType: WebhookLogType, reason?:string) => {}),
        sendVersionLog: vi.fn(async (version: VersionInfer, userMakingChanges: User, logType: WebhookLogType, modObj?: Project, reason?:string) => {}),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => {}),
    };
});

describe.sequential(`Versions - Hooks`, async () => {
    let db: DatabaseManager;
    let testMod1: Project;
    let testMod2: Project;
    let testModGV: GameVersion[];
    let testGames: Game[];
    let defaultVersionData: Omit<VersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        try {
            testGames = await db.Games.bulkCreate(games.map((game) => ({
                ...game,
                createdAt: new Date(game.createdAt),
                updatedAt: new Date(game.updatedAt),
            })));
            await DatabaseHelper.refreshCache(`games`);

            testModGV = await db.GameVersions.bulkCreate([
                {
                    gameName: `BeatSaber`,
                    version: `1.0.0`,
                    defaultVersion: true,
                },
                {
                    gameName: `BeatSaber`,
                    version: `1.1.0`,
                    defaultVersion: false,
                }
            ]);

            testMod1 = await db.Projects.create({
                ...projects[0],
                gameName: `BeatSaber`,
                status: projects[0].status as Status,
                category: projects[0].category,
                authorIds: [1],
                createdAt: new Date(projects[0].createdAt),
                updatedAt: new Date(projects[0].updatedAt),
            });
            testModGV = await db.GameVersions.findAll({ where: { gameName: testMod1.gameName } });
            testMod2 = await db.Projects.create({
                ...projects[1],
                gameName: `BeatSaber`,
                status: projects[0].status as Status,
                category: projects[0].category,
                authorIds: [1],
                createdAt: new Date(projects[0].createdAt),
                updatedAt: new Date(projects[0].updatedAt),
            });
            defaultVersionData = {
                projectId: testMod1.id,
                authorId: 1,
                modVersion: new SemVer(`0.0.1`),
                platform: Platform.UniversalPC,
                lastUpdatedById: 1,
                supportedGameVersionIds: [1],
                status: Status.Private,
                contentHashes: [],
                zipHash: faker.git.commitSha(),
                dependencies: [],
                fileSize: 0,
                statusHistory: [],
                downloadCount: 0,
                lastApprovedById: null
            };
        } catch (e) {
            if (e instanceof UniqueConstraintError) {
                console.log(e);
            }
            throw e;
        }
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Versions.truncate();
    });

    test(`able to create mod w/o dependencies`, async () => {
        /*let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
        });*/
        let testVersion = await db.Versions.create({
            ...defaultVersionData,
        });
        expect(testVersion).toBeDefined();
    });

    test(`able to create mod w/ dependencies`, async () => {
        let testVersion = await db.Versions.create({
            ...defaultVersionData,
        });
        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            projectId: testMod2.id,
            modVersion: new SemVer(`1.0.0`),
            dependencies: [{
                parentId: testVersion.projectId,
                sv: `^${testVersion.modVersion}`,
            }],
        });
        expect(modVersion).toBeDefined();
    });

    test(`does not allow duplicate dependencies`, async () => {
        let testVersion = await db.Versions.create({
            ...defaultVersionData,
        });
        let modVersion = db.Versions.create({
            ...defaultVersionData,
            projectId: testMod2.id,
            modVersion: new SemVer(`1.0.0`),
            dependencies: [{
                parentId: testVersion.projectId,
                sv: `^${testVersion.modVersion}`,
            },{
                parentId: testVersion.projectId,
                sv: `^${testVersion.modVersion}`,
            }],
        });
        await expect(modVersion).rejects.toThrow();
    });

    test(`does not allow invalid dependencies`, async () => {
        await expect(async () => {
            await db.Versions.create({
                ...defaultVersionData,
                projectId: testMod2.id,
                modVersion: new SemVer(`1.0.0`),
                // @ts-expect-error
                dependencies: [999],
            });
        }).rejects.toThrow();

        await expect(async () => {
            await db.Versions.create({
                ...defaultVersionData,
                projectId: testMod2.id,
                modVersion: new SemVer(`1.0.0`),
                dependencies: [{
                    parentId: 123456789,
                    sv: `^1.0.0`,
                }],
            });
        }).rejects.toThrow();

        await expect(async () => {
            await db.Versions.create({
                ...defaultVersionData,
                projectId: testMod2.id,
                modVersion: new SemVer(`1.0.0`),
                dependencies: [{
                    parentId: testMod1.id,
                    sv: `not valid semver`,
                }],
            });
        }).rejects.toThrow();
    });

    test(`does not allow for dependency on self`, async () => {
        let modVersion = await db.Versions.create({
            ...defaultVersionData,
        });

        modVersion.dependencies = [{
            parentId: modVersion.id,
            sv: `^${modVersion.modVersion}`,
        }];
        await expect(modVersion.save()).rejects.toThrow();
    });

    test(`sorts game versions by semver`, async () => {
        let firstVersion = testModGV[0];
        let secondVersion = testModGV[1];
        
        expect(firstVersion.version).toBe(`1.0.0`);
        expect(secondVersion.version).toBe(`1.1.0`);

        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            modVersion: new SemVer(`1.0.0`),
            supportedGameVersionIds: [secondVersion.id, firstVersion.id],
        });

        expect(modVersion.supportedGameVersionIds).toBeDefined();
        expect(modVersion.supportedGameVersionIds).toHaveLength(2);
        expect(modVersion.supportedGameVersionIds[0]).toBe(firstVersion.id);
        expect(modVersion.supportedGameVersionIds[1]).toBe(secondVersion.id);
    });

    test(`does not allow invalid game versions`, async () => {
        await expect(async () => {
            await db.Versions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                supportedGameVersionIds: [1, 999],
            });
        }).rejects.toThrow();
    });

    test(`removes duplicate game versions`, async () => {
        let firstVersion = testModGV[0];

        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            modVersion: new SemVer(`1.0.0`),
            supportedGameVersionIds: [firstVersion.id, firstVersion.id],
        });

        expect(modVersion.supportedGameVersionIds).toBeDefined();
        expect(modVersion.supportedGameVersionIds).toHaveLength(1);
        expect(modVersion.supportedGameVersionIds[0]).toBe(firstVersion.id);
    });

    test(`requires at least one game version`, async () => {
        await expect(async () => {
            await db.Versions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                supportedGameVersionIds: [],
            });
        }).rejects.toThrow();
    });

    test(`removes "v" from version string`, async () => {
        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            modVersion: new SemVer(`v1.0.0`),
            supportedGameVersionIds: [testModGV[0].id],
        });

        expect(modVersion.modVersion.raw).toBe(`1.0.0`);
    });
});

describe.sequential(`Versions - Permissions`, async () => {
    let db: DatabaseManager;
    let testUser1: User;
    let testUser2: User;
    let testMod1: Project;
    let testMod2: Project;
    let testGv1: GameVersion;
    let testGv2: GameVersion;
    let defaultVersionData: Omit<VersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`> = {
        projectId: 1,
        authorId: 1,
        modVersion: new SemVer(`0.0.1`),
        platform: Platform.UniversalPC,
        lastUpdatedById: 1,
        supportedGameVersionIds: [1],
        status: Status.Private,
        contentHashes: [],
        zipHash: faker.git.commitSha(),
        dependencies: [],
        fileSize: 0,
        downloadCount: 0,
        statusHistory: [],
        lastApprovedById: null
    };

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        await db.Games.bulkCreate(games.map((game) => ({
                ...game,
                createdAt: new Date(game.createdAt),
                updatedAt: new Date(game.updatedAt),
        })));
        await DatabaseHelper.refreshCache(`games`);
        testUser1 = await db.Users.create({
            ...users[0],
            roles: {sitewide: [], perGame: {}},
            createdAt: new Date(users[0].createdAt),
            updatedAt: new Date(users[0].updatedAt),
        });
        testUser2 = await db.Users.create({
            ...users[1],
            roles: {sitewide: [], perGame: {}},
            createdAt: new Date(users[1].createdAt),
            updatedAt: new Date(users[1].updatedAt),
        });
        testGv1 = await db.GameVersions.create({
            gameName: `BeatSaber`,
            version: `1.0.0`,
            defaultVersion: true,
        });
        testGv2 = await db.GameVersions.create({
            gameName: `BeatSaber`,
            version: `1.1.0`,
            defaultVersion: false,
        });
        testMod1 = await db.Projects.create({
            ...projects[0],
            gameName: `BeatSaber`,
            status: Status.Verified,
            category: projects[0].category,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        testMod2 = await db.Projects.create({
            ...projects[1],
            gameName: `BeatSaber`,
            status: Status.Verified,
            category: projects[0].category,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    afterEach(async () => {
        db.Versions.truncate();
        testUser1 = await testUser1.reload();
        testUser2 = await testUser2.reload();
        // Do not restore data for the NR user.
        vi.resetAllMocks();
    });

    test.each([
        [Status.Private, true, "author"],
        [Status.Private, true, UserRoles.AllPermissions],
        [Status.Private, true, UserRoles.Admin],
        [Status.Private, true, UserRoles.Approver],
        [Status.Private, true, UserRoles.GameManager],
        [Status.Private, false, null],
        [Status.Pending, true, "author"],
        [Status.Pending, true, UserRoles.AllPermissions],
        [Status.Pending, true, UserRoles.Admin],
        [Status.Pending, true, UserRoles.Approver],
        [Status.Pending, true, UserRoles.GameManager],
        [Status.Pending, true, null],
        [Status.Unverified, true, null],
        [Status.Verified, true, null],
        [Status.Removed, true, "author"],
        [Status.Removed, true, UserRoles.AllPermissions],
        [Status.Removed, true, UserRoles.Admin],
        [Status.Removed, true, UserRoles.Approver],
        [Status.Removed, true, UserRoles.GameManager],
        [Status.Removed, false, null],
    ])(`%s isAllowedToView %s for %s`, async (status, expected, role) => {
        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            projectId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
            authorId: testUser1.id,
            status: status as Status,
        });

        vi.spyOn(Project.prototype, `isAllowedToView`);
        let testUser: User | undefined;
        let shouldCheckPerGame = false;
        if (role === "author") {
            testUser = testUser1;
        } else if (role === null) {
            testUser = undefined;
        } else {
            shouldCheckPerGame = true;
            testUser2.roles = {sitewide: [role as UserRoles], perGame: {}} ;
            testUser = testUser2;
        }
        let isAllowed = await modVersion.isAllowedToView(testUser);
        expect(isAllowed).toEqual(expected); // check sitewide roles
        expect(testMod1.isAllowedToView).toHaveBeenCalledTimes(1);

        if (shouldCheckPerGame) {
            testUser2.roles = {sitewide: [], perGame: {
                [`BeatSaber`]: [role as UserRoles]
            }};

            isAllowed = await modVersion.isAllowedToView(testUser2);
            expect(isAllowed).toEqual(expected); // check per game roles
            expect(testMod1.isAllowedToView).toHaveBeenCalledTimes(2);
        }
    });

    test.each([
        ["author", true],
        [UserRoles.AllPermissions, true],
        [UserRoles.Admin, false],
        [UserRoles.Approver, true],
        [UserRoles.GameManager, false],
        [null, false],
    ])(`isAllowedToEdit for %s is %s`, async (role, expected) => {
        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            projectId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
            authorId: testUser1.id,
        });

        let testUser;
        vi.spyOn(Project.prototype, `isAllowedToView`);
        vi.spyOn(Version.prototype, `isAllowedToView`);
        let shouldCheckPerGame = false;
        if (role === "author") {
            testUser = testUser1;
        } else if (role === null) {
            testUser = undefined;
        } else {
            shouldCheckPerGame = true;
            testUser2.roles = {sitewide: [role as UserRoles], perGame: {}} ;
            testUser = testUser2;
        }
        let isAllowed = await modVersion.isAllowedToEdit(testUser);
        expect(isAllowed).toEqual(expected); // check sitewide roles
        if (isAllowed) {
            expect(Version.prototype.isAllowedToView).toHaveBeenCalledTimes(1);
            expect(Project.prototype.isAllowedToView).toHaveBeenCalledTimes(2);
        }

        if (shouldCheckPerGame) {
            testUser2.roles = {sitewide: [], perGame: {
                [`BeatSaber`]: [role as UserRoles]
            }};

            isAllowed = await modVersion.isAllowedToEdit(testUser);
            expect(isAllowed).toEqual(expected); // check per game roles
            if (isAllowed) {
                expect(Version.prototype.isAllowedToView).toHaveBeenCalledTimes(2);
                expect(Project.prototype.isAllowedToView).toHaveBeenCalledTimes(4);
            }
        }
    });
});

describe.sequential(`Versions - Editing`, async () => {
    let db: DatabaseManager;
    let testUser1: User;
    let testUser2: User;
    let testMod1: Project;
    let testMod2: Project;
    let testGv1: GameVersion;
    let testGv2: GameVersion;
    let defaultVersionData: Omit<VersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
    let { sendProjectLog, sendEditLog, sendVersionLog } = await import(`../../src/shared/ModWebhooks.ts`);

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        await db.Games.bulkCreate(games.map((game) => ({
                ...game,
                createdAt: new Date(game.createdAt),
                updatedAt: new Date(game.updatedAt),
        })));
        await DatabaseHelper.refreshCache(`games`);
        testUser1 = await db.Users.create({
            ...users[0],
            roles: {sitewide: [], perGame: {}},
            createdAt: new Date(users[0].createdAt),
            updatedAt: new Date(users[0].updatedAt),
        });
        testUser2 = await db.Users.create({
            ...users[1],
            roles: {sitewide: [], perGame: {}},
            createdAt: new Date(users[1].createdAt),
            updatedAt: new Date(users[1].updatedAt),
        });
        testGv1 = await db.GameVersions.create({
            gameName: `BeatSaber`,
            version: `1.0.0`,
            defaultVersion: true,
        });
        testGv2 = await db.GameVersions.create({
            gameName: `BeatSaber`,
            version: `1.1.0`,
            defaultVersion: false,
        });
        testMod1 = await db.Projects.create({
            ...projects[0],
            gameName: `BeatSaber`,
            status: Status.Verified,
            category: projects[0].category,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        testMod2 = await db.Projects.create({
            ...projects[1],
            gameName: `BeatSaber`,
            status: Status.Verified,
            category: projects[0].category,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        defaultVersionData = {
            projectId: testMod1.id,
            authorId: 1,
            modVersion: new SemVer(`0.0.1`),
            platform: Platform.UniversalPC,
            lastUpdatedById: 1,
            supportedGameVersionIds: [1],
            status: Status.Private,
            contentHashes: [],
            zipHash: faker.git.commitSha(),
            dependencies: [],
            fileSize: 0,
            downloadCount: 0,
            statusHistory: [],
            lastApprovedById: null
        };
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Versions.truncate();
        testUser1 = await testUser1.reload();
        testUser2 = await testUser2.reload();
    });

    test.each([
        //expected status switches
        [Status.Private, Status.Pending, WebhookLogType.SetToPending],
        [Status.Pending, Status.Verified, WebhookLogType.Verified],
        [Status.Pending, Status.Unverified, WebhookLogType.RejectedUnverified],
        [Status.Pending, Status.Removed, WebhookLogType.Removed],
        [Status.Unverified, Status.Verified, WebhookLogType.Verified],
        [Status.Unverified, Status.Removed, WebhookLogType.Removed],

        //less expected status switches, but still supported
        [Status.Verified, Status.Pending, WebhookLogType.VerificationRevoked],
        [Status.Verified, Status.Unverified, WebhookLogType.VerificationRevoked],
        [Status.Verified, Status.Removed, WebhookLogType.VerificationRevoked],
    ])(`status %s -> %s should send %s log`, async (currStatus, newStatus, expectedLogType) => {
        let modVersion = await db.Versions.create({
            ...defaultVersionData,
            status: currStatus,
        });

        await modVersion.setStatus(newStatus, testUser1, `test`);
        expect(modVersion.status).toBe(newStatus);
        expect(sendVersionLog).toHaveBeenCalledTimes(2);
        expect(sendVersionLog).toHaveBeenNthCalledWith(1, modVersion, testUser1, WebhookLogType.Text_StatusChanged);
        expect(sendVersionLog).toHaveBeenNthCalledWith(2, modVersion, testUser1, expectedLogType, undefined, `test`);
    });
});