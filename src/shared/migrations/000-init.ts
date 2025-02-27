import { DataTypes } from "sequelize";
import { Migration, Platform, SupportedGames } from "../Database.js";

/*
    Inital Database structure.
    Info on the Migration System can be found here: https://github.com/sequelize/umzug?tab=readme-ov-file#minimal-example
    
*/

export const up: Migration = async ({ context: sequelize }) => {
    await sequelize.createTable(`users`, {
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
            defaultValue: `[]`
        },
        createdAt: DataTypes.DATE, // just so that typescript isn't angy
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE,
    });

    await sequelize.createTable(`gameVersions`, {
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
    });

    await sequelize.createTable(`mods`, {
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
            defaultValue: `[]`
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
        createdAt: DataTypes.DATE, // just so that typescript isn't angy
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE
    });

    await sequelize.createTable(`modVersions`, {
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
            defaultValue: ``
        },
        supportedGameVersionIds: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ``
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
            defaultValue: `[]`
        },
        dependencies: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: `[]`
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
        createdAt: DataTypes.DATE, // just so that typescript isn't angy
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE,
    });

    await sequelize.createTable(`editApprovalQueues`, {
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
            defaultValue: `{}`
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
    });

    await sequelize.createTable(`motds`, {
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
            defaultValue: null
        },
        platforms: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ``,
        },
        translations: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: `[]`
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
    });
};

export const down: Migration = async ({ context: sequelize }) => {
    await sequelize.dropTable(`users`);
    await sequelize.dropTable(`gameVersions`);
    await sequelize.dropTable(`mods`);
    await sequelize.dropTable(`modVersions`);
    await sequelize.dropTable(`editApprovalQueues`);
    await sequelize.dropTable(`motds`);
};