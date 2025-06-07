import { DataTypes } from "sequelize";
import { Migration, Project } from "../Database.ts";

/*
    Info on the Migration System can be found here: https://github.com/sequelize/umzug?tab=readme-ov-file#minimal-example
*/

export const up: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.createTable(`games`, {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            primaryKey: true,
        },
        displayName: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: ``,
        },
        categories: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: [],
        },
        webhookConfig: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: [],
        },
        default: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        createdAt: DataTypes.DATE, // just so that typescript isn't angy
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE,
    });

    await query.changeColumn(`mods`, `gameName`, {
        type: DataTypes.STRING,
        allowNull: false,
    });
};

export const down: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.dropTable(`games`);
    await query.changeColumn(`mods`, `gameName`, {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: `BeatSaber`
    });
};