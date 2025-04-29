import { test, expect, beforeAll, afterAll, beforeEach, describe, afterEach, vi } from 'vitest';
import { Categories, DatabaseManager, GameVersion, Mod, ModVersion, Status, SupportedGames, Platform, ModVersionInfer, User, DatabaseHelper, UserRoles, EditQueue, ModInfer } from '../../src/shared/Database.ts';
import { UniqueConstraintError } from 'sequelize';
// eslint-disable-next-line quotes
import { projects, users } from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { faker } from '@faker-js/faker';
import { WebhookLogType } from '../../src/shared/ModWebhooks.ts';
import e from 'express';


vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendModLog: vi.fn(async (mod: Mod, userMakingChanges: User, logType: WebhookLogType, reason?:string) => {}),
        sendModVersionLog: vi.fn(async (modVersion: ModVersion, userMakingChanges: User, logType: WebhookLogType, modObj?: Mod, reason?:string) => {}),
        sendEditLog: vi.fn(async (edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ModInfer | ModVersionInfer) => {}),
    };
});

describe.sequential(`Versions - Hooks`, async () => {
    let db: DatabaseManager;
    let testMod1: Mod;
    let testMod2: Mod;
    let testModGV: GameVersion[];
    let defaultVersionData: Omit<ModVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        try {
            testModGV = await db.GameVersions.bulkCreate([
                {
                    gameName: SupportedGames.BeatSaber,
                    version: `1.0.0`,
                    defaultVersion: true,
                },
                {
                    gameName: SupportedGames.BeatSaber,
                    version: `1.1.0`,
                    defaultVersion: false,
                }
            ]);

            testMod1 = await db.Mods.create({
                ...projects[0],
                gameName: SupportedGames.BeatSaber,
                status: projects[0].status as Status,
                category: projects[0].category as Categories,
                authorIds: [1],
                createdAt: new Date(projects[0].createdAt),
                updatedAt: new Date(projects[0].updatedAt),
            });
            testModGV = await db.GameVersions.findAll({ where: { gameName: testMod1.gameName } });
            testMod2 = await db.Mods.create({
                ...projects[1],
                gameName: SupportedGames.BeatSaber,
                status: projects[0].status as Status,
                category: projects[0].category as Categories,
                authorIds: [1],
                createdAt: new Date(projects[0].createdAt),
                updatedAt: new Date(projects[0].updatedAt),
            });
            defaultVersionData = {
                modId: testMod1.id,
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
        await db.ModVersions.truncate();
    });

    test(`able to create mod w/o dependencies`, async () => {
        /*let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
        });*/
        let testVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });
        expect(testVersion).toBeDefined();
    });

    test(`able to create mod w/ dependencies`, async () => {
        let testVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod2.id,
            modVersion: new SemVer(`1.0.0`),
            dependencies: [testVersion.id],
        });
        expect(modVersion).toBeDefined();
    });

    test(`able to deduplicate dependencies`, async () => {
        let testVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod2.id,
            modVersion: new SemVer(`1.0.0`),
            dependencies: [testVersion.id, testVersion.id],
        });
        expect(modVersion).toBeDefined();
        expect(modVersion.dependencies).toHaveLength(1);
    });

    test(`does not allow invalid dependencies`, async () => {
        await expect(async () => {
            await db.ModVersions.create({
                ...defaultVersionData,
                modId: testMod2.id,
                modVersion: new SemVer(`1.0.0`),
                dependencies: [999],
            });
        }).rejects.toThrow();
    });

    test(`does not allow for dependency on another version of the same mod`, async () => {
        let testVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });
        await expect(async () => {
            await db.ModVersions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                dependencies: [testVersion.id],
            });
        }).rejects.toThrow();
    });

    test(`does not allow for dependency on self`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });

        modVersion.dependencies = [modVersion.id];
        await expect(modVersion.save()).rejects.toThrow();
    });

    test(`sorts game versions by semver`, async () => {
        let firstVersion = testModGV[0];
        let secondVersion = testModGV[1];
        
        expect(firstVersion.version).toBe(`1.0.0`);
        expect(secondVersion.version).toBe(`1.1.0`);

        let modVersion = await db.ModVersions.create({
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
            await db.ModVersions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                supportedGameVersionIds: [1, 999],
            });
        }).rejects.toThrow();
    });

    test(`removes duplicate game versions`, async () => {
        let firstVersion = testModGV[0];

        let modVersion = await db.ModVersions.create({
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
            await db.ModVersions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                supportedGameVersionIds: [],
            });
        }).rejects.toThrow();
    });

    test(`removes "v" from version string`, async () => {
        let modVersion = await db.ModVersions.create({
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
    let testMod1: Mod;
    let testMod2: Mod;
    let testGv1: GameVersion;
    let testGv2: GameVersion;
    let defaultVersionData: Omit<ModVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`> = {
        modId: 1,
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
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
            defaultVersion: true,
        });
        testGv2 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.1.0`,
            defaultVersion: false,
        });
        testMod1 = await db.Mods.create({
            ...projects[0],
            gameName: SupportedGames.BeatSaber,
            status: Status.Verified,
            category: projects[0].category as Categories,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        testMod2 = await db.Mods.create({
            ...projects[1],
            gameName: SupportedGames.BeatSaber,
            status: Status.Verified,
            category: projects[0].category as Categories,
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
        db.ModVersions.truncate();
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
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
            authorId: testUser1.id,
            status: status as Status,
        });

        vi.spyOn(Mod.prototype, `isAllowedToView`);
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
                [SupportedGames.BeatSaber]: [role as UserRoles]
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
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
            authorId: testUser1.id,
        });

        let testUser;
        vi.spyOn(Mod.prototype, `isAllowedToView`);
        vi.spyOn(ModVersion.prototype, `isAllowedToView`);
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
            expect(ModVersion.prototype.isAllowedToView).toHaveBeenCalledTimes(1);
            expect(Mod.prototype.isAllowedToView).toHaveBeenCalledTimes(2);
        }

        if (shouldCheckPerGame) {
            testUser2.roles = {sitewide: [], perGame: {
                [SupportedGames.BeatSaber]: [role as UserRoles]
            }};

            isAllowed = await modVersion.isAllowedToEdit(testUser);
            expect(isAllowed).toEqual(expected); // check per game roles
            if (isAllowed) {
                expect(ModVersion.prototype.isAllowedToView).toHaveBeenCalledTimes(2);
                expect(Mod.prototype.isAllowedToView).toHaveBeenCalledTimes(4);
            }
        }
    });
});

