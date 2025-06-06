import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { SupportedGames } from "../../Database.ts";
import { Mod } from "./Mod.ts";
import { ModVersion } from "./ModVersion.ts";
import { DatabaseHelper, GameVersionAPIPublicResponse, Platform, Status } from "../DBHelper.ts";
import { coerce } from "semver";

export type GameVersionInfer = InferAttributes<GameVersion>;
export class GameVersion extends Model<InferAttributes<GameVersion>, InferCreationAttributes<GameVersion>> {
    declare readonly id: CreationOptional<number>;
    declare gameName: SupportedGames;
    declare version: string; // semver-esc version (e.g. 1.29.1)
    declare defaultVersion: CreationOptional<boolean>;
    declare linkedVersionIds: CreationOptional<number[]>;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public toAPIResponse(): GameVersionAPIPublicResponse {
        return {
            id: this.id,
            gameName: this.gameName,
            version: this.version,
            defaultVersion: this.defaultVersion,
        };
    }

    public static async getDefaultVersion(gameName: SupportedGames): Promise<string | undefined> {
        let version: GameVersion | undefined = DatabaseHelper.cache.gameVersions.find((version) => version.gameName == gameName && version.defaultVersion == true);
        if (!version) {
            let dbVer = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName, defaultVersion: true } });
            if (dbVer) {
                version = dbVer;
            }
        }
        if (!version) {
            return undefined;
        }
        return version.version;
    }

    public static async getDefaultVersionObject(gameName: SupportedGames): Promise<GameVersion | undefined> {
        let version = DatabaseHelper.cache.gameVersions.find((version) => version.gameName == gameName && version.defaultVersion == true);
        if (!version) {
            let dbVer = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName, defaultVersion: true } });
            if (dbVer) {
                version = dbVer;
            }
        }
        return version;
    }

    public async getSupportedMods(platform: Platform, statusesToSearchFor: Status[]): Promise<{mod: Mod, latest:ModVersion}[]> {
        let mods = DatabaseHelper.cache.mods.filter((mod) => mod.gameName == this.gameName && statusesToSearchFor.includes(mod.status));

        let supportedMods: {mod: Mod, latest:ModVersion}[] = [];
        for (let mod of mods) {
            // get the latest version for the mod, and if it exists, add it to the list of supported mods
            let latest = await mod.getLatestVersion(this.id, platform, statusesToSearchFor);
            if (latest) {
                supportedMods.push({mod, latest});
            }
        }
        return supportedMods;
    }

    public static compareVersions(a: GameVersion, b: GameVersion): number {
        let svA = coerce(a.version, { loose: true });
        let svB = coerce(b.version, { loose: true });
        if (svA && svB) {
            return svA.compare(svB); // the earliest version is first in the array
        } else {
            return b.version.localeCompare(a.version);
        }
    }

    public static getGames() {
        let games: SupportedGames[] = [];
        for (let version of DatabaseHelper.cache.gameVersions) {
            if (!games.includes(version.gameName)) {
                games.push(version.gameName);
            }
        }
        return games;
    }
}