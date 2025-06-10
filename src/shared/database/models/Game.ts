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
    public async addCategory(category: string): Promise<Game | undefined> {
        if (!this.categories) {
            this.categories = [`Core`, `Essentials`, `Other`];
        }

        if (!this.categories.includes(category)) {
            let last = this.categories.pop();
            this.categories.push(category);
            if (last) {
                this.categories.push(last);
            }

            return await this.save();
        }
        return undefined;
    }

    public async removeCategory(category: string): Promise<Game | undefined> {
        if (this.categories && this.categories.includes(category)) {
            this.categories = this.categories.filter((c) => c !== category);
            return await this.save();
        }
        return undefined;
    }

    public async setCategories(categories: string[]): Promise<Game | undefined> {
        let newCategories = [`Core`, `Essentials`, ...categories, `Other`];
        this.categories = newCategories;
        return await this.save();
    }
    // #endregion

    // #region Webhooks
    public async addWebhook(webhook: Omit<GameWebhookConfig, `id`>): Promise<{game: Game, webhook: GameWebhookConfig}> {
        if (!this.webhookConfig) {
            this.webhookConfig = [];
        }

        if (!this.webhookConfig.some((w) => webhook.url === w.url)) {
            let id = this.generateWebhookId();
            this.webhookConfig.push({
                id: id,
                url: webhook.url,
                types: webhook.types
            });
            return { game: await this.save(), webhook: { ...webhook, id } };
        } else {
            throw new Error(`Webhook with URL ${webhook.url} already exists.`);
        }
    }

    public async removeWebhook(webhookId: string): Promise<Game> {
        if (this.webhookConfig) {
            this.webhookConfig = this.webhookConfig.filter((w) => w.id !== webhookId);
            return await this.save();
        }
        throw new Error(`Webhook with ID ${webhookId} does not exist.`);
    }

    public async setWebhook(webhookId: string, webhook: Omit<GameWebhookConfig, `id`>): Promise<Game> {
        if (!this.webhookConfig) {
            this.webhookConfig = [];
        }

        let oldWebhook = this.webhookConfig.find((w) => w.id === webhookId);
        if (oldWebhook) {
            this.webhookConfig.splice(this.webhookConfig.indexOf(oldWebhook), 1, {
                id: webhookId,
                url: webhook.url,
                types: webhook.types
            });
            return await this.save();
        } else {
            throw new Error(`Webhook with ID ${webhookId} does not exist.`);
        }
    }

    public async getAPIWebhooks(): Promise<GameWebhookConfig[]> {
        if (!this.webhookConfig) {
            this.webhookConfig = [];
        }
        
        return this.webhookConfig.map((w) => ({
            id: w.id,
            url: w.url.slice(0, 60) + `*`.repeat(60), 
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