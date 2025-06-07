import { CreationOptional, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { DatabaseHelper, GameVersion } from "../../Database.ts";
import { WebhookLogType } from "../../ModWebhooks.ts";

export type GameWebhookConfig = {
    url: string;
    types: WebhookLogType[] | [`all`];
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
}