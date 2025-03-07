import { faker } from "@faker-js/faker";
import { SemVer } from "semver";
import { UniqueConstraintError } from "sequelize";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { DatabaseManager, Mod, GameVersion, ModVersionInfer, SupportedGames, Categories, Platform, ModInfer, Status, GameVersionInfer, UserInfer, DatabaseHelper } from "../../src/shared/Database";

describe.sequential(`Projects - Hooks`, async () => {
    let db: DatabaseManager;
    let defaultModData: Omit<ModInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        defaultModData = {
            authorIds: [1],
            category: Categories.Core,
            description: `Test Description`,
            gameName: SupportedGames.BeatSaber,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            lastUpdatedById: 1,
            name: `Test Mod`,
            status: Status.Private,
            summary: `Test Summary`,
        };
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Mods.truncate();
    });

    test(`no duplicate mod name`, async () => {
        let mod1 = await db.Mods.create({
            ...defaultModData,
            name: `Test Mod`,
        });

        expect(mod1).toBeDefined();
        await expect(async () => {
            await db.Mods.create({
                ...defaultModData,
                name: `Test Mod`,
            });
        }).rejects.toThrow();
    });

    test(`require authorIds`, async () => {
        await expect(async () => {
            await db.Mods.create({
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
    let defaultModData: Omit<ModInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
    let defaultVersionData: Omit<ModVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;
    let defaultGameVersionData: Omit<GameVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
        defaultModData = {
            authorIds: [1],
            category: Categories.Core,
            description: `Test Description`,
            gameName: SupportedGames.BeatSaber,
            gitUrl: ``,
            iconFileName: `default.png`,
            lastApprovedById: null,
            lastUpdatedById: 1,
            name: `Test Mod`,
            status: Status.Private,
            summary: `Test Summary`,
        };
        
        defaultGameVersionData = {
            gameName: SupportedGames.BeatSaber,
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
            modId: 1,
            zipHash: faker.string.alphanumeric(14),
            fileSize: 1000,
            authorId: 1,
            dependencies: [],
            contentHashes: [],
            downloadCount: 0,
            lastApprovedById: null,
            lastUpdatedById: 1,
        };
        await DatabaseHelper.refreshAllCaches();
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        await db.Mods.truncate();
        await db.ModVersions.truncate();
    });

    test(`get latest version`, async () => {
        let mod = await db.Mods.create({
            ...defaultModData,
            status: Status.Verified
        });
        let mv = await db.ModVersions.create({
            ...defaultVersionData,
            modId: mod.id,
            status: Status.Verified,
        });
        await DatabaseHelper.refreshAllCaches();

        let mods = await mod.getLatestVersion(testGV1.id, Platform.UniversalPC, [Status.Private]);
        expect(mods).toBeDefined();
        expect(mods).not.toBeNull();
        expect(mods).toHaveLength(1);
        expect(mods[0].id).toEqual(mv.id);
    });
});