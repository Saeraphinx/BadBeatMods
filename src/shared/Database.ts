import path from "path";
import { exit } from "process";
import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, ModelStatic, Op, Sequelize } from "sequelize";
import { Logger } from "./Logger";
import { satisfies, SemVer } from "semver";
import { Config } from "./Config";
import { sendEditLog, sendModLog, sendModVersionLog } from "./ModWebhooks";

export enum SupportedGames {
    BeatSaber = `BeatSaber`,
    ChroMapper = `ChroMapper`,
    TromboneChampUnflattened = `TromboneChampUnflattened`,
    SpinRhythmXD = `SpinRhythmXD`,
}

function isValidDialect(dialect: string): dialect is `sqlite` |`postgres` {
    return [`sqlite`, `postgres`].includes(dialect);
}

export class DatabaseManager {
    public sequelize: Sequelize;
    public Users: ModelStatic<User>;
    public ModVersions: ModelStatic<ModVersion>;
    public Mods: ModelStatic<Mod>;
    public GameVersions: ModelStatic<GameVersion>;
    public EditApprovalQueue: ModelStatic<EditQueue>;
    public MOTDs: ModelStatic<MOTD>;
    public serverAdmin: User;

    constructor() {
        Logger.log(`Loading Database...`);

        this.sequelize = new Sequelize(`bbm_database`, Config.database.username, Config.database.password, {
            host: Config.database.dialect === `sqlite` ? `localhost` : Config.database.url,
            port: Config.database.dialect === `sqlite` ? undefined : 5432,
            dialect: isValidDialect(Config.database.dialect) ? Config.database.dialect : `sqlite`,
            logging: Config.flags.logRawSQL ? console.log : false,
            storage: Config.database.dialect === `sqlite` ? path.resolve(Config.database.url) : undefined,
        });

        this.loadTables();
    }

    public async init() {
        /*if (Config.database.dialect === `postgres`) {
            const client = new Client({
                user: Config.database.username,
                password: Config.database.password,
                host: Config.database.url,
                port: 5432,
            });
            client.connect();
            client.query(`CREATE DATABASE IF NOT EXISTS bbm_database;`).catch((error) => {
                Logger.error(`Error creating database: ${error}`);
                client.end();
                exit(-1);
            });
        }*/

        if (Config.database.dialect === `postgres`) {
            if (Config.database.alter === true) {
                Logger.warn(`Database alterations are not supported on PostgreSQL databases and have caused a crash. Be warned.`);
            }
        }

        await this.sequelize.sync({
            alter: Config.database.alter,
        }).then(async () => {
            Logger.log(`Database Loaded.`);
            new DatabaseHelper(this, false);
            await DatabaseHelper.refreshAllCaches();

            let serverAdmin = await this.Users.findByPk(1).then((user) => {
                if (!user) {
                    return this.Users.create({
                        username: `ServerAdmin`,
                        discordId: `1`,
                        roles: {
                            sitewide: [UserRoles.AllPermissions],
                            perGame: {},
                        },
                        githubId: null,
                        sponsorUrl: ``,
                        displayName: ``,
                        bio: ``
                    }).then((user) => {
                        Logger.log(`Created built in server account.`);
                        return user;
                    }).catch((error) => {
                        Logger.error(`Error creating built in server account: ${error}`);
                        return null;
                    });
                } else {
                    if (!user.roles.sitewide.includes(UserRoles.AllPermissions)) {
                        if (user.username != `ServerAdmin`) {
                            Logger.warn(`Server account has been tampered with!`);
                        } else {
                            user.addSiteWideRole(UserRoles.AllPermissions);
                            Logger.log(`Added AllPermissions role to server account.`);
                        }
                    }
                    return user;
                }
            });

            if (!serverAdmin) {
                Logger.error(`Server account not found.`);
                exit(-1);
            }

            this.serverAdmin = serverAdmin;

            if (Config.flags.enableDBHealthCheck) {
                if (Config.database.dialect === `sqlite`) {
                    this.checkIntegrity();
                    setInterval(() => {
                        this.checkIntegrity();
                    }, 1000 * 60 * 60 * 1);
                } else {
                    Logger.warn(`Database health check is only available for SQLite databases.`);
                }
            }
        }).catch((error) => {
            if (Config.database.dialect === `postgres`) {
                if (error.name == `SequelizeConnectionError` && error.message.includes(`database "bbm_database" does not exist`)) {
                    Logger.error(`Database "bbm_database" does not exist on the PostgreSQL server. Please create the database in pgAdmin and restart the server.`);
                    exit(-1);
                }
            }
            Logger.error(`Error loading database: ${error}`);
            exit(-1);
        });

            
    }

