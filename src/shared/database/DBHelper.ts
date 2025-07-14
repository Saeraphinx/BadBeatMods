import { Logger } from "../Logger.ts";
import { DatabaseManager, User } from "../Database.ts";
import { EditQueue } from "./models/EditQueue.ts";
import { GameVersion } from "./models/GameVersion.ts";
import { Project } from "./models/Project.ts";
import { Version } from "./models/Version.ts";
import { MOTD } from "./models/MOTD.ts";
import { Game } from "./models/Game.ts";

// #region Enums & Types
export type SupportedGames = string;
export type Category = string;

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
export type GameVersionAPIPublicResponseV2 = {
    id: number;
    gameName: SupportedGames;
    version: string;
    defaultVersion: boolean;
    createdAt?: Date;
    updatedAt?: Date;
};
export type GameVersionAPIPublicResponseV3 = {
    id: number;
    gameName: SupportedGames;
    version: string;
    defaultVersion: boolean;
    linkedVersionIds: number[];
};
export type ProjectAPIPublicResponseV2 = {
    id: number;
    name: string;
    summary: string;
    description: string;
    gameName: SupportedGames;
    category: Category;
    authors: UserAPIPublicResponse[];
    status: Status;
    iconFileName: string;
    gitUrl: string;
    lastApprovedById: number | null;
    lastUpdatedById: number;
    statusHistory: StatusHistory[];
    createdAt: Date;
    updatedAt: Date;
};
export type ProjectAPIPublicResponseV3 = {
    id: number;
    name: string;
    summary: string;
    description: string;
    gameName: SupportedGames;
    category: Category;
    authors: UserAPIPublicResponse[];
    status: Status;
    iconFileName: string;
    gitUrl: string;
    lastApprovedById: number | null;
    lastUpdatedById: number;
    statusHistory: StatusHistory[];
    versions: VersionAPIPublicResponseV3[];
    createdAt: Date;
    updatedAt: Date;
};
export type VersionAPIPublicResponseV2 = {
    id: number;
    modId: number;
    modVersion: string; // semver.raw
    author: UserAPIPublicResponse;
    platform: Platform;
    zipHash: string;
    contentHashes: ContentHash[];
    status: Status;
    dependencies: number[];
    supportedGameVersions: GameVersionAPIPublicResponseV2[];
    downloadCount: number;
    statusHistory: StatusHistory[];
    lastUpdatedById: number;
    lastApprovedById: number | null;
    fileSize: number;
    createdAt: Date;
    updatedAt: Date;
}

