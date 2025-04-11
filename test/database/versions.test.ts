import { test, expect, beforeAll, afterAll, beforeEach, describe, afterEach, vi } from 'vitest';
import { Categories, DatabaseManager, GameVersion, Mod, ModVersion, Status, SupportedGames, Platform, ModVersionInfer, User, DatabaseHelper, UserRoles, EditQueue, ModInfer } from '../../src/shared/Database.ts';
import { UniqueConstraintError } from 'sequelize';
// eslint-disable-next-line quotes
import { projects, users } from '../fakeData.json' with { type: 'json' };
import { SemVer } from 'semver';
import { faker } from '@faker-js/faker';
import { WebhookLogType } from '../../src/shared/ModWebhooks.ts';


vi.mock(import(`../../src/shared/ModWebhooks.ts`), async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendModLog: vi.fn(async (mod: Mod, userMakingChanges: User, logType: WebhookLogType) => {}),
        sendModVersionLog: vi.fn(async (modVersion: ModVersion, userMakingChanges: User, logType: WebhookLogType, modObj?: Mod) => {}),
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

describe.sequential(`Versions - Visibility`, async () => {
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
    });

    test(`should show private versions to the author`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Private,
        });
        let v = await modVersion.isAllowedToView(testUser1);
        expect(v).toBe(true);
    });

    test(`should show private versions to sitewide all permissions`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Private,
        });
        let v = await modVersion.isAllowedToView(db.serverAdmin);
        expect(v).toBe(true);
    });

    test(`should show private versions to sitewide approver`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Private,
        });
        testUser2.roles = {
            sitewide: [UserRoles.Approver],
            perGame: {},
        };
        let v = await modVersion.isAllowedToView(testUser2);
        expect(v).toBe(true);
    });

    test(`should show private versions to game approver`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            supportedGameVersionIds: [testGv1.id],
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Private,
        });
        testUser2.roles = {
            sitewide: [],
            perGame: {
                [SupportedGames.BeatSaber]: [UserRoles.Approver],
            },
        };
        let v = await modVersion.isAllowedToView(testUser2);
        expect(v).toBe(true);
    });

    test(`should not show private versions to random user`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Private,
        });
        let v = await modVersion.isAllowedToView(testUser2);
        expect(v).toBe(false);
    });

    test(`should not show private versions to not logged in user`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Private,
        });
        let v = await modVersion.isAllowedToView(null);
        expect(v).toBe(false);
    });

    test(`should show verified versions to regular user`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Verified,
        });
        let v = await modVersion.isAllowedToView(testUser2);
        expect(v).toBe(true);
    });

    test(`should show verified versions to not logged in user`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
            modId: testMod1.id,
            authorId: testUser1.id,
            modVersion: new SemVer(`1.0.0`),
            status: Status.Verified,
        });
        let v = await modVersion.isAllowedToView(null);
        expect(v).toBe(true);
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

    test(`should send log on status update unverified`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });

        await modVersion.setStatus(Status.Unverified, testUser1);
        expect(modVersion.status).toBe(Status.Unverified);
        expect(sendModVersionLog).toHaveBeenCalled();
        expect(sendModVersionLog).toHaveBeenCalledWith(modVersion, testUser1, WebhookLogType.RejectedUnverified);
    });

    test(`should send log on status update verified`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });

        await modVersion.setStatus(Status.Verified, testUser1);
        expect(modVersion.status).toBe(Status.Verified);
        expect(sendModVersionLog).toHaveBeenCalled();
        expect(sendModVersionLog).toHaveBeenCalledWith(modVersion, testUser1, WebhookLogType.Verified);
    });

    test(`should send log on status update removed`, async () => {
        let modVersion = await db.ModVersions.create({
            ...defaultVersionData,
        });

        await modVersion.setStatus(Status.Removed, testUser1);
        expect(modVersion.status).toBe(Status.Removed);
        expect(sendModVersionLog).toHaveBeenCalled();
        expect(sendModVersionLog).toHaveBeenCalledWith(modVersion, testUser1, WebhookLogType.Removed);
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