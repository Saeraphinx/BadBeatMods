import path from "path";
import { exit } from "process";
import { DataTypes, ModelStatic, QueryInterface, Sequelize } from "sequelize";
import { Logger } from "./Logger.ts";
import { SemVer } from "semver";
import { Config } from "./Config.ts";
import { SequelizeStorage, Umzug } from "umzug";
import { DatabaseHelper, Platform, ContentHash, SupportedGames, StatusHistory, UserRoles } from "./database/DBHelper.ts";
import { EditQueue } from "./database/models/EditQueue.ts";
import { GameVersion } from "./database/models/GameVersion.ts";
import { Mod } from "./database/models/Mod.ts";
import { ModVersion } from "./database/models/ModVersion.ts";
import { MOTD } from "./database/models/MOTD.ts";
import { User } from "./database/models/User.ts";
import { updateDependencies, updateRoles } from "./database/ValueUpdater.ts";

// in use by this file
export * from "./database/models/EditQueue.ts";
export * from "./database/models/GameVersion.ts";
export * from "./database/models/Mod.ts";
export * from "./database/models/ModVersion.ts";
export * from "./database/models/MOTD.ts";
export * from "./database/models/User.ts";
export * from "./database/DBHelper.ts";

function isValidDialect(dialect: string): dialect is `sqlite` |`postgres` {
    return [`sqlite`, `postgres`].includes(dialect);
}

export type Migration = typeof DatabaseManager.prototype.umzug._types.migration;

export class DatabaseManager {
    public sequelize: Sequelize;
    public Users: ModelStatic<User>;
    public ModVersions: ModelStatic<ModVersion>;
    public Mods: ModelStatic<Mod>;
    public GameVersions: ModelStatic<GameVersion>;
    public EditApprovalQueue: ModelStatic<EditQueue>;
    public MOTDs: ModelStatic<MOTD>;
    public serverAdmin: User;
    public umzug: Umzug<QueryInterface>;

    constructor() {
        Logger.log(`Loading DatabaseManager...`);

        let storagePath = undefined;
        if (Config.database.dialect === `sqlite`) {
            if (Config.database.url !== `:memory:`) {
                storagePath = path.resolve(Config.database.url);
            } else {
                storagePath = `:memory:`;
            }
        }

        this.sequelize = new Sequelize(`bbm_database`, Config.database.username, Config.database.password, {
            host: Config.database.dialect === `sqlite` ? `localhost` : Config.database.url,
            port: Config.database.dialect === `sqlite` ? undefined : 5432,
            dialect: isValidDialect(Config.database.dialect) ? Config.database.dialect : `sqlite`,
            logging: Config.flags.logRawSQL ? Logger.winston.log : false,
            storage: storagePath,
        });

        this.umzug = new Umzug({
            migrations: {
                glob: `./build/shared/migrations/*.js`, // have to use the built versions because the source is not present in the final build
            },
            storage: new SequelizeStorage({sequelize: this.sequelize}),
            context: this.sequelize.getQueryInterface(),
            logger: Logger
        });
    }

    public async migrate() {
        Logger.log(`Running migrations...`);
        return await this.umzug.up().then((migrations) => {
            Logger.log(`Migrations complete. Ran ${migrations.length} migrations.`);
            migrations.length != 0 ? Logger.log(`Migraions ran: ${migrations.map((migration) => migration.name).join(`, `)}`) : null;
            return migrations;
        });
    }

