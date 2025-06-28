import { DataTypes, ModelStatic, QueryInterface, Sequelize } from "sequelize";
import { Categories, ContentHash, DatabaseManager, EditQueue, GameVersion, Mod, ModVersion, MOTD, Platform, Status, StatusHistory, SupportedGames, User } from "../src/shared/Database";
import * as fd from "./fakeData.json" with { type: "json" };
import { SemVer } from "semver";
import { updateRoles } from "../src/shared/database/ValueUpdater";
import { SequelizeStorage, Umzug } from "umzug";


class dbc {
    public sequelize: Sequelize;
    public Users: ModelStatic<User>;
    public ModVersions: ModelStatic<ModVersion>;
    public Mods: ModelStatic<Mod>;
    public GameVersions: ModelStatic<GameVersion>;
    public EditApprovalQueue: ModelStatic<EditQueue>;
    public MOTDs: ModelStatic<MOTD>;
    public umzug: Umzug<QueryInterface>;

    
    public async migrate() {
        console.log(`Running migrations...`);
        return await this.umzug.up().then((migrations) => {
            console.log(migrations);
            return migrations;
        });
    }

    constructor() {
        this.sequelize = new Sequelize({
            dialect: "sqlite",
            storage: "./dummyData.sqlite",
            logging: false,
        });

        this.umzug = new Umzug({
            migrations: {
                glob: `./build/shared/migrations/*.js`, // have to use the built versions because the source is not present in the final build
            },
            storage: new SequelizeStorage({sequelize: this.sequelize}),
            context: this.sequelize.getQueryInterface(),
            logger: console
        });
    }

    public loadTables() {
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
                    let dependencies = await ModVersion.findAll({ where: { id: modVersion.dependencies } });
                    if (dependencies.length != modVersion.dependencies.length) {
                        throw new Error(`Invalid dependencies found.`);
                    }
    
                    for (let dependency of dependencies) {
                        if (dependency.modId == modVersion.modId) {
                            throw new Error(`ModVersion cannot depend on itself.`);
                        }
    
                        /*if (!dependency.supportedGameVersionIds.includes(modVersion.supportedGameVersionIds[0])) {
                            throw new Error(`Dependent cannot depend on a ModVersion that does not support the earliest supported Game Version of the dependent.`); // see sorting above
                        }*/
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
}

async function loadDB() {
    let db = new dbc();
    db.loadTables();
    await db.migrate()

    // #region loading
    db.sequelize.sync().then(async () => {
    let users = fd.users.map((user) => {
        return {
            ...user,
            createdAt: new Date(user.createdAt),
            updatedAt: new Date(user.updatedAt)
        }
    });
    await db.Users.bulkCreate(users, { ignoreDuplicates: true });

    let gameVersions = fd.gameVersions.map((gameVersion) => {
        return {
            ...gameVersion,
            gameName: gameVersion.gameName as SupportedGames,
            createdAt: new Date(gameVersion.createdAt),
            updatedAt: new Date(gameVersion.updatedAt)
        }
    });
    await db.GameVersions.bulkCreate(gameVersions, { ignoreDuplicates: true });
    
    let projects = fd.projects.map((project) => {
        return {
            ...project,
            gameName: project.gameName as SupportedGames,
            category: project.category as Categories,
            status: project.status as Status,
            createdAt: new Date(project.createdAt),
            updatedAt: new Date(project.updatedAt)
        }
    });
    await db.Mods.bulkCreate(projects, { ignoreDuplicates: true });

    let modVersions = fd.versions.map((modVersion) => {
        return {
            ...modVersion,
            status: modVersion.status as Status,
            platform: modVersion.platform as Platform,
            modVersion: new SemVer(modVersion.modVersion.raw),
            createdAt: new Date(modVersion.createdAt),
            updatedAt: new Date(modVersion.updatedAt)
        }
    });
    await db.ModVersions.bulkCreate(modVersions, { ignoreDuplicates: true });
    //#endregion
})
}

loadDB()