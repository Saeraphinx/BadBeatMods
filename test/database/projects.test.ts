import { faker } from "@faker-js/faker";
import { SemVer } from "semver";
import { projects, users, games } from '../fakeData.json' with { type: 'json' };
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseManager, GameVersion, SupportedGames, Platform, Status, GameVersionInfer, UserInfer, DatabaseHelper, User, UserRoles, EditQueue, Project, Version, ProjectInfer, VersionInfer } from "../../src/shared/Database";
import { WebhookLogType } from "../../src/shared/ModWebhooks.ts";

vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendProjectLog: vi.fn(async (project: Project, userMakingChanges: User, logType: WebhookLogType, reason?: string) => { }),
        sendVersionLog: vi.fn(async (version: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project, reason?: string) => { }),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) => { }),
    };
});

describe.sequential(`Projects - Hooks`, async () => {
    let db: DatabaseManager;
    let defaultModData: Omit<ProjectInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        await db.Games.bulkCreate(games.map((game) => ({
            ...game,
            createdAt: new Date(game.createdAt),
            updatedAt: new Date(game.updatedAt),
        })));
        defaultModData = {
            authorIds: [1],
            category: `Core`,
            description: `Test Description`,
            gameName: `BeatSaber`,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            lastUpdatedById: 1,
            name: `Test Mod`,
            status: Status.Private,
            statusHistory: [],
            summary: `Test Summary`,
        };
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Projects.truncate();
    });

    test(`no duplicate mod name`, async () => {
        let mod1 = await db.Projects.create({
            ...defaultModData,
            name: `Test Mod`,
        });

        expect(mod1).toBeDefined();
        await expect(async () => {
            await db.Projects.create({
                ...defaultModData,
                name: `Test Mod`,
            });
        }).rejects.toThrow();
    });

    test(`require authorIds`, async () => {
        await expect(async () => {
            await db.Projects.create({
                ...defaultModData,
                authorIds: [],
            });
        }).rejects.toThrow();
    });
});

describe.sequential(`Projects - Getting Mods`, async () => {
    let db: DatabaseManager;
    let testGV1: GameVersion;
    let testGV2: GameVersion;
    let defaultModData: Omit<ProjectInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
    let defaultVersionData: Omit<VersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
    let defaultGameVersionData: Omit<GameVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        await db.Games.bulkCreate(games.map((game) => ({
            ...game,
            createdAt: new Date(game.createdAt),
            updatedAt: new Date(game.updatedAt),
        })));
        await DatabaseHelper.refreshCache(`games`);
        defaultModData = {
            authorIds: [1],
            category: `Core`,
            description: `Test Description`,
            gameName: games[0].name,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            lastUpdatedById: 1,
            name: `Test Mod`,
            status: Status.Private,
            statusHistory: [],
            summary: `Test Summary`,
        };

        defaultGameVersionData = {
            gameName: games[0].name,
            version: `1.29.1`,
            defaultVersion: true,
            linkedVersionIds: [],
        };

        testGV1 = await db.GameVersions.create(defaultGameVersionData);
        testGV2 = await db.GameVersions.create({
            ...defaultGameVersionData,
            version: `1.29.4`,
        });

        defaultVersionData = {
            supportedGameVersionIds: [testGV1.id, testGV2.id],
            platform: Platform.UniversalPC,
            status: Status.Private,
            modVersion: new SemVer(`1.0.0`),
            projectId: 1,
            zipHash: faker.string.alphanumeric(14),
            fileSize: 1000,
            authorId: 1,
            dependencies: [],
            contentHashes: [],
            downloadCount: 0,
            lastApprovedById: null,
            statusHistory: [],
            lastUpdatedById: 1,
        };
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Projects.truncate();
        await db.Versions.truncate();
    });

    test(`get latest version`, async () => {
        let mod = await db.Projects.create({
            ...defaultModData,
            status: Status.Verified
        });
        let mv = await db.Versions.create({
            ...defaultVersionData,
            projectId: mod.id,
            status: Status.Verified,
        });
        await DatabaseHelper.refreshAllCaches();

        let latest = await mod.getLatestVersion(testGV1.id, Platform.UniversalPC, [Status.Verified]);
        expect(latest).toBeDefined();
        expect(latest).not.toBeNull();
        if (!latest) {
            throw new Error(`latest is null`);
        }
        expect(latest.id).toEqual(mv.id);
    });
});

