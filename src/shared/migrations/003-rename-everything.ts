import { Migration } from "../Database.ts";

/*
    Info on the Migration System can be found here: https://github.com/sequelize/umzug?tab=readme-ov-file#minimal-example
*/

export const up: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.renameColumn(`modVersions`, `modId`, `projectId`);
};

export const down: Migration = async ({ context: sequelize }) => {
    let query = sequelize.getQueryInterface();
    await query.renameColumn(`modVersions`, `projectId`, `modId`);
};