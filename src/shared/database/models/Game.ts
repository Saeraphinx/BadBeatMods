import { CreationOptional, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { DatabaseHelper, GameVersion } from "../../Database.ts";
import { WebhookLogType } from "../../ModWebhooks.ts";
import { Utils } from "../../../shared/Utils.ts";

export type GameWebhookConfig = {
    id: string;
    url: string;
    types: WebhookLogType[];
};

export type GameInfer = InferAttributes<Game>;
export class Game extends Model<InferAttributes<Game>, InferCreationAttributes<Game>> {
    private static _defaultGame: NonAttribute<Game>;
    private static _defaultCategories: string[] = [`Core`, `Essentials`, `Other`];

    declare name: string;
    declare displayName: string;
    declare categories: CreationOptional<string[]>;
    declare webhookConfig: GameWebhookConfig[];
    declare default: boolean;

    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
    declare deletedAt: CreationOptional<Date | null>;

    public toAPIResponse(shouldShowVerisons: boolean = true) {
        let versions = shouldShowVerisons ? DatabaseHelper.cache.gameVersions.filter((v) => v.gameName === this.name).sort((a, b) => GameVersion.compareVersions(b, a)).map((v) => v.toAPIResponse()) : [];

        return {
            name: this.name,
            displayName: this.displayName,
            categories: this.categories,
            default: this.default,
            versions: versions
        };
    }

    public static get defaultGame(): NonAttribute<Game> {
        if (!this._defaultGame) {
            this._defaultGame = DatabaseHelper.cache.games.find((g) => g.default) || DatabaseHelper.cache.games[0];
        }
        return this._defaultGame;
    }

    public static set defaultGame(game: Game) {
        if (game.default) {
            this._defaultGame = game;
        } else {
            throw new Error(`Cannot set default game to a non-default game.`);
        }
    }

    // #region Categories
    public async addCategory(category: string): Promise<Game> {
        if (!this.categories) {
            this.categories = Game._defaultCategories;
        }

        if (category === `Core` || category === `Essentials` || category === `Other`) {
            throw new Error(`Cannot remove required categories: Core, Essentials, or Other.`);
        }

        if (this.categories.includes(category)) {
            throw new Error(`Category ${category} already exists.`);
        }

        let last = this.categories.length > 0 ? this.categories.pop() : undefined;
        let newCategories = this.categories.filter((c) => c !== last);
        newCategories.push(category);
        if (last) {
            newCategories.push(last);
        }

        return await this.update({
            categories: newCategories
        });
    }

    public async removeCategory(category: string): Promise<Game> {
        if (!this.categories) {
            this.categories = Game._defaultCategories;
        }

        if (category === `Core` || category === `Essentials` || category === `Other`) {
            throw new Error(`Cannot remove required categories: Core, Essentials, or Other.`);
        }

        if (!this.categories.includes(category)) {
            throw new Error(`Category ${category} does not exist.`);
        }

        let newCategories = this.categories.filter((c) => c !== category);
        return await this.update({
            categories: newCategories
        });
    }

    public async setCategories(categories: string[]): Promise<Game | undefined> {
        let noReqdCats = categories.filter((c) => c !== `Core` && c !== `Essentials` && c !== `Other`);
        let newCategories = [`Core`, `Essentials`, ...noReqdCats, `Other`];
        return await this.update({
            categories: newCategories
        });
    }
    // #endregion

    // #region Webhooks
    public async addWebhook(webhook: Omit<GameWebhookConfig, `id`>): Promise<{game: Game, webhook: GameWebhookConfig}> {
        let newWebhooks = this.webhookConfig || [];

        if (!newWebhooks.some((w) => webhook.url === w.url)) {
            let id = this.generateWebhookId();
            newWebhooks.push({
                id: id,
                url: webhook.url,
                types: webhook.types
            });
            return { game: await this.update({ webhookConfig: newWebhooks }), webhook: { ...webhook, id } };
        } else {
            throw new Error(`Webhook with URL ${webhook.url} already exists.`);
        }
    }

    public async removeWebhook(webhookId: string): Promise<Game> {
        if (this.webhookConfig) {
            let newWebhooks = this.webhookConfig.filter((w) => w.id !== webhookId);
            return await this.update({ webhookConfig: newWebhooks });
        }
        throw new Error(`Webhook with ID ${webhookId} does not exist.`);
    }

    public async setWebhook(webhookId: string, webhook: Omit<GameWebhookConfig, `id`>): Promise<Game> {
        let newWebhooks = this.webhookConfig || [];

        let oldWebhook = newWebhooks.find((w) => w.id === webhookId);
        if (oldWebhook) {
            newWebhooks.splice(newWebhooks.indexOf(oldWebhook), 1, {
                id: webhookId,
                url: webhook.url,
                types: webhook.types
            });
            return await this.update({ webhookConfig: newWebhooks });
        } else {
            throw new Error(`Webhook with ID ${webhookId} does not exist.`);
        }
    }

    public getAPIWebhooks(): GameWebhookConfig[] {
        if (!this.webhookConfig) {
            this.webhookConfig = [];
        }
        
        return this.webhookConfig.map((w) => ({
            id: w.id,
            url: w.url.length > 60 ? w.url.slice(0, w.url.length - 60) : `` + `*`.repeat(60),
            types: w.types
        }));
    }

    private generateWebhookId(): string {
        let id = Utils.createRandomString(8);
        while (this.webhookConfig?.some((w) => w.id === id)) {
            id = Utils.createRandomString(8);
        }
        return id;
    }
    // #endregion
}