describe.sequential(`Projects - Permissions`, async () => {
    let db: DatabaseManager;
    let testUser1: User;
    let testUser2: User;
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
            roles: { sitewide: [], perGame: {} },
            createdAt: new Date(users[0].createdAt),
            updatedAt: new Date(users[0].updatedAt),
        });
        testUser2 = await db.Users.create({
            ...users[1],
            roles: { sitewide: [], perGame: {} },
            createdAt: new Date(users[1].createdAt),
            updatedAt: new Date(users[1].updatedAt),
        });
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Projects.truncate();
        await testUser1.reload();
        await testUser2.reload();
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
        let mod = await db.Projects.create({
            name: `Test Mod`,
            description: `Test Description`,
            summary: `Test Summary`,
            gameName: games[0].name,
            status: status as Status,
            authorIds: [testUser1.id],
            category: `Core`,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastUpdatedById: 1,
        });

        let testUser;
        let shouldCheckPerGame = false;
        if (role === "author") {
            testUser = testUser1;
        } else if (role === null) {
            testUser = undefined;
        } else {
            shouldCheckPerGame = true;
            testUser2.roles = { sitewide: [role as UserRoles], perGame: {} };
            testUser = testUser2;
        }
        let isAllowed = await mod.isAllowedToView(testUser);
        expect(isAllowed).toEqual(expected); // check sitewide roles

        if (shouldCheckPerGame) {
            testUser2.roles = {
                sitewide: [], perGame: {
                    [games[0].name]: [role as UserRoles]
                }
            };

            isAllowed = await mod.isAllowedToView(testUser2);
            expect(isAllowed).toEqual(expected); // check per game roles
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
        let mod = await db.Projects.create({
            name: `Test Mod`,
            description: `Test Description`,
            summary: `Test Summary`,
            gameName: games[0].name,
            status: Status.Private,
            authorIds: [testUser1.id],
            category: `Core`,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastUpdatedById: 1,
        });

        let testUser;
        vi.spyOn(Project.prototype, `isAllowedToView`);
        let shouldCheckPerGame = false;
        if (role === "author") {
            testUser = testUser1;
        } else if (role === null) {
            testUser = undefined;
        } else {
            shouldCheckPerGame = true;
            testUser2.roles = { sitewide: [role as UserRoles], perGame: {} };
            testUser = testUser2;
        }
        let isAllowed = await mod.isAllowedToEdit(testUser);
        expect(isAllowed).toEqual(expected); // check sitewide roles
        expect(Project.prototype.isAllowedToView).toHaveBeenNthCalledWith(1, testUser);

        if (shouldCheckPerGame) {
            testUser2.roles = {
                sitewide: [], perGame: {
                    [`BeatSaber`]: [role as UserRoles]
                }
            };

            isAllowed = await mod.isAllowedToEdit(testUser);
            expect(isAllowed).toEqual(expected); // check per game roles
            expect(Project.prototype.isAllowedToView).toHaveBeenNthCalledWith(2, testUser2);
        }
    });
});

describe.sequential(`Projects - Editing`, async () => {
    let db: DatabaseManager;
    let testUser1: User;
    let defaultModData: Omit<ProjectInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
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
            roles: { sitewide: [], perGame: {} },
            createdAt: new Date(users[0].createdAt),
            updatedAt: new Date(users[0].updatedAt),
        });
        await db.GameVersions.create({
            gameName: `BeatSaber`,
            version: `1.29.1`,
            defaultVersion: true,
            linkedVersionIds: [],
        });
        defaultModData = {
            authorIds: [1],
            category: `Core`,
            description: `Test Description`,
            gameName: `BeatSaber`,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            lastUpdatedById: 1,
            name: `Test Mod`,
            status: Status.Private,
            statusHistory: [],
            summary: `Test Summary`,
        };
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // wait for webhooks to finish
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Projects.truncate();
        testUser1 = await testUser1.reload();
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
        let mod = await db.Projects.create({
            ...defaultModData,
            name: `Test Status Mod`,
            status: currStatus,
        });

        await mod.setStatus(newStatus, testUser1, `test`);
        expect(mod.status).toBe(newStatus);
        expect(sendProjectLog).toHaveBeenCalledTimes(2);
        expect(sendProjectLog).toHaveBeenNthCalledWith(1, mod, testUser1, WebhookLogType.Text_StatusChanged);
        expect(sendProjectLog).toHaveBeenNthCalledWith(2, mod, testUser1, expectedLogType, `test`);
    });
});