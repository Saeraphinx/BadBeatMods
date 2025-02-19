import { Logger } from "../Logger";
import { DatabaseManager, SupportedGames } from "../Database";
import { EditQueue } from "./models/EditQueue";
import { GameVersion } from "./models/GameVersion";
import { Mod } from "./models/Mod";
import { ModVersion } from "./models/ModVersion";
import { MOTD } from "./models/MOTD";
import { User, UserRolesObject } from "./models/User";

export type UserAPIPublicResponse = {
    id: number;
    username: string;
    githubId: string | null;
    sponsorUrl: string | null;
    displayName: string;
    roles: UserRolesObject;
    bio: string;
    createdAt: Date;
    updatedAt: Date;
}
export type GameVersionAPIPublicResponse = {
    id: number;
    gameName: SupportedGames;
    version: string;
    defaultVersion: boolean;
    createdAt?: Date;
    updatedAt?: Date;
};
export type ModAPIPublicResponse = {
    id: number;
    name: string;
    summary: string;
    description: string;
    gameName: SupportedGames;
    category: Categories;
    authors: UserAPIPublicResponse[];
    status: Status;
    iconFileName: string;
    gitUrl: string;
    lastApprovedById: number | null;
    lastUpdatedById: number;
    createdAt: Date;
    updatedAt: Date;
};
export type ModVersionAPIPublicResponse = {
    id: number;
    modId: number;
    modVersion: string; // semver.raw
    author: UserAPIPublicResponse;
    platform: Platform;
    zipHash: string;
    contentHashes: ContentHash[];
    status: Status;
    dependencies: number[];
    supportedGameVersions: GameVersionAPIPublicResponse[];
    downloadCount: number;
    fileSize: number;
    createdAt: Date;
    updatedAt: Date;
}

export enum PostType {
    Emergency = `emergency`,
    GameUpdates = `gameupdates`,
    Community = `community`
}

export interface Translations {
    lang: string;
    message: string;
}

export interface ContentHash {
    path: string;
    hash: string;
}

export enum Platform {
    SteamPC = `steampc`,
    OculusPC = `oculuspc`,
    UniversalPC = `universalpc`,
    // Quest will be one option, as PC does not have individual options for Index, Vive, etc.
    UniversalQuest = `universalquest`,
}

export enum Status {
    Private = `private`,
    Removed = `removed`,
    Unverified = `unverified`,
    Verified = `verified`,
}

export enum Categories {
    Core = `core`, // BSIPA, SongCore, etc
    Essential = `essential`, // Camera2, BeatSaverDownloader, BeatSaverUpdater, etc
    Library = `library`,
    Cosmetic = `cosmetic`,
    PracticeTraining = `practice`,
    Gameplay = `gameplay`,
    StreamTools = `streamtools`,
    UIEnhancements = `ui`,
    Lighting = `lighting`,
    TweaksTools = `tweaks`,
    Multiplayer = `multiplayer`,
    TextChanges = `text`,
    Editor = `editor`,
    Other = `other`,
}

// yoink thankies bstoday & bns
function validateEnumValue(value: string | number, enumType: object): boolean {
    if (Object.values(enumType).includes(value)) {
        return true;
    }
    return false;
}

export class DatabaseHelper {
    public static database: DatabaseManager;
    public static cache: {
        gameVersions: GameVersion[],
        modVersions: ModVersion[],
        mods: Mod[],
        users: User[],
        editApprovalQueue: EditQueue[],
        motd: MOTD[],
    } = {
            gameVersions: [],
            modVersions: [],
            mods: [],
            users: [],
            editApprovalQueue: [],
            motd: [],
        };

    constructor(database: DatabaseManager, loadCache = true) {
        DatabaseHelper.database = database;
        if (loadCache) {
            DatabaseHelper.refreshAllCaches();
        }

        setInterval(DatabaseHelper.refreshAllCaches, 1000 * 60 * 5);
    }

