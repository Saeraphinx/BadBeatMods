import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import { DatabaseManager, GameVersion, SupportedGames } from '../../src/shared/Database.ts';
// eslint-disable-next-line quotes
import { gameVersions } from '../fakeData.json' with { type: 'json' };
import { afterEach } from 'node:test';

describe.sequential(`Game Versions`, () => {
    let db: DatabaseManager;
    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();

        let promises: Promise<GameVersion>[] = [];
        for (let version of gameVersions) {
            promises.push(db.GameVersions.create({
                ...version,
                gameName: version.gameName as SupportedGames,
                createdAt: new Date(version.createdAt),
                updatedAt: new Date(version.updatedAt),
            }));
        }
        await Promise.all(promises);
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

    test(`should only have one default version per game`, async () => {
        let games = GameVersion.getGames();
        for (let game of games) {
            let defaultVersion = await GameVersion.getDefaultVersionObject(game);
            let version = await db.GameVersions.findAll({ where: { gameName: game } });

            for (let v of version) {
                if (v.defaultVersion) {
                    expect(v).toBeDefined();
                    expect(v.gameName).toBe(game);
                    expect(v.id).toBe(defaultVersion?.id);
                }
            }
        }
    });
});

describe.sequential(`Game Version Hooks`, () => {
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
});