export type VersionAPIPublicResponseV3 = {
    id: number;
    projectId: number;
    modVersion: string; // semver.raw
    author: UserAPIPublicResponse;
    platform: Platform;
    zipHash: string;
    contentHashes: ContentHash[];
    status: Status;
    dependencies: Dependency[];
    supportedGameVersions: GameVersionAPIPublicResponseV3[];
    downloadCount: number;
    statusHistory: StatusHistory[];
    lastUpdatedById: number;
    lastApprovedById: number | null;
    fileSize: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserRolesObject {
    sitewide: UserRoles[];
    perGame: {
        [key: string]: UserRoles[];
    }
}

// if you remove these, you must update ValueUpdater.ts
export enum UserRoles {
    AllPermissions = `allpermissions`,
    Admin = `admin`,
    Poster = `poster`,
    GameManager = `gamemanager`,
    Approver = `approver`,
    LargeFiles = `largefiles`,
    Banned = `banned`,
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

export interface StatusHistory {
    status: Status;
    reason: string;
    userId: number;
    setAt: Date;
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
    Pending = `pending`,
    Verified = `verified`,
}

export interface Dependency {
    parentId: number; // mod/project id
    sv: string; // "^1.0.0"
}
// #endregion

// yoink thankies bstoday & bns
function validateEnumValue(value: string | number, enumType: object): boolean {
    if (Object.values(enumType).includes(value)) {
        return true;
    }
    return false;
}
// #region DatabaseHelper
export class DatabaseHelper {
    private static hasInitialized: boolean = false;
    public static database: DatabaseManager;
    public static cache: {
        gameVersions: GameVersion[],
        versions: Version[],
        projects: Project[],
        users: User[],
        editApprovalQueue: EditQueue[],
        motd: MOTD[],
        games: Game[],
    } = {
            gameVersions: [],
            versions: [],
            projects: [],
            users: [],
            editApprovalQueue: [],
            motd: [],
            games: [],
        };
    public static mapCache: {
        gameVersions: Map<number, GameVersion>,
        projects: Map<number, Project>,
        versions: Map<number, Version>,
        users: Map<number, User>,
    } = {
            gameVersions: new Map(),
            projects: new Map(),
            versions: new Map(),
            users: new Map(),
        };

    constructor(database: DatabaseManager) {
        DatabaseHelper.database = database;
    }

    public init(shouldLoadCache: boolean = true) {
        if (DatabaseHelper.hasInitialized) {
            Logger.warn(`DatabaseHelper has already been initialized. Skipping...`);
            return;
        }

        if (shouldLoadCache) {
            DatabaseHelper.refreshAllCaches();
        }
        setInterval(DatabaseHelper.refreshAllCaches, 1000 * 60 * 5);
    }

    public static async refreshAllCaches() {
        Logger.debug(`Refreshing all caches`);
        DatabaseHelper.cache.gameVersions = await DatabaseHelper.database.GameVersions.findAll();
        DatabaseHelper.cache.versions = await DatabaseHelper.database.Versions.findAll();
        DatabaseHelper.cache.projects = await DatabaseHelper.database.Projects.findAll();
        DatabaseHelper.cache.users = await DatabaseHelper.database.Users.findAll();
        DatabaseHelper.cache.editApprovalQueue = await DatabaseHelper.database.EditApprovalQueue.findAll();
        DatabaseHelper.cache.motd = await DatabaseHelper.database.MOTDs.findAll();
        DatabaseHelper.cache.games = await DatabaseHelper.database.Games.findAll();
        DatabaseHelper.mapCache.gameVersions = new Map(DatabaseHelper.cache.gameVersions.map((gameVersion) => [gameVersion.id, gameVersion]));
        DatabaseHelper.mapCache.projects = new Map(DatabaseHelper.cache.projects.map((project) => [project.id, project]));
        DatabaseHelper.mapCache.versions = new Map(DatabaseHelper.cache.versions.map((version) => [version.id, version]));
        DatabaseHelper.mapCache.users = new Map(DatabaseHelper.cache.users.map((user) => [user.id, user]));
        Logger.debug(`Finished refreshing all caches`);
    }

    public static async refreshCache(tableName: `gameVersions` | `versions` | `projects` | `users` | `editApprovalQueue` | `games`) {
        Logger.debug(`Refreshing cache for ${tableName}`);
        switch (tableName) {
            case `gameVersions`:
                DatabaseHelper.cache.gameVersions = await DatabaseHelper.database.GameVersions.findAll();
                DatabaseHelper.mapCache.gameVersions = new Map(DatabaseHelper.cache.gameVersions.map((gameVersion) => [gameVersion.id, gameVersion]));
                break;
            case `versions`:
                DatabaseHelper.cache.versions = await DatabaseHelper.database.Versions.findAll();
                DatabaseHelper.mapCache.versions = new Map(DatabaseHelper.cache.versions.map((version) => [version.id, version]));
                break;
            case `projects`:
                DatabaseHelper.cache.projects = await DatabaseHelper.database.Projects.findAll();
                DatabaseHelper.mapCache.projects = new Map(DatabaseHelper.cache.projects.map((project) => [project.id, project]));
                break;
            case `users`:
                DatabaseHelper.cache.users = await DatabaseHelper.database.Users.findAll();
                DatabaseHelper.mapCache.users = new Map(DatabaseHelper.cache.users.map((user) => [user.id, user]));
                break;
            case `editApprovalQueue`:
                DatabaseHelper.cache.editApprovalQueue = await DatabaseHelper.database.EditApprovalQueue.findAll();
                break;
            case `games`:
                DatabaseHelper.cache.games = await DatabaseHelper.database.Games.findAll();
                break;
        }
        Logger.debug(`Finished refreshing cache for ${tableName}`);
    }

    public static getGameNameFromProjectId(id: number): SupportedGames | null {
        let project = DatabaseHelper.mapCache.projects.get(id);
        if (!project) {
            return null;
        }
        return project.gameName;
    }

    public static getGameNameFromVersionId(id: number): SupportedGames | null {
        let version = DatabaseHelper.mapCache.versions.get(id);
        if (!version) {
            return null;
        }
        let project = DatabaseHelper.mapCache.projects.get(version.projectId);
        if (!project) {
            return null;
        }
        return project.gameName;
    }

    public static getGameNameFromEditApprovalQueueId(id: number): SupportedGames | undefined {
        let edit = DatabaseHelper.cache.editApprovalQueue.find((edit) => edit.id == id);
        if (!edit) {
            return undefined;
        }
        if (edit.isProject()) {
            if (`gameName` in edit.object && edit.object.gameName) {
                return edit.object.gameName as SupportedGames;
            } else {
                let gameName = DatabaseHelper.getGameNameFromProjectId(edit.objectId);
                return gameName ? gameName : undefined;
            }
        } else if (edit.isVersion()) {
            let gameName = DatabaseHelper.getGameNameFromVersionId(edit.objectId);
            return gameName ? gameName : undefined;
        }
    }

    public static isValidPlatform(value: string): value is Platform {
        return validateEnumValue(value, Platform);
    }
    
    public static isValidVisibility(value: string): value is Status {
        return validateEnumValue(value, Status);
    }

    public static isSupportedGame(name: unknown): name is SupportedGames {
        if (typeof name !== `string`) {
            return false;
        }
        
        if (this.cache.games.length === 0) {
            Logger.warn(`No games found in cache. Please ensure the database is initialized and games are loaded.`);
            return false;
        }
        
        if (this.cache.games.find((app) => app.name === name)) {
            return true;
        } else {
            return false;
        }
    }

    public static isValidCategory(value: unknown, gameName: SupportedGames): value is Category {
        if (typeof value !== `string`) {
            return false;
        }

        if (value === `Core` || value === `Essential` || value === `Other`) {
            return true; // Core, Essential, and Other are always valid categories
        }

        // Check if the category exists in any game
        let game = DatabaseHelper.cache.games.find((g) => g.name === gameName);
        if (game && game.categories.includes(value)) {
            return true;
        }
        return false;
    }


    public static async isValidGameVersion(gameName: string, version: string): Promise<number | null> {
        if (!gameName || !version) {
            return null;
        }

        if (!DatabaseHelper.isSupportedGame(gameName)) {
            return null;
        }

        let game = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName: gameName, version: version } });
        return game ? game.id : null;
    }

    public static isValidPostType(value: string): value is PostType {
        return validateEnumValue(value, PostType);
    }
}
// #endregion