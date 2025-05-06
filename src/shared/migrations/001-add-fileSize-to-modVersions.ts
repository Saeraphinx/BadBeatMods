import { DataTypes } from "sequelize";
import { Migration } from "../Database.ts";
import { query } from "express";

/*
    Adding fileSize column to modVersions table.
    Info on the Migration System can be found here: https://github.com/sequelize/umzug?tab=readme-ov-file#minimal-example
    
*/

export const up: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.addColumn(`modVersions`, `fileSize`, {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    });
};

export const down: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.removeColumn(`modVersions`, `fileSize`);
};