    public async init() {
        if (Config.flags.enableMigrations) {
            await this.migrate();
        }
        this.loadTables();

        if (Config.database.dialect === `postgres`) {
            if (Config.database.alter === true) {
                Logger.warn(`Database alterations are not supported on PostgreSQL databases and have caused a crash. Be warned.`);
            }
        }

        await this.sequelize.sync({
            alter: Config.database.alter,
        }).then(async () => {
            Logger.log(`DatabaseManager Loaded.`);
            new DatabaseHelper(this, false);

            await DatabaseHelper.refreshAllCaches().then(() => {
                Logger.log(`DatabaseHelper Loaded.`);
            });

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

    private loadTables() {
        // #region Users
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
            tableName: `users`,
            paranoid: true,
        });
        // #endregion
        // #region GameVersions
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
            linkedVersionIds: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`linkedVersionIds`));
                },
                set(value: number[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`linkedVersionIds`, JSON.stringify(value));
                },
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `gameVersions`,
            tableName: `gameVersions`,
            paranoid: true,
        });
        // #endregion
        // #region Mods
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
            statusHistory: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`statusHistory`));
                },
                set(value: StatusHistory[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`statusHistory`, JSON.stringify(value));
                },
            },
            lastApprovedById: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            lastUpdatedById: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE
        }, {
            sequelize: this.sequelize,
            modelName: `mods`,
            tableName: `mods`,
            paranoid: true,
        });
        // #endregion
        // #region ModVersions
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
                defaultValue: 0
            },
            statusHistory: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: `[]`,
                get() {
                    // @ts-expect-error s(2345)
                    return JSON.parse(this.getDataValue(`statusHistory`));
                },
                set(value: StatusHistory[]) {
                    // @ts-expect-error s(2345)
                    this.setDataValue(`statusHistory`, JSON.stringify(value));
                },
            },
            createdAt: DataTypes.DATE, // just so that typescript isn't angy
            updatedAt: DataTypes.DATE,
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            modelName: `modVersions`,
            tableName: `modVersions`,
            paranoid: true,
        });
        // #endregion
        // #region EditApprovalQueue
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
            tableName: `editApprovalQueues`, // fuck you sequelize.
            paranoid: true,
        });
        // #endregion
        // #region MOTD
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
            deletedAt: DataTypes.DATE,
        }, {
            sequelize: this.sequelize,
            tableName: `motds`,
            modelName: `motds`,
            paranoid: true,

        });

        // #region Hooks
        this.Users.afterSync(async () => {
            let users = await this.Users.findAll();
            let promises = [];
            for (let user of users) {
                promises.push(updateRoles(user));
            }
            await Promise.all(promises);
        });

        this.ModVersions.afterSync(async () => {
            let modVersions = await this.ModVersions.findAll();
            let promises = [];
            for (let modVersion of modVersions) {
                promises.push(updateDependencies(modVersion, this.ModVersions));
            }
            await Promise.all(promises);
        });


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
                    if (existingVersion.id != modVersion.id) {
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

                // check if game version is linked to another game version
                if (gameVersion.linkedVersionIds.length > 0) {
                    let linkedVersions = await this.GameVersions.findAll({ where: { id: gameVersion.linkedVersionIds } });
                    // ensure that all linked versions are valid and for the same game
                    if (linkedVersions.length != gameVersion.linkedVersionIds.length) {
                        throw new Error(`Invalid linked game versions found. Please contact a site administrator.`);
                    }

                    for (let linkedVersion of linkedVersions) {
                        if (linkedVersion.gameName != parentMod.gameName) {
                            throw new Error(`Game Version ${linkedVersion.id} must only have linked game versions for the parent mod's game. Please contact a site administrator.`);
                        }

                        if (!modVersion.supportedGameVersionIds.includes(linkedVersion.id)) {
                            modVersion.supportedGameVersionIds = [...modVersion.supportedGameVersionIds, linkedVersion.id];
                        }
                    }
                }
            }

            modVersion.supportedGameVersionIds = modVersion.supportedGameVersionIds.sort((a, b) => {
                let gvA = gameVersions.find((gv) => gv.id == a);
                let gvB = gameVersions.find((gv) => gv.id == b);

                if (!gvA || !gvB) {
                    return 0;
                }

                return GameVersion.compareVersions(gvA, gvB);
            });

            if (modVersion.dependencies.length > 0) {
                //dedupe dependencies
                modVersion.dependencies = [...new Set(modVersion.dependencies)];
                let parentIds = modVersion.dependencies.map((dep) => dep.parentId);
                if ([...new Set(parentIds)].length != modVersion.dependencies.length) {
                    throw new Error(`ModVersion cannot have duplicate dependencies.`);
                }
                let parentMods = await Mod.findAll({ where: { id: parentIds } });
                if (parentMods.length == 0) {
                    throw new Error(`No valid parent mods found.`);
                }
                if (parentMods.length != parentIds.length) {
                    throw new Error(`Invalid or duplicate parent mod(s) found.`);
                }
            }

            // do not allow modVersion to be created with a version that starts with v
            if (modVersion.modVersion.raw.startsWith(`v`)) {
                modVersion.modVersion = new SemVer(modVersion.modVersion.raw.slice(1));
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

        this.GameVersions.afterValidate(async (gameVersion) => {
            if (gameVersion.linkedVersionIds.length > 0) {
                let linkedVersions = await this.GameVersions.findAll({ where: { id: gameVersion.linkedVersionIds } });
                // ensure that all linked versions are valid and for the same game
                if (linkedVersions.length != gameVersion.linkedVersionIds.length) {
                    throw new Error(`Invalid linked Game Version IDs.`);
                }

                for (let linkedVersion of linkedVersions) {
                    if (linkedVersion.gameName != gameVersion.gameName) {
                        throw new Error(`Game Version ${linkedVersion.id} must only have linked game versions for the same game.`);
                    }

                    if (linkedVersion.id == gameVersion.id) {
                        throw new Error(`Game Version cannot link to itself.`);
                    }

                    // ensure that the linked version is also linked back to this version
                    if (!linkedVersion.linkedVersionIds.includes(gameVersion.id)) {
                        linkedVersion.linkedVersionIds = [...linkedVersion.linkedVersionIds, gameVersion.id];
                        await linkedVersion.save({hooks: false});
                    }
                }
            }
        });

        this.EditApprovalQueue.beforeCreate(async (queueItem) => {
            if (!queueItem.isMod() && !queueItem.isModVersion()) {
                throw new Error(`Invalid object type.`);
            }
        });
    }
    // #endregion
}