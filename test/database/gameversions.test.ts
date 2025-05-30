import { test, expect, beforeAll, afterAll, describe, afterEach } from 'vitest';
import { Categories, DatabaseManager, GameVersion, GameVersionInfer, SupportedGames, Status, Platform, DatabaseHelper, UserInfer, ProjectInfer, VersionInfer } from '../../src/shared/Database.ts';
// eslint-disable-next-line quotes
import * as fakeData from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';

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

describe.sequential(`Game Versions - Hooks`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    afterEach(async () => {
        await db.GameVersions.truncate();
    });

    test(`should set default version on create of first version only`, async () => {
        let version1 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
        });

        let version2 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.1.0`,
        });

        expect(version1.defaultVersion).toBe(true);
        expect(version2.defaultVersion).toBe(false);
    });

    test(`should link versions`, async () => {
        let version1 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
        });

        let version2 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.1.0`,
        });

        version1.linkedVersionIds = [version2.id];
        await version1.save();

        version1 = await version1.reload();
        version2 = await version2.reload();
        expect(version1.linkedVersionIds).toContain(version2.id);
        expect(version2.linkedVersionIds).toContain(version1.id);
    });

    test(`should disallow linking to self`, async () => {
        let version1 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
        });

        version1.linkedVersionIds = [version1.id];
        await expect(version1.save()).rejects.toThrow();
    });

    test(`should disallow linking to non-existent version`, async () => {
        let version1 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
        });

        version1.linkedVersionIds = [9999];
        await expect(version1.save()).rejects.toThrow();
    });

    test(`should disallow linking to version of different game`, async () => {
        let version1 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
        });

        let version2 = await db.GameVersions.create({
            gameName: SupportedGames.ChroMapper,
            version: `1.0.0`,
        });

        version1.linkedVersionIds = [version2.id];
        await expect(version1.save()).rejects.toThrow();
    });

    test(`should mark linked version as linked with first version`, async () => {
        let version1 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.0.0`,
        });

        let version2 = await db.GameVersions.create({
            gameName: SupportedGames.BeatSaber,
            version: `1.1.0`,
        });

        version1.linkedVersionIds = [version2.id];
        await version1.save();

        version2 = await version2.reload();
        expect(version1.linkedVersionIds).toContain(version2.id);
        expect(version2.linkedVersionIds).toContain(version1.id);
    });
});

describe.sequential(`Game Versions - GV`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();

        await db.GameVersions.bulkCreate(gameVersions, { individualHooks: true });
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    test(`should be able to get default game version`, async () => {
        let games = GameVersion.getGames();
        for (let game of games) {
            let version = await GameVersion.getDefaultVersion(game);
            expect(version).toBeDefined();
        }
    });

    // this test doesn't test properly
    test.skip(`should only have one default version per game`, async () => {
        let games = GameVersion.getGames();
        for (let game of games) {
            let defaultVersion = await GameVersion.getDefaultVersionObject(game);
            let version = await db.GameVersions.findAll({ where: { gameName: game } });

            for (let v of version) {
                if (v.defaultVersion) {
                    expect(v).toBeDefined();
                    expect(v).not.toBeNull();
                    expect(v.gameName).toBe(game);
                    expect(v.id).toBe(defaultVersion?.id);
                }
            }
        }
    });
});

describe.sequential(`Game Versions - Getting Mods`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();

        await db.GameVersions.bulkCreate(gameVersions, { individualHooks: true });
        await db.Projects.bulkCreate(projects, { individualHooks: true });
        await db.Versions.bulkCreate(versions, { individualHooks: true });
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    test(`should return only verified universal pc mods`, async () => {
        let games = GameVersion.getGames();
        for (let game of games) {
            let versions = await db.GameVersions.findAll({ where: { gameName: game } });
            for (let version of versions) {
                let supportedMods = await version.getSupportedMods(Platform.UniversalPC, [Status.Verified]);
                for (let pair of supportedMods) {
                    expect(pair).toBeDefined();
                    expect(pair.project).toBeDefined();
                    expect(pair.project.gameName).toBe(game);
                    expect(pair.project.status).toBe(Status.Verified);
                    expect(pair.version).toBeDefined();
                    expect(pair.version.supportedGameVersionIds).toContain(version.id);
                    expect(pair.version.status).toBe(Status.Verified);
                    expect(pair.version.platform).toBe(Platform.UniversalPC);
                }
            }
        }
    });

    test(`should return only verified platform quest mods`, async () => {
        let games = GameVersion.getGames();
        for (let game of games) {
            let versions = await db.GameVersions.findAll({ where: { gameName: game } });
            for (let version of versions) {
                let supportedMods = await version.getSupportedMods(Platform.UniversalQuest, [Status.Verified]);
                for (let pair of supportedMods) {
                    expect(pair).toBeDefined();
                    expect(pair.project).toBeDefined();
                    expect(pair.project.gameName).toBe(game);
                    expect(pair.project.status).toBe(Status.Verified);
                    expect(pair.version).toBeDefined();
                    expect(pair.version.supportedGameVersionIds).toContain(version.id);
                    expect(pair.version.status).toBe(Status.Verified);
                    expect(pair.version.platform).toBe(Platform.UniversalQuest);
                }
            }
        }
    });

    test(`should return both verified & unverified pc mods`, async () => {
        let hasSeenVerified = false;
        let hasSeenUnverified = false;
        let games = GameVersion.getGames();
        expect(games.length).toBeGreaterThanOrEqual(1);
        for (let game of games) {
            let versions = await db.GameVersions.findAll({ where: { gameName: game } });
            expect(versions.length).toBeGreaterThanOrEqual(1);
            for (let version of versions) {
                let supportedMods = await version.getSupportedMods(Platform.UniversalPC, [Status.Verified, Status.Unverified]);
                expect(supportedMods.length).toBeGreaterThanOrEqual(1);
                for (let pair of supportedMods) {
                    expect(pair).toBeDefined();
                    expect(pair.project).toBeDefined();
                    expect(pair.project.gameName).toBe(game);
                    expect(pair.version).toBeDefined();
                    expect(pair.version.supportedGameVersionIds).toContain(version.id);
                    expect(pair.version.status).not.toBeOneOf([Status.Pending, Status.Removed, Status.Private]);
                    expect(pair.version.platform).toBe(Platform.UniversalPC);
                    if (pair.version.status == Status.Verified) {
                        hasSeenVerified = true;
                    }
                    if (pair.version.status == Status.Unverified) {
                        hasSeenUnverified = true;
                    }
                }
            }
        }
        expect(hasSeenVerified).toBe(true);
        expect(hasSeenUnverified).toBe(true);
    });

});