    public static async refreshAllCaches() {
        Logger.debug(`Refreshing all caches`);
        DatabaseHelper.cache.gameVersions = await DatabaseHelper.database.GameVersions.findAll();
        DatabaseHelper.cache.modVersions = await DatabaseHelper.database.ModVersions.findAll();
        DatabaseHelper.cache.mods = await DatabaseHelper.database.Mods.findAll();
        DatabaseHelper.cache.users = await DatabaseHelper.database.Users.findAll();
        DatabaseHelper.cache.editApprovalQueue = await DatabaseHelper.database.EditApprovalQueue.findAll();
        DatabaseHelper.cache.motd = await DatabaseHelper.database.MOTDs.findAll();
        Logger.debug(`Finished refreshing all caches`);
    }

    public static async refreshCache(tableName: `gameVersions` | `modVersions` | `mods` | `users` | `editApprovalQueue`) {
        Logger.debug(`Refreshing cache for ${tableName}`);
        switch (tableName) {
            case `gameVersions`:
                DatabaseHelper.cache.gameVersions = await DatabaseHelper.database.GameVersions.findAll();
                break;
            case `modVersions`:
                DatabaseHelper.cache.modVersions = await DatabaseHelper.database.ModVersions.findAll();
                break;
            case `mods`:
                DatabaseHelper.cache.mods = await DatabaseHelper.database.Mods.findAll();
                break;
            case `users`:
                DatabaseHelper.cache.users = await DatabaseHelper.database.Users.findAll();
                break;
            case `editApprovalQueue`:
                DatabaseHelper.cache.editApprovalQueue = await DatabaseHelper.database.EditApprovalQueue.findAll();
                break;
        }
        Logger.debug(`Finished refreshing cache for ${tableName}`);
    }

    public static getGameNameFromModId(id: number): SupportedGames | null {
        let mod = DatabaseHelper.cache.mods.find((mod) => mod.id == id);
        if (!mod) {
            return null;
        }
        return mod.gameName;
    }

    public static getGameNameFromModVersionId(id: number): SupportedGames | null {
        let modVersion = DatabaseHelper.cache.modVersions.find((modVersion) => modVersion.id == id);
        if (!modVersion) {
            return null;
        }
        let mod = DatabaseHelper.cache.mods.find((mod) => mod.id == modVersion.modId);
        if (!mod) {
            return null;
        }
        return mod.gameName;
    }

    public static getGameNameFromEditApprovalQueueId(id: number): SupportedGames | undefined {
        let edit = DatabaseHelper.cache.editApprovalQueue.find((edit) => edit.id == id);
        if (!edit) {
            return undefined;
        }
        if (edit.objectTableName == `mods` && `gameName` in edit.object) {
            return edit.object.gameName;
        } else if (edit.objectTableName == `modVersions`) {
            let gameName = DatabaseHelper.getGameNameFromModVersionId(edit.objectId);
            return gameName ? gameName : undefined;
        }
    }

    public static isValidPlatform(value: string): value is Platform {
        return validateEnumValue(value, Platform);
    }
    
    public static isValidVisibility(value: string): value is Status {
        return validateEnumValue(value, Status);
    }

    public static isValidCategory(value: string): value is Categories {
        return validateEnumValue(value, Categories);
    }

    public static isValidGameName(name: any): name is SupportedGames {
        if (!name) {
            return false;
        }

        if (typeof name !== `string` && typeof name !== `number`) {
            return false;
        }
        
        return validateEnumValue(name, SupportedGames);
    }

    public static async isValidGameVersion(gameName: string, version: string): Promise<number | null> {
        if (!gameName || !version) {
            return null;
        }

        if (!DatabaseHelper.isValidGameName(gameName)) {
            return null;
        }

        let game = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName: gameName, version: version } });
        return game ? game.id : null;
    }

    public static isValidPostType(value: string): value is PostType {
        return validateEnumValue(value, PostType);
    }
}