describe.sequential(`Versions - Editing`, async () => {
    let db: DatabaseManager;
    let testUser1: User;
    let testUser2: User;
    let testMod1: Mod;
    let testMod2: Mod;
    let testGv1: GameVersion;
    let testGv2: GameVersion;
    let defaultVersionData: Omit<ModVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
    let { sendModLog, sendEditLog, sendModVersionLog } = await import(`../../src/shared/ModWebhooks.ts`);

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
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
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
            defaultVersion: true,
        });
        testGv2 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.1.0`,
            defaultVersion: false,
        });
        testMod1 = await db.Mods.create({
            ...projects[0],
            gameName: SupportedGames.BeatSaber,
            status: Status.Verified,
            category: projects[0].category as Categories,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        testMod2 = await db.Mods.create({
            ...projects[1],
            gameName: SupportedGames.BeatSaber,
            status: Status.Verified,
            category: projects[0].category as Categories,
            authorIds: [testUser1.id],
            createdAt: new Date(projects[0].createdAt),
            updatedAt: new Date(projects[0].updatedAt),
        });
        defaultVersionData = {
            modId: testMod1.id,
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
        await db.ModVersions.truncate();
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
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            status: currStatus,
        });

        await modVersion.setStatus(newStatus, testUser1, `test`);
        expect(modVersion.status).toBe(newStatus);
        expect(sendModVersionLog).toHaveBeenCalledTimes(2);
        expect(sendModVersionLog).toHaveBeenNthCalledWith(1, modVersion, testUser1, WebhookLogType.Text_StatusChanged);
        expect(sendModVersionLog).toHaveBeenNthCalledWith(2, modVersion, testUser1, expectedLogType, undefined, `test`);
    });
});