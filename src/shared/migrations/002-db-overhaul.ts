import { DataTypes } from "sequelize";
import { Migration } from "../Database.ts";

/*
    Adding fileSize column to modVersions table.
    Info on the Migration System can be found here: https://github.com/sequelize/umzug?tab=readme-ov-file#minimal-example
    
*/

export const up: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.addColumn(`gameVersions`, `linkedVersionIds`, {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: `[]`,
    });

    await query.addColumn(`mods`, `statusHistory`, {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: `[]`,
    });
    await query.addColumn(`modVersions`, `statusHistory`, {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: `[]`,
    });
};

export const down: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.removeColumn(`gameVersions`, `linkedVersionIds`);

    await query.removeColumn(`mods`, `statusHistory`);
    await query.removeColumn(`modVersions`, `statusHistory`);
};