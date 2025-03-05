import { test, expect, beforeAll, afterAll, beforeEach, describe } from 'vitest';
import { Categories, DatabaseManager, GameVersion, Mod, ModVersion, Status, SupportedGames, Platform, ModVersionInfer } from '../../src/shared/Database.ts';
import { UniqueConstraintError } from 'sequelize';
// eslint-disable-next-line quotes
import { projects } from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { faker } from '@faker-js/faker';

describe.sequential(`Versions`, async () => {
    let db: DatabaseManager;
    let testMod1: Mod;
    let testMod2: Mod;
    let testModGV: GameVersion[];
    let testVersion: ModVersion;
    let defaultVersionData: Omit<ModVersionInfer, `id` | `createdAt` | `updatedAt` | `deletedAt`>;

    let modVersion: ModVersion|undefined;

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
                downloadCount: 0,
                lastApprovedById: null
            };
            testVersion = await db.ModVersions.create({
                ...defaultVersionData,
            });
        } catch (e) {
            if (e instanceof UniqueConstraintError) {
                // eslint-disable-next-line no-console
                console.log(e);
            }
            throw e;
        }
    });

    afterAll(async () => {
        await db.sequelize.close();
    });

    beforeEach(async () => {
        if (modVersion !== undefined) {
            await modVersion.destroy();
        }
    });

    test(`able to create mod w/o dependencies`, async () => {
        /*let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            modVersion: new SemVer(`1.0.0`),
        });*/
        expect(testVersion).toBeDefined();
    });

    test(`able to create mod w/ dependencies`, async () => {
        modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod2.id,
            modVersion: new SemVer(`1.0.0`),
            dependencies: [testVersion.id],
        });
        expect(modVersion).toBeDefined();
    });

    test(`able to deduplicate dependencies`, async () => {
        modVersion = await db.ModVersions.create({
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
            modVersion = await db.ModVersions.create({
                ...defaultVersionData,
                modId: testMod2.id,
                modVersion: new SemVer(`1.0.0`),
                dependencies: [testVersion.id + 999],
            });
        }).rejects.toThrow();
    });

    test(`does not allow for dependency on itself or another version of the same mod`, async () => {
        await expect(async () => {
            modVersion = await db.ModVersions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                dependencies: [testVersion.id],
            });
        }).rejects.toThrow();
    });

    test(`sorts game versions by semver`, async () => {
        let firstVersion = testModGV[0];
        let secondVersion = testModGV[1];
        
        expect(firstVersion.version).toBe(`1.0.0`);
        expect(secondVersion.version).toBe(`1.1.0`);

        modVersion = await db.ModVersions.create({
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
            modVersion = await db.ModVersions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                supportedGameVersionIds: [1, 999],
            });
        }).rejects.toThrow();
    });

    test(`removes duplicate game versions`, async () => {
        let firstVersion = testModGV[0];

        modVersion = await db.ModVersions.create({
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
            modVersion = await db.ModVersions.create({
                ...defaultVersionData,
                modVersion: new SemVer(`1.0.0`),
                supportedGameVersionIds: [],
            });
        }).rejects.toThrow();
    });
});

/*
        let promises: Promise<GameVersion | User | ModVersion | Mod>[] = [];
            for (let version of gameVersions) {
                promises.push(db.GameVersions.create({
                    ...version,
                    gameName: version.gameName as SupportedGames,
                    createdAt: new Date(version.createdAt),
                    updatedAt: new Date(version.updatedAt),
                }));
            }
            /*
        for (let user of users) {
            promises.push(db.Users.create({
                ...user,
                roles: user.roles as UserRolesObject,
                createdAt: new Date(user.createdAt),
                updatedAt: new Date(user.updatedAt),
            }));
        }

        for (let project of projects) {
            promises.push(db.Mods.create({
                ...project,
                gameName: project.gameName as SupportedGames,
                status: project.status as Status,
                category: project.category as Categories,
                createdAt: new Date(project.createdAt),
                updatedAt: new Date(project.updatedAt),
            }));
        }

        await Promise.all(promises);
        promises = [];

        for (let version of versions) {
            await db.ModVersions.create({
                ...version,
                modVersion: new SemVer(version.modVersion.raw),
                status: version.status as Status,
                platform: version.platform as Platform,
                createdAt: new Date(version.createdAt),
                updatedAt: new Date(version.updatedAt),
            });
        }
        */