    public async checkIntegrity() {
        if (Config.flags.enableDBHealthCheck) {
            if (Config.database.dialect === `sqlite`) {
                this.sequelize.query(`PRAGMA integrity_check;`).then((healthcheck) => {
                    try {
                        let healthcheckString = (healthcheck[0][0] as any).integrity_check;
                        Logger.log(`Database health check: ${healthcheckString}`);
                        return healthcheckString;
                    } catch (error) {
                        Logger.error(`Error checking database health: ${error}`);
                        return error;
                    }
                }).catch((error) => {
                    Logger.error(`Error checking database health: ${error}`);
                    return error;
                });
            } else {
                Logger.warn(`Database integrity check is only available for SQLite databases.`);
            }
        } else {
            Logger.warn(`Database health check is disabled.`);
        }
    }

    
    // #region LoadTables
    private loadTables() {
        this.Users = User.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                unique: true,
            },
            username: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: ``,
            },
            githubId: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: null,
                unique: true, //SQLite treats all NULL values are different, therefore, a column with a UNIQUE constraint can have multiple NULL values.
            },
            sponsorUrl: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: ``,
            },
            discordId: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: ``,
            },
            displayName: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: ``,
            },
            bio: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            roles: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`roles`));
                },
                set(value: string[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`roles`, JSON.stringify(value));
                },
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `users`,
            paranoid: true,
        });

        this.GameVersions = GameVersion.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                unique: true,
            },
            gameName: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: ``,
            },
            version: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: ``,
            },
            defaultVersion: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `gameVersions`,
            paranoid: true,
        });

        this.Mods = Mod.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                unique: true,
            },
            name: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            summary: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            gameName: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: SupportedGames.BeatSaber,
            },
            category: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `other`,
            },
            authorIds: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`authorIds`));
                },
                set(value: number[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`authorIds`, JSON.stringify(value));
                },
            },
            iconFileName: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            gitUrl: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: `private`,
            },
            lastApprovedById: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            lastUpdatedById: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            fileSize: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE
        }, {
            sequelize: this.sequelize,
            modelName: `mods`,
            paranoid: true,
        });

        this.ModVersions = ModVersion.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                unique: true,
            },
            modId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            authorId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            modVersion: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
                get() {
                    return new SemVer(this.getDataValue(`modVersion`));
                },
                set(value: SemVer) {
                    // @ts-expect-error ts(2345)
                    this.setDataValue(`modVersion`, value.raw);
                },
            },
            supportedGameVersionIds: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`supportedGameVersionIds`));
                },
                set(value: number[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`supportedGameVersionIds`, JSON.stringify(value));
                },
            },
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: `private`,
            },
            platform: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: Platform.UniversalPC,
            },
            zipHash: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            contentHashes: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`contentHashes`));
                },
                set(value: ContentHash[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`contentHashes`, JSON.stringify(value));
                },
            },
            dependencies: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`dependencies`));
                },
                set(value: number[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`dependencies`, JSON.stringify(value));
                }
            },
            downloadCount: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            lastApprovedById: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            lastUpdatedById: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            fileSize: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `modVersions`,
            paranoid: true,
        });

        this.EditApprovalQueue = EditQueue.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                unique: true,
            },
            submitterId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            objectId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            objectTableName: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            object: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `{}`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`object`));
                },
                set(value: any) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`object`, JSON.stringify(value));
                },
            },
            approverId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: null,
            },
            approved: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
                defaultValue: null,
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `editApprovalQueue`,
            paranoid: true,
        });

        this.MOTDs = MOTD.init({
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                unique: true,
            },
            gameName: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: ``,
            },
            gameVersionIds: {
                type: DataTypes.TEXT,
                allowNull: true,
                defaultValue: null,
                get() {
                    // @ts-expect-error ts(2345)
                    let value = this.getDataValue(`gameVersionIds`) as string;
                    if (value) {
                        return JSON.parse(value);
                    }
                },
                set(value: number[] | null) {
                    if (value) {
                        // @ts-expect-error ts(2345)
                        this.setDataValue(`gameVersionIds`, JSON.stringify(value));
                    } else {
                        this.setDataValue(`gameVersionIds`, null);
                    }
                }
            },
            platforms: {
                type: DataTypes.TEXT,
                allowNull: true,
                get() {
                    // @ts-expect-error ts(2345)
                    let value = this.getDataValue(`platforms`) as string;
                    if (value) {
                        return JSON.parse(value);
                    }
                },
                set(value: number[] | null) {
                    if (value) {
                        // @ts-expect-error ts(2345)
                        this.setDataValue(`platforms`, JSON.stringify(value));
                    } else {
                        this.setDataValue(`platforms`, null);
                    }
                }
            },
            message: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: ``,
            },
            translations: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`translations`));
                },
                set(value: string[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`translations`, JSON.stringify(value));
                },
            },
            startTime: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            endTime: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            postType: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `community`,
            },
            authorId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `motds`,
            paranoid: true,

        });
        // #endregion

        // #region Hooks
        this.Mods.afterValidate(async (mod) => {
            await Mod.checkForExistingMod(mod.name).then((existingMod) => {
                if (existingMod) {
                    if (existingMod.id != mod.id) {
                        throw new Error(`Mod already exists.`);
                    }
                }
            });

            if (mod.authorIds.length == 0) {
                throw new Error(`Mod must have at least one author.`);
            }
        });

        this.ModVersions.afterValidate(async (modVersion) => {
            let parentMod = await Mod.findByPk(modVersion.modId);

            if (!parentMod) {
                throw new Error(`ModVersion must have a valid modId.`);
            }

            await ModVersion.checkForExistingVersion(modVersion.modId, modVersion.modVersion, modVersion.platform).then((existingVersion) => {
                if (existingVersion) {
                    if (existingVersion.id != modVersion.id && modVersion.status == Status.Verified) {
                        throw new Error(`Edit would cause a duplicate version.`);
                    }
                }
            });

            if (modVersion.supportedGameVersionIds.length == 0) {
                throw new Error(`ModVersion must support at least one game version.`);
            }

            //dedupe supported game versions
            modVersion.supportedGameVersionIds = [...new Set(modVersion.supportedGameVersionIds)];
            let gameVersions = await this.GameVersions.findAll({ where: { id: modVersion.supportedGameVersionIds } });
            if (gameVersions.length == 0) {
                throw new Error(`No valid game versions found.`);
            }

            if (gameVersions.length != modVersion.supportedGameVersionIds.length) {
                throw new Error(`Invalid or duplicate game version(s) found.`);
            }

            for (let gameVersion of gameVersions) {
                if (gameVersion.gameName != parentMod.gameName) {
                    throw new Error(`ModVersion must only have game versions for the parent mod's game.`);
                }
            }

            if (modVersion.dependencies.length > 0) {
                //dedupe dependencies
                modVersion.dependencies = [...new Set(modVersion.dependencies)];
                let dependencies = await ModVersion.findAll({ where: { id: modVersion.dependencies } });
                if (dependencies.length != modVersion.dependencies.length) {
                    throw new Error(`Invalid dependencies found.`);
                }

                for (let dependency of dependencies) {
                    if (dependency.modId == modVersion.modId) {
                        throw new Error(`ModVersion cannot depend on itself.`);
                    }
                }
            }
        });

        // this is just to make sure that there is always a default version for a game, as otherwise a bunch of endpoints won't know what to do.
        this.GameVersions.beforeCreate(async (gameVersion) => {
            await GameVersion.findOne({ where: { gameName: gameVersion.gameName, defaultVersion: true }}).then((existingVersion) => {
                if (!existingVersion) {
                    gameVersion.defaultVersion = true;
                }
            });
        });

        this.EditApprovalQueue.beforeCreate(async (queueItem) => {
            if (!queueItem.isMod() && !queueItem.isModVersion()) {
                throw new Error(`Invalid object type.`);
            }
        });
    }
    // #endregion
}
// #region User
export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare readonly id: CreationOptional<number>;
    declare username: string;
    declare githubId: string | null;
    declare discordId: string | null;
    declare sponsorUrl: string | null;
    declare displayName: string;
    declare bio: string;
    declare roles: UserRolesObject;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date>;

    public addSiteWideRole(role: UserRoles) {
        if (!this.roles.sitewide.includes(role)) {
            this.roles = {
                sitewide: [...this.roles.sitewide, role],
                perGame: this.roles.perGame,
            };
            this.save();
        } else {
            Logger.warn(`User ${this.username} already has role ${role}`);
        }
    }

    public addPerGameRole(game: SupportedGames, role: UserRoles) {
        let roleObj = { ...this.roles };
        if (!roleObj.perGame[game]) {
            roleObj.perGame[game] = [];
        }

        if (!roleObj.perGame[game].includes(role)) {
            roleObj.perGame[game] = [...roleObj.perGame[game], role];
            this.roles = roleObj;
            this.save();
        } else {
            Logger.warn(`User ${this.username} already has role ${role} for game ${game}`);
        }
    }

    public removeSiteWideRole(role: UserRoles) {
        if (this.roles.sitewide.includes(role)) {
            this.roles = {
                sitewide: this.roles.sitewide.filter((r) => r != role),
                perGame: this.roles.perGame,
            };
            this.save();
        } else {
            Logger.warn(`User ${this.username} does not have role ${role}`);
        }
    }

    public removePerGameRole(game: SupportedGames, role: UserRoles) {
        let roleObj = { ...this.roles };
        if (roleObj.perGame[game] && roleObj.perGame[game].includes(role)) {
            roleObj.perGame[game] = roleObj.perGame[game].filter((r) => r != role);
            this.roles = roleObj;
            this.save();
        } else {
            Logger.warn(`User ${this.username} does not have role ${role} for game ${game}`);
        }
    }

    public toAPIResponse() {
        return {
            id: this.id.valueOf(), // this is a number, but the type system doesn't like it
            username: this.username,
            githubId: this.githubId,
            sponsorUrl: this.sponsorUrl,
            displayName: this.displayName,
            roles: this.roles,
            bio: this.bio,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}

export interface UserRolesObject {
    sitewide: UserRoles[];
    perGame: {
        [gameName in SupportedGames]?: UserRoles[];
    }
}

export enum UserRoles {
    AllPermissions = `allpermissions`,
    Admin = `admin`,
    Poster = `poster`,
    Approver = `approver`,
    Moderator = `moderator`,
    Banned = `banned`,
}
// #endregion
// #region GameVersion
export class GameVersion extends Model<InferAttributes<GameVersion>, InferCreationAttributes<GameVersion>> {
    declare readonly id: CreationOptional<number>;
    declare gameName: SupportedGames;
    declare version: string; // semver-esc version (e.g. 1.29.1)
    declare defaultVersion: boolean;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date>;

    public toAPIResponse() {
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
}
// #endregion
// #region Mod
export class Mod extends Model<InferAttributes<Mod>, InferCreationAttributes<Mod>> {
    declare readonly id: CreationOptional<number>;
    declare name: string;
    declare summary: string;
    declare description: string;
    declare gameName: SupportedGames;
    declare category: Categories;
    declare authorIds: number[];
    declare status: Status;
    declare iconFileName: string;
    declare gitUrl: string;
    declare lastApprovedById: CreationOptional<number> | null;
    declare lastUpdatedById: number;
    declare fileSize: number;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date>;

    public async getLatestVersion(gameVersionId: number, platform: Platform, statusesToSearchFor: Status[]): Promise<ModVersion | null> {
        let versions = DatabaseHelper.cache.modVersions.filter((version) => {
            // if the version is not for the correct platform
            if (version.modId !== this.id) {
                return false;
            }

            if (!statusesToSearchFor.includes(version.status)) {
                return false;
            }

            // if the version is not for the correct game
            if (!version.supportedGameVersionIds.includes(gameVersionId)) {
                return false;
            }

            if (version.platform === Platform.UniversalQuest) {
                return platform === Platform.UniversalQuest;
            } else {
                if (version.platform === Platform.UniversalPC || version.platform === platform) {
                    return true;
                }
            }
        });

        let latest = null;
        for (let version of versions) {
            if (!latest || version.modVersion.compare(latest.modVersion) > 0) {
                latest = version;
            }
        }

        return latest;
    }

    public async setStatus(status:Status, user: User) {
        this.status = status;
        try {
            await this.save();
        } catch (error) {
            Logger.error(`Error setting status: ${error}`);
            throw error;
        }
        Logger.log(`Mod ${this.id} set to status ${status} by ${user.username}`);
        switch (status) {
            case Status.Unverified:
                sendModLog(this, user, `New`);
                break;
            case Status.Verified:
                this.lastApprovedById = user.id;
                sendModLog(this, user, `Approved`);
                break;
            case Status.Removed:
                sendModLog(this, user, `Rejected`);
                break;
        }
        return this;
    }

    public static async checkForExistingMod(name: string) {
        let mod = await DatabaseHelper.database.Mods.findOne({ where: { name: name } });
        return mod;
    }

    public static async countExistingMods(name: string) {
        let count = await DatabaseHelper.database.Mods.count({ where: { name: name } });
        return count;
    }

    public toAPIResponse() {
        return {
            id: this.id,
            name: this.name,
            summary: this.summary,
            description: this.description,
            gameName: this.gameName,
            category: this.category,
            authors: DatabaseHelper.cache.users.filter((user) => this.authorIds.includes(user.id)).map((user) => user.toAPIResponse()),
            status: this.status,
            iconFileName: this.iconFileName,
            gitUrl: this.gitUrl,
            lastApprovedById: this.lastApprovedById,
            lastUpdatedById: this.lastUpdatedById,
            fileSize: this.fileSize,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}
// #endregion
// #region ModVersion
export class ModVersion extends Model<InferAttributes<ModVersion>, InferCreationAttributes<ModVersion>> {
    declare readonly id: CreationOptional<number>;
    declare modId: number;
    declare authorId: number;
    declare modVersion: SemVer;
    declare supportedGameVersionIds: number[];
    declare status: Status;
    declare dependencies: number[]; // array of modVersion ids
    declare platform: Platform;
    declare zipHash: string;
    declare contentHashes: ContentHash[];
    declare downloadCount: CreationOptional<number>;
    declare lastApprovedById: CreationOptional<number> | null;
    declare lastUpdatedById: number;
    declare fileSize: number;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public async setStatus(status:Status, user: User) {
        this.status = status;
        try {
            await this.save();
        } catch (error) {
            Logger.error(`Error setting status: ${error}`);
            throw error;
        }
        Logger.log(`Mod ${this.id} approved by ${user.username}`);
        switch (status) {
            case Status.Unverified:
                sendModVersionLog(this, user, `New`);
                break;
            case Status.Verified:
                this.lastApprovedById = user.id;
                sendModVersionLog(this, user, `Approved`);
                break;
            case Status.Removed:
                sendModVersionLog(this, user, `Rejected`);
                break;
        }
        return this;
    }

    public addGameVersionId(gameVersionId: number, submitterId: number) {
        if (this.supportedGameVersionIds.includes(gameVersionId)) {
            return Promise.resolve(null);
        }

        if (this.status !== Status.Verified) {
            this.supportedGameVersionIds = [...this.supportedGameVersionIds, gameVersionId];
            return this.save();
        } else {
            return DatabaseHelper.database.EditApprovalQueue.create({
                submitterId: submitterId,
                objectId: this.id,
                objectTableName: `modVersions`,
                object: {
                    dependencies: this.dependencies,
                    modVersion: this.modVersion,
                    platform: this.platform,
                    supportedGameVersionIds: [...this.supportedGameVersionIds, gameVersionId],
                    fileSize: this.fileSize
                },
            });
        }
    }

    // this function called to see if a duplicate version already exists in the database. if it does, creation of a new version should be halted.
    public static async checkForExistingVersion(modId: number, semver: SemVer, platform:Platform): Promise<ModVersion | null> {
        let modVersion = DatabaseHelper.database.ModVersions.findOne({ where: { modId: modId, modVersion: semver.raw, platform: platform, [Op.or]: [{status: Status.Verified}, {status: Status.Unverified}, {status: Status.Private }] } });
        return modVersion;
    }

    public static async countExistingVersions(modId: number, semver: SemVer, platform:Platform): Promise<number> {
        let count = DatabaseHelper.database.ModVersions.count({ where: { modId: modId, modVersion: semver.raw, platform: platform, [Op.or]: [{status: Status.Verified}, {status: Status.Unverified}, {status: Status.Private }] } });
        return count;
    }

    public async getSupportedGameVersions(): Promise<GameVersionAPIPublicResponse[]> {
        let gameVersions: GameVersionAPIPublicResponse[] = [];
        for (let versionId of this.supportedGameVersionIds) {
            let version = DatabaseHelper.cache.gameVersions.find((version) => version.id == versionId);
            if (!version) {
                let dbVer = await DatabaseHelper.database.GameVersions.findByPk(versionId);
                if (dbVer) {
                    version = dbVer;
                }
            }

            if (version) {
                gameVersions.push(version.toAPIResponse());
            }

        }
        return gameVersions;
    }

    public async getUpdatedDependencies(gameVersionId: number, statusesToSearchFor: Status[]): Promise<ModVersion[] | null> {
        let dependencies = [];

        for (let dependencyId of this.dependencies) {
            let dependency = DatabaseHelper.cache.modVersions.find((version) => version.id == dependencyId);
            if (!dependency) {
                let dbDep = await DatabaseHelper.database.ModVersions.findByPk(dependencyId);
                if (dbDep) {
                    dependency = dbDep;
                } else {
                    Logger.error(`Failed to find dependency ${dependencyId} (Req by ${this.id})`);
                    return null;
                }
            }

            let parentMod = DatabaseHelper.cache.mods.find((mod) => mod.id == dependency.modId);
            if (!parentMod) {
                let dbMod = await DatabaseHelper.database.Mods.findByPk(dependency.modId);
                if (dbMod) {
                    parentMod = dbMod;
                } else {
                    Logger.error(`Failed to find parent mod ${dependency.modId} for dependency ${dependency.id} (Req by ${this.id})`);
                    return null;
                }
            }

            let latestVersion = await parentMod.getLatestVersion(gameVersionId, dependency.platform, statusesToSearchFor);
            if (latestVersion) {
                dependencies.push(latestVersion);
            } else {
                Logger.debugWarn(`Failed to find latest version for dependency ${dependency.id} (Req by ${this.id})`);
                return null;
            }
        }

        return dependencies;
    }
    // this function is for when a mod supports a newer version but the dependancy does not. (uses ^x.x.x for comparison)
    public static async isValidDependancySucessor(originalVersion:ModVersion, newVersion:ModVersion, forVersion: number): Promise<boolean> {
        let newGameVersions = await newVersion.getSupportedGameVersions();

        if (!newGameVersions.find((version) => version.id == forVersion)) {
            return false;
        }

        return satisfies(newVersion.modVersion, `^${originalVersion.modVersion.raw}`);
    }

    public toRawAPIResonse() {
        return {
            id: this.id,
            modId: this.modId,
            authorId: this.authorId,
            modVersion: this.modVersion.raw,
            platform: this.platform,
            zipHash: this.zipHash,
            status: this.status,
            dependencies: this.dependencies,
            contentHashes: this.contentHashes,
            supportedGameVersions: this.supportedGameVersionIds,
            downloadCount: this.downloadCount,
            fileSize: this.fileSize,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }

    public async toAPIResonse(gameVersionId: number = this.supportedGameVersionIds[0], statusesToSearchFor:Status[]): Promise<ModVersionAPIPublicResponse|null> {
        let dependencies = await this.getUpdatedDependencies(gameVersionId, statusesToSearchFor);
        if (!dependencies) {
            return null;
        }

        let author = DatabaseHelper.cache.users.find((user) => user.id == this.authorId);
        if (!author) {
            let dbAuthor = await DatabaseHelper.database.Users.findByPk(this.authorId);
            if (dbAuthor) {
                author = dbAuthor;
            } else {
                Logger.error(`Failed to find author ${this.authorId} for mod version ${this.id}`);
                author = DatabaseHelper.database.serverAdmin;
            }
        }

        return {
            id: this.id,
            modId: this.modId,
            author: author.toAPIResponse(),
            modVersion: this.modVersion.raw,
            platform: this.platform,
            zipHash: this.zipHash,
            status: this.status,
            dependencies: dependencies.flatMap((dependancy) => dependancy.id),
            contentHashes: this.contentHashes,
            downloadCount: this.downloadCount,
            supportedGameVersions: await this.getSupportedGameVersions(),
            fileSize: this.fileSize,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}
// #endregion
// #region EditApprovalQueue
export type ModVersionApproval = InferAttributes<ModVersion, { omit: `modId` | `id` | `createdAt` | `updatedAt` | `deletedAt` | `authorId` | `status` | `contentHashes` | `zipHash` | `lastApprovedById` | `lastUpdatedById` | `downloadCount` }>
export type ModApproval = InferAttributes<Mod, { omit: `id` | `createdAt` | `updatedAt` | `deletedAt` | `iconFileName` | `status` | `lastApprovedById` | `lastUpdatedById` }>

//this is gonna be fun :3
export class EditQueue extends Model<InferAttributes<EditQueue>, InferCreationAttributes<EditQueue>> {
    declare readonly id: CreationOptional<number>;
    declare submitterId: number;
    declare objectId: number;
    declare objectTableName: `modVersions` | `mods`;
    declare object: ModVersionApproval | ModApproval;

    declare approverId: CreationOptional<number> | null;
    declare approved: boolean | null; // just use null as a 3rd bit 5head
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;
    declare readonly deletedAt: CreationOptional<Date> | null;

    public isModVersion(): this is EditQueue & { objectTableName: `modVersions`, object: ModVersionApproval } {
        return this.objectTableName === `modVersions` && `modVersion` in this.object;
    }

    public isMod(): this is EditQueue & { objTableName: `mods`, object: ModApproval } {
        return this.objectTableName === `mods` && `name` in this.object;
    }

    public async approve(approver: User) {
        if (this.approved) {
            return;
        }
        
        let record: Mod | ModVersion | undefined = undefined;

        if (this.objectTableName == `modVersions` && `modVersion` in this.object) {
            let modVersion = await DatabaseHelper.database.ModVersions.findByPk(this.objectId);
            if (modVersion) {
                modVersion.modVersion = this.object.modVersion || modVersion.modVersion;
                modVersion.platform = this.object.platform || modVersion.platform;
                modVersion.supportedGameVersionIds = this.object.supportedGameVersionIds || modVersion.supportedGameVersionIds;
                modVersion.dependencies = this.object.dependencies || modVersion.dependencies;
                //modVersion.lastApprovedById = approver.id;
                modVersion.lastUpdatedById = this.submitterId;
                //modVersion.status = Status.Verified;
                if (modVersion.status == Status.Verified) {
                    modVersion.lastApprovedById = approver.id;
                }
                record = await modVersion.save();
            }
        } else if (this.objectTableName == `mods` && `name` in this.object) {
            let mod = await DatabaseHelper.database.Mods.findByPk(this.objectId);
            if (mod) {
                mod.name = this.object.name || mod.name;
                mod.summary = this.object.summary || mod.summary;
                mod.description = this.object.description || mod.description;
                mod.category = this.object.category || mod.category;
                mod.gitUrl = this.object.gitUrl || mod.gitUrl;
                mod.authorIds = this.object.authorIds || mod.authorIds;
                mod.gameName = this.object.gameName || mod.gameName;
                //mod.lastApprovedById = approver.id;
                mod.lastUpdatedById = this.submitterId;
                //mod.status = Status.Verified;
                if (mod.status == Status.Verified) {
                    mod.lastApprovedById = approver.id;
                }
                record = await mod.save();
            }
        }
        this.approved = true;
        this.approverId = approver.id;
        this.save().then(() => {
            Logger.log(`Edit ${this.id} approved by ${approver.username}`);
            sendEditLog(this, approver, `Approved`);
        }).catch((error) => {
            Logger.error(`Error approving edit ${this.id}: ${error}`);
        });
        return record;
    }

    public async deny(approver: User) {
        if (this.approved) {
            return;
        }

        let record = this.isMod() ? await DatabaseHelper.database.Mods.findByPk(this.objectId) : await DatabaseHelper.database.ModVersions.findByPk(this.objectId);
        this.approved = false;
        this.approverId = approver.id;
        this.save().then(() => {
            Logger.log(`Edit ${this.id} denied by ${approver.username}`);
            sendEditLog(this, approver, `Rejected`);
        }).catch((error) => {
            Logger.error(`Error denying edit ${this.id}: ${error}`);
        });
    }
}
// #endregion
// #region MOTD
export class MOTD extends Model<InferAttributes<MOTD>, InferCreationAttributes<MOTD>> {
    declare readonly id: CreationOptional<number>;
    declare gameName: SupportedGames;
    declare gameVersionIds?: number[]|null;
    declare postType: PostType;
    declare platforms?: Platform[]|null;
    declare message: string;
    declare translations: Translations[];
    declare authorId: number;
    declare startTime: Date;
    declare endTime: Date;
    declare readonly createdAt: CreationOptional<Date>;
    declare readonly updatedAt: CreationOptional<Date>;

    public static async getActiveMOTDs(gameName: SupportedGames, versions:number[]|undefined = undefined, platform:Platform|undefined, getExpired = false): Promise<MOTD[]> {
        return DatabaseHelper.cache.motd.filter((motd) => {
            let now = new Date();
            if (getExpired) {
                if (motd.endTime < now) {
                    return false;
                }
            }

            if (motd.startTime > now) {
                return false;
            }

            if (motd.gameName != gameName) {
                return false;
            }

            if (motd.gameVersionIds) {
                if (versions && !motd.gameVersionIds.some((id) => versions.includes(id))) {
                    return false;
                }
            }

            if (motd.platforms && platform) {
                if (!motd.platforms.includes(platform)) {
                    return false;
                }
            }

            return true;
        });
    }
}
// #endregion
// #region Interfaces/Enums
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
    fileSize: number;
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

        setInterval(DatabaseHelper.refreshAllCaches, 1000 * 60 * 1);
    }

    public static async refreshAllCaches() {
        DatabaseHelper.cache.gameVersions = await DatabaseHelper.database.GameVersions.findAll();
        DatabaseHelper.cache.modVersions = await DatabaseHelper.database.ModVersions.findAll();
        DatabaseHelper.cache.mods = await DatabaseHelper.database.Mods.findAll();
        DatabaseHelper.cache.users = await DatabaseHelper.database.Users.findAll();
        DatabaseHelper.cache.editApprovalQueue = await DatabaseHelper.database.EditApprovalQueue.findAll();
        DatabaseHelper.cache.motd = await DatabaseHelper.database.MOTDs.findAll();
    }

    public static async refreshCache(tableName: `gameVersions` | `modVersions` | `mods` | `users` | `editApprovalQueue`) {
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

    public static isValidGameName(name: string): name is SupportedGames {
        if (!name) {
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
// #endregion