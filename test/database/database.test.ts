import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import { DatabaseHelper, DatabaseManager, Platform, Status, UserRoles } from '../../src/shared/Database.ts';
import { before } from 'node:test';
import { games, gameVersions, projects, versions } from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';

describe(`Database Initialization`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    test(`should connect to the database`, async () => {
        expect(await db.sequelize.authenticate()).toBe(undefined);
    });

    test(`should load models`, async () => {
        expect(db.Users).toBeDefined();
        expect(db.Users.getTableName()).toBe(`users`);
        expect(db.Versions).toBeDefined();
        expect(db.Versions.getTableName()).toBe(`modVersions`);
        expect(db.Projects).toBeDefined();
        expect(db.Projects.getTableName()).toBe(`mods`);
        expect(db.GameVersions).toBeDefined();
        expect(db.GameVersions.getTableName()).toBe(`gameVersions`);
        expect(db.EditApprovalQueue).toBeDefined();
        expect(db.EditApprovalQueue.getTableName()).toBe(`editApprovalQueues`);
        expect(db.MOTDs).toBeDefined();
        expect(db.MOTDs.getTableName()).toBe(`motds`);
        expect(db.Games).toBeDefined();
        expect(db.Games.getTableName()).toBe(`games`);
    });

    test(`should have a server admin user`, async () => {
        expect(await db.Users.findOne({ where: { id: 1 } })).not.toBeNull();

        expect(db.serverAdmin).toBeDefined();
        expect(db.serverAdmin.id).toBe(1);
    });

    test(`should have a server admin user with the correct roles`, async () => {
        expect(db.serverAdmin.roles.sitewide).toContain(UserRoles.AllPermissions);
    });
});

