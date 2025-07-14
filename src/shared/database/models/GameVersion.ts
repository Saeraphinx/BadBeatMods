import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { SupportedGames } from "../../Database.ts";
import { Project } from "./Project.ts";
import { Version } from "./Version.ts";
import { DatabaseHelper, GameVersionAPIPublicResponseV2, GameVersionAPIPublicResponseV3, Platform, Status } from "../DBHelper.ts";
import { coerce } from "semver";
import { Logger } from "../../../shared/Logger.ts";

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

    public toAPIResponse(apiVersion: `v2`): GameVersionAPIPublicResponseV2;
    public toAPIResponse(apiVersion: `v3`): GameVersionAPIPublicResponseV3;
    public toAPIResponse(apiVersion: `v2` | `v3`): GameVersionAPIPublicResponseV2 | GameVersionAPIPublicResponseV3;
    public toAPIResponse(apiVersion: `v2` | `v3`): GameVersionAPIPublicResponseV2 | GameVersionAPIPublicResponseV3 {
        if (apiVersion === `v2`) {
            return {
                id: this.id,
                gameName: this.gameName,
                version: this.version,
                defaultVersion: this.defaultVersion,
                createdAt: this.createdAt,
                updatedAt: this.updatedAt,
            };
        } else {
            return {
                id: this.id,
                gameName: this.gameName,
                version: this.version,
                defaultVersion: this.defaultVersion,
                linkedVersionIds: this.linkedVersionIds || [],
            };
        }
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

    public async getSupportedMods(platform: Platform, statusesToSearchFor: Status[]): Promise<{project: Project, version:Version}[]> {
        let projects = DatabaseHelper.cache.projects.filter((p) => p.gameName == this.gameName && statusesToSearchFor.includes(p.status));

        let supportedMods: {project: Project, version:Version}[] = [];
        for (let project of projects) {
            // get the latest version for the project, and if it exists, add it to the list of supported projects
            let latest = await project.getLatestVersion(this.id, platform, statusesToSearchFor);
            if (latest) {
                supportedMods.push({project: project, version: latest});
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
            return a.version.localeCompare(b.version);
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

    public async addLinkToGameVersion(versionToLinkTo: GameVersion) {
        let thisLinkedIDs = this.linkedVersionIds ? [...this.linkedVersionIds] : [];

        if (thisLinkedIDs.includes(versionToLinkTo.id)) {
            throw new Error(`Version ${versionToLinkTo.id} is already linked to this version.`);
        }

        if (versionToLinkTo.id === this.id) {
            throw new Error(`Cannot link version ${versionToLinkTo.id} to itself.`);
        }

        if (versionToLinkTo.gameName !== this.gameName) {
            throw new Error(`Cannot link version ${versionToLinkTo.id} to version ${this.id} because they are from different games.`);
        }

        thisLinkedIDs.push(versionToLinkTo.id);
        let thisObj = await this.update({
            linkedVersionIds: thisLinkedIDs
        });
        // the linked version gets linked to this version in hooks.
        await versionToLinkTo.update({
            linkedVersionIds: [...(versionToLinkTo.linkedVersionIds || []), this.id]
        });
        return thisObj;
    }

    public async removeLinkToGameVersion(versionToUnlink: GameVersion) {
        let thisLinkedIds = this.linkedVersionIds ? [...this.linkedVersionIds] : [];

        if (!thisLinkedIds.includes(versionToUnlink.id)) {
            throw new Error(`Version ${versionToUnlink.id} is not linked to this version.`);
        }

        let updatedVersion = await this.update({
            linkedVersionIds: thisLinkedIds.filter((id) => id !== versionToUnlink.id) // the linked version gets unlinked from this version in hooks.
        }).catch((err) => {
            Logger.error(`Failed to unlink version ${versionToUnlink.id} from ${this.id}: ${err.message}`);
            throw err;
        });

        await versionToUnlink.update({
            linkedVersionIds: versionToUnlink.linkedVersionIds.filter((id) => id !== this.id) // remove this version from the linked versions of the other version, as the hook doesn't process this atm.
        }).catch((err) => {
            Logger.error(`Failed to unlink version ${this.id} from ${versionToUnlink.id}: ${err.message}`);
            throw err;
        });

        return updatedVersion;
    }
}