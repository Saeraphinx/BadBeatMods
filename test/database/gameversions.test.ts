import { describe } from 'node:test';
import { test, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager, GameVersion, SupportedGames } from '../../src/shared/Database.ts';
// eslint-disable-next-line quotes
import { gameVersions } from '../fakeData.json' with { type: 'json' };

describe(`Game Versions`, () => {
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