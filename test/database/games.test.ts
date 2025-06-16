import { faker } from "@faker-js/faker";
import { SemVer } from "semver";
import { UniqueConstraintError } from "sequelize";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { DatabaseManager, GameVersion, Game, VersionInfer, DatabaseHelper, GameWebhookConfig } from "../../src/shared/Database";
import * as fakeData from "../fakeData.json" with { type: 'json' };
import { WebhookLogType } from "../../src/shared/ModWebhooks";

describe.sequential(`Versions - Hooks`, async () => {
    let db: DatabaseManager;
    let testGames: Game[];

    beforeAll(async () => {
        db = new DatabaseManager();
        await db.init();
    });

    beforeEach(async () => {
        try {
            await db.Games.truncate({ force: true });
            await DatabaseHelper.refreshCache(`games`);
            testGames = await db.Games.bulkCreate(fakeData.games.map((game) => ({
                ...game,
                webhookConfig: game.webhookConfig as GameWebhookConfig[],
                createdAt: new Date(game.createdAt),
                updatedAt: new Date(game.updatedAt),
            })));
            await DatabaseHelper.refreshCache(`games`);
        } catch (e) {
            if (e instanceof UniqueConstraintError) {
                console.log(e);
            }
            throw e;
        }
    });

    describe.sequential(`Hooks`, () => {
        test(`only one default game`, async () => {
            const defaultGames = await db.Games.findAll({
                where: {
                    default: true,
                },
            });
            expect(defaultGames.length).toBe(1);
            expect(defaultGames[0].name).toBe(testGames[0].name);
            expect(Game.defaultGame).toBeDefined();
            expect(Game.defaultGame?.name).toBe(testGames[0].name);

            await testGames[1].update({
                default: true,
            });
            const updatedDefaultGames = await db.Games.findAll({
                where: {
                    default: true,
                },
            });
            expect(updatedDefaultGames.length).toBe(1);
            expect(updatedDefaultGames[0].name).toBe(testGames[1].name);
            expect(Game.defaultGame).toBeDefined();
            expect(Game.defaultGame?.name).toBe(testGames[1].name);
            await testGames[0].update({
                default: true,
            });
        });

        test(`addCategory`, async () => {
            let game = testGames[0];
            let newCategory = `NewCategory`;
            let updatedGame = await game.addCategory(newCategory);
            let dbGame = await db.Games.findByPk(game.name);
            expect(dbGame).toBeDefined();
            expect(dbGame?.categories).toContain(newCategory);
        });

        test(`addCategory - duplicate`, async () => {
            let game = testGames[0];
            let newCategory = `NewCategory`;
            await game.addCategory(newCategory);
            try {
                await game.addCategory(newCategory);
                throw new Error(`Expected error not thrown`);
            } catch (e) {
                expect(e).toBeDefined();
                expect(e.message).toContain(`Category NewCategory already exists.`);
            }
        });

        test(`removeCategory`, async () => {
            let game = testGames[0];
            let newCategory = `NewCategory`;
            await game.addCategory(newCategory);
            let updatedGame = await game.removeCategory(newCategory);
            let dbGame = await db.Games.findByPk(game.name);
            expect(dbGame).toBeDefined();
            expect(dbGame?.categories).not.toContain(newCategory);
        });

        test(`removeCategory - required category`, async () => {
            let game = testGames[0];
            for (let category of [`Core`, `Essentials`, `Other`]) {
                try {
                    await game.removeCategory(`Core`);
                    throw new Error(`Expected error not thrown`);
                } catch (e) {
                    expect(e).toBeDefined();
                    expect(e.message).toContain(`Cannot remove required categories: Core, Essentials, or Other.`);
                }
            }
        });

        test(`removeCategory - non-existent category`, async () => {
            let game = testGames[0];
            let newCategory = `NewCategory`;
            try {
                await game.removeCategory(newCategory);
                throw new Error(`Expected error not thrown`);
            } catch (e) {
                expect(e).toBeDefined();
                expect(e.message).toContain(`Category ${newCategory} does not exist.`);
            }
        });

        test(`setCategories`, async () => {
            let game = testGames[0];
            let newCategories = [`NewCategory1`, `NewCategory2`];
            await game.setCategories(newCategories);
            let newCategoriesWithRequired = [`Core`, `Essentials`, ...newCategories, `Other`];
            let dbGame = await db.Games.findByPk(game.name);
            expect(dbGame).toBeDefined();
            expect(dbGame?.categories).toEqual(newCategoriesWithRequired);
            for (let i = 0; i < newCategories.length; i++) {
                expect(dbGame?.categories[i]).toContain(newCategoriesWithRequired[i]);
            }
            for (let i = 0; i < dbGame!.categories.length; i++) {
                expect(dbGame?.categories[i]).toContain(newCategoriesWithRequired[i]);
            }

        });

        test(`addWebhookConfig`, async () => {
            const game = testGames[0];

            let webhook = await game.addWebhook({
                url: `https://example.com/webhook`,
                types: [WebhookLogType.All],
            });
            expect(webhook).toBeDefined();
            const updatedGame = await db.Games.findByPk(game.name);
            expect(updatedGame?.webhookConfig).toContainEqual(webhook.webhook);
        })

        test(`removeWebhookConfig`, async () => {
            const game = testGames[0];
            let webhook = await game.addWebhook({
                url: `https://example.com/webhook`,
                types: [WebhookLogType.All],
            });
            let updatedGame = await db.Games.findByPk(game.name);
            expect(updatedGame?.webhookConfig).toContainEqual(webhook.webhook);
            await game.removeWebhook(webhook.webhook.id);
            let updatedGame2 = await db.Games.findByPk(game.name);
            expect(updatedGame2?.webhookConfig).not.toContainEqual(webhook.webhook);
        });

        test(`setWebhookConfig`, async () => {
            const game = testGames[0];
            let webhook = await game.addWebhook({
                url: `https://example.com/webhook`,
                types: [WebhookLogType.All],
            });
            let setWebhook = await game.setWebhook(webhook.webhook.id, {
                url: `https://example.com/webhook2`,
                types: [WebhookLogType.EditApproved],
            });
            let updatedGame = await db.Games.findByPk(game.name);
            expect(updatedGame?.webhookConfig).toContainEqual({
                id: webhook.webhook.id,
                url: `https://example.com/webhook2`,
                types: [WebhookLogType.EditApproved],
            });
        });

        test(`getAPIWebhooks`, async () => {
            const game = testGames[0];
            let webhook = await game.addWebhook({
                url: `https://example.com/webhook`,
                types: [WebhookLogType.All],
            });
            let apiWebhooks = game.getAPIWebhooks();
            let whdb = await apiWebhooks.find((w) => w.id === webhook.webhook.id);
            expect(whdb).toBeDefined();
            expect(whdb?.url).toBeDefined();
            expect(whdb?.url.length).toBeGreaterThan(0);
            expect(whdb?.url.includes(`*`)).toBe(true);
            expect(whdb?.url.includes(`https://example.com/webhook`)).toBe(false);
        });
    });
});