describe(`Database Helper`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    test(`database helper should be initialized`, () => {
        expect(DatabaseHelper.database).toBeDefined();
        expect(DatabaseHelper.database).toBe(db);
        expect(DatabaseHelper.database.sequelize).toBe(db.sequelize);
    });

    test(`caches should be initialized & sizes 0`, () => {
        expect(DatabaseHelper.cache).toBeDefined();
        expect(DatabaseHelper.cache.games).toBeDefined();
        expect(DatabaseHelper.cache.games.length).toBe(0);
        expect(DatabaseHelper.cache.users).toBeDefined();
        expect(DatabaseHelper.cache.users.length).toBe(0);
        expect(DatabaseHelper.cache.versions).toBeDefined();
        expect(DatabaseHelper.cache.versions.length).toBe(0);
        expect(DatabaseHelper.cache.projects).toBeDefined();
        expect(DatabaseHelper.cache.projects.length).toBe(0);
        expect(DatabaseHelper.cache.gameVersions).toBeDefined();
        expect(DatabaseHelper.cache.gameVersions.length).toBe(0);
        expect(DatabaseHelper.cache.editApprovalQueue).toBeDefined();
        expect(DatabaseHelper.cache.editApprovalQueue.length).toBe(0);
    });

    test(`mapCache should be initialized & sizes 0`, () => {
        expect(DatabaseHelper.mapCache).toBeDefined();
        expect(DatabaseHelper.mapCache.users).toBeDefined();
        expect(DatabaseHelper.mapCache.users.size).toBe(0);
        expect(DatabaseHelper.mapCache.projects).toBeDefined();
        expect(DatabaseHelper.mapCache.projects.size).toBe(0);
        expect(DatabaseHelper.mapCache.versions).toBeDefined();
        expect(DatabaseHelper.mapCache.versions.size).toBe(0);
        expect(DatabaseHelper.mapCache.gameVersions).toBeDefined();
        expect(DatabaseHelper.mapCache.gameVersions.size).toBe(0);
    });

    describe(`Helper Fucntions`, () => {
        beforeAll(async () => {
            await db.Games.bulkCreate(games.map(game => ({
                ...game,
                createdAt: new Date(game.createdAt),
                updatedAt: new Date(game.updatedAt),
            })), { individualHooks: true });
            await db.GameVersions.bulkCreate(gameVersions.map(version => ({
                ...version,
                createdAt: new Date(version.createdAt),
                updatedAt: new Date(version.updatedAt),
            })), { individualHooks: true });
            await db.Projects.bulkCreate(projects.map(project => ({
                ...project,
                status: project.status as Status,
                createdAt: new Date(project.createdAt),
                updatedAt: new Date(project.updatedAt),
            })), { individualHooks: true });
            await db.Versions.bulkCreate(versions.map(version => ({
                ...version,
                modVersion: new SemVer(version.modVersion.raw),
                platform: version.platform as Platform,
                status: version.status as Status,
                createdAt: new Date(version.createdAt),
                updatedAt: new Date(version.updatedAt),
            })), { individualHooks: true });
            await db.EditApprovalQueue.create({
                id: 1,
                objectId: 1,
                objectTableName: `mods`,
                submitterId: 1,
                object: {
                    name: `Test Object`,
                }
            });
            await db.EditApprovalQueue.create({
                id: 2,
                objectId: 1,
                objectTableName: `modVersions`,
                submitterId: 1,
                object: {
                    modVersion: new SemVer(`1.0.0`),
                }
            });
            await DatabaseHelper.refreshAllCaches();
        });

        test(`getGameNameFromProjectId should return the correct game name`, async () => {
            let project = await db.Projects.findByPk(1);
            const gameName = DatabaseHelper.getGameNameFromProjectId(1);
            expect(gameName).toBe(project?.gameName);
        });

        test(`getGameNameFromProjectId should return null for non-existing project`, async () => {
            const gameName = DatabaseHelper.getGameNameFromProjectId(9999);
            expect(gameName).toBeNull();
        });

        test(`getGameNameFromVersionId should return the correct game version`, async () => {
            let version = await db.Versions.findByPk(1);
            let project = await db.Projects.findByPk(version?.projectId);
            const gameVersion = DatabaseHelper.getGameNameFromVersionId(1);
            expect(gameVersion).toBeDefined();
            expect(gameVersion).toBe(project?.gameName);
        });

        test(`getGameNameFromVersionId should return null for non-existing version`, async () => {
            const gameVersion = DatabaseHelper.getGameNameFromVersionId(9999);
            expect(gameVersion).toBeNull();
        });

        test(`getGameNameFromEditApprovalQueueId should return the correct game name for project`, async () => {
            let editApproval = await db.EditApprovalQueue.findByPk(1);
            expect(editApproval?.objectTableName).toBe(`mods`);
            let project = await db.Projects.findByPk(editApproval?.objectId);
            const gameName = DatabaseHelper.getGameNameFromEditApprovalQueueId(1);
            expect(gameName).toBeDefined();
            expect(gameName).toBe(project?.gameName);
        });

        test(`getGameNameFromEditApprovalQueueId should return the correct game name for version`, async () => {
            let editApproval = await db.EditApprovalQueue.findByPk(2);
            expect(editApproval?.objectTableName).toBe(`modVersions`);
            let version = await db.Versions.findByPk(editApproval?.objectId);
            let project = await db.Projects.findByPk(version?.projectId);
            const gameName = DatabaseHelper.getGameNameFromEditApprovalQueueId(2);
            expect(gameName).toBeDefined();
            expect(gameName).toBe(project?.gameName);
        });

        test(`getGameNameFromEditApprovalQueueId should return null for non-existing edit approval`, async () => {
            const gameName = DatabaseHelper.getGameNameFromEditApprovalQueueId(9999);
            expect(gameName).toBeUndefined();
        });

        test(`isValidPlatform should return true for valid platforms`, () => {
            expect(DatabaseHelper.isValidPlatform(Platform.UniversalPC)).toBe(true);
            expect(DatabaseHelper.isValidPlatform(Platform.SteamPC)).toBe(true);
            expect(DatabaseHelper.isValidPlatform(Platform.OculusPC)).toBe(true);
            expect(DatabaseHelper.isValidPlatform(Platform.UniversalQuest)).toBe(true);
        });

        test(`isValidPlatform should return false for invalid platforms`, () => {
            expect(DatabaseHelper.isValidPlatform(`InvalidPlatform`)).toBe(false);
            expect(DatabaseHelper.isValidPlatform(`Universalpc`)).toBe(false);
            expect(DatabaseHelper.isValidPlatform(`STEAMPC`)).toBe(false);
        });

        test(`isSupportedGame should return true for valid game names`, () => {
            expect(DatabaseHelper.isSupportedGame(games[0].name)).toBe(true);
        });

        test(`isSupportedGame should return false for invalid game names`, () => {
            expect(DatabaseHelper.isSupportedGame(`InvalidGame`)).toBe(false);
            expect(DatabaseHelper.isSupportedGame(games[0].name.toUpperCase())).toBe(false);
        });

        test(`isValidVisibility should return true for valid status`, () => {
            expect(DatabaseHelper.isValidVisibility(Status.Private)).toBe(true);
            expect(DatabaseHelper.isValidVisibility(Status.Pending)).toBe(true);
            expect(DatabaseHelper.isValidVisibility(Status.Verified)).toBe(true);
            expect(DatabaseHelper.isValidVisibility(Status.Unverified)).toBe(true);
            expect(DatabaseHelper.isValidVisibility(Status.Removed)).toBe(true);
        });

        test(`isValidVisibility should return false for invalid status`, () => {
            expect(DatabaseHelper.isValidVisibility(`InvalidStatus`)).toBe(false);
            expect(DatabaseHelper.isValidVisibility(`Private`)).toBe(false);
            expect(DatabaseHelper.isValidVisibility(`PENDING`)).toBe(false);
        });

        test(`isValidCategory should return true for valid categories`, () => {
            expect(DatabaseHelper.isValidCategory(`Core`, `idk`)).toBe(true);
            expect(DatabaseHelper.isValidCategory(`Essential`, games[0].name)).toBe(true);
            expect(DatabaseHelper.isValidCategory(`Other`, `BEATSAMER`)).toBe(true);
            for (let game of games) {
                for (let category of game.categories) {
                    expect(DatabaseHelper.isValidCategory(category, game.name)).toBe(true);
                }
            }
        });

        test(`isValidCategory should return false for invalid categories`, () => {
            expect(DatabaseHelper.isValidCategory(`InvalidCategory`, `idk`)).toBe(false);
            expect(DatabaseHelper.isValidCategory(`core`, `idk`)).toBe(false);
        });

        test(`isValildGameVersion should return true for valid game versions`, async () => {
            expect((await DatabaseHelper.isValidGameVersion(gameVersions[0].gameName, gameVersions[0].version))).toBe(gameVersions[0].id);
        });

        test(`isValildGameVersion should return false for invalid game versions`, async () => {
            expect((await DatabaseHelper.isValidGameVersion(`InvalidGame`, `1.0.0`))).toBe(null);
            expect((await DatabaseHelper.isValidGameVersion(games[0].name, `invalidVersion`))).toBe(null);
        });
    });
});