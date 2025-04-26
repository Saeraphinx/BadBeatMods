import { DataTypes } from "sequelize";
import { Migration } from "../Database.ts";

/*
    Adding fileSize column to modVersions table.
    Info on the Migration System can be found here: https://github.com/sequelize/umzug?tab=readme-ov-file#minimal-example
    
*/

export const up: Migration = async ({ context: sequelize }) => {
    await sequelize.addColumn(`gameVersions`, `linkedVersionIds`, {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: `[]`,
    });

    await sequelize.addColumn(`mods`, `statusHistory`, {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: `[]`,
    });
    await sequelize.addColumn(`modVersions`, `statusHistory`, {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: `[]`,
    });
};

export const down: Migration = async ({ context: sequelize }) => {
    await sequelize.removeColumn(`gameVersions`, `linkedVersionIds`);

    await sequelize.removeColumn(`mods`, `statusHistory`);
    await sequelize.removeColumn(`modVersions`, `statusHistory`);
};