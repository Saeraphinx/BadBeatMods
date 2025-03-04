import { Router } from 'express';
import { DatabaseHelper, GameVersion, UserRoles } from '../../shared/Database.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Config } from '../../shared/Config.ts';
import * as fs from 'fs';
import * as path from 'path';
import { Validator } from '../../shared/Validator.ts';
import { Logger } from '../../shared/Logger.ts';
import { coerce } from 'semver';

export class AdminRoutes {
    private router: Router;
    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/admin/health/hashCheck`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let versions = await DatabaseHelper.database.ModVersions.findAll();
            let errors = [];

            let allZips = fs.readdirSync(path.resolve(Config.storage.modsDir), { withFileTypes: true }).filter(dirent => dirent.isFile() && dirent.name.endsWith(`.zip`));

            for (let version of versions) {
                if (!allZips.find(zip => zip.name === `${version.zipHash}.zip`)) {
                    errors.push(version.zipHash);
                }
            }

            if (errors.length > 0) {
                return res.status(500).send({ message: `Unable to resolve ${errors.length} hashes.`, errors });
            }

            return res.status(200).send({ message: `All hashes are valid.` });
        });

        this.router.get(`/admin/health/missingIcons`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let mods = await DatabaseHelper.database.Mods.findAll();
            let errors = [];

            let allIcons = fs.readdirSync(path.resolve(Config.storage.iconsDir), { withFileTypes: true }).filter(dirent => dirent.isFile()).map(dirent => dirent.name);

            for (let mod of mods) {
                if (!allIcons.find(icon => icon === mod.iconFileName)) {
                    errors.push(mod.iconFileName);
                }
            }

            if (errors.length > 0) {
                return res.status(500).send({ message: `Unable to resolve ${errors.length} icons.`, errors });
            }

            return res.status(200).send({ message: `All icons are valid.` });
        });

        this.router.get(`/admin/health/dependencyResolution`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.parameters['versionId'] = { description: 'The version ID to check.', required: true }
            // #swagger.parameters['gameName'] = { description: 'The game name to check.', required: true }
            // #swagger.parameters['includeUnverified'] = { description: 'Include unverified mods.', required: false, type: 'boolean' }
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let params = Validator.z.object({
                versionId: Validator.z.number({ coerce: true }).int(),
                gameName: Validator.zGameName,
                includeUnverified: Validator.z.preprocess(arg => arg === `true`, Validator.z.boolean().default(false)),
            }).required().strict().safeParse(req.query);

            if (!params.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let isSpecificVersion = params.data.versionId === 0 || params.data.versionId === -1;
            let versions: GameVersion[] = [];
            if (isSpecificVersion === true) {
                if (params.data.versionId === 0) {
                    versions = await DatabaseHelper.database.GameVersions.findAll({ where: { gameName: params.data.gameName } });
                    /*versions.sort((a, b) => {
                        let verA = coerce(a.version, { loose: true });
                        let verB = coerce(b.version, { loose: true });
                        if (verA && verB) {
                            return verB.compare(verA); // this is reversed so that the latest version is first in the array
                        } else {
                            return b.version.localeCompare(a.version);
                        }
                    });*/
                } else {
                    let defaultVersion = await GameVersion.getDefaultVersionObject(params.data.gameName);
                    if (!defaultVersion) {
                        return res.status(404).send({ message: `Default version not found.` });
                    }
                    versions.push(defaultVersion);
                }
            } else {
                if (params.data.versionId <= -2) {
                    return res.status(400).send({ message: `Invalid version ID.` });
                }
                let version = await DatabaseHelper.database.GameVersions.findByPk(params.data.versionId as number);
                if (!version) {
                    return res.status(404).send({ message: `Version not found.` });
                }
                versions.push(version);
            }

            let errors = [];
            for (let version of versions) {
                let request = await fetch(`${Config.server.url}${Config.server.apiRoute}/mods?gameName=${encodeURIComponent(params.data.gameName)}&gameVersion=${encodeURIComponent(version.version)}&status=${params.data.includeUnverified ? `unverified` : `verified`}`);
                if (!request.ok) {
                    return res.status(500).send({ message: `Unable to fetch mods.`, status: request.status, statusText: request.statusText });
                }
                let mods = await request.json() as any;

                for (let mod of mods.mods) {
                    for (let dependancyId of mod.latest.dependencies) {
                        if (!mods.mods.find((m: any) => m.latest.id === dependancyId)) {
                            let versionString = (mod.latest.supportedGameVersions as object[]).flatMap((gV:any) => `${gV.gameName} ${gV.version}`).join(`, `);
                            let dependancy = DatabaseHelper.cache.modVersions.find((mV: any) => mV.id === dependancyId);
                            if (!dependancy) {
                                return res.status(404).send({ message: `Database ID for modVersions not found.`, dependancyId });
                            }
                            let dependancyMod = DatabaseHelper.cache.mods.find((m: any) => m.id === dependancy.modId);
                            if (!dependancyMod) {
                                return res.status(404).send({ message: `Database ID for mods not found.`, dependancyId });
                            }

                            errors.push({
                                gV: versionString,
                                dependant: {
                                    name: mod.mod.name,
                                    versionId: mod.latest.id
                                },
                                dependency: {
                                    name: dependancyMod.name,
                                    versionId: dependancy.id
                                }
                            });
                        }
                    }
                }
            }

            if (errors.length > 0) {
                let missingIds = Array.from(new Set(errors.map((error: any) => error.dependency.versionId)));
                errors.sort((a, b) => {
                    return b.dependency.versionId - a.dependency.versionId;
                });
                return res.status(500).send({ message: `Unable to resolve ${errors.length} dependencies.`, missingIds, errors });
            }

            return res.status(200).send({ message: `All dependencies are valid.` });
        });

        this.router.post(`/admin/linkversions`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Mark all versions as compatible with another gameversion.'
            // #swagger.description = 'Link two versions together.'
            /* #swagger.requestBody = {
                description: 'The versions to link.',
                required: true,
                schema: {
                    version1: 1,
                    version2: 2
                }
            } */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let versionId1 = Validator.zDBID.safeParse(req.body.version1);
            let versionId2 = Validator.zDBID.safeParse(req.body.version2);

            if (!versionId1.success || !versionId2.success) {
                return res.status(400).send({ message: `Missing version.` });
            }

            const modVersions = await DatabaseHelper.database.ModVersions.findAll();
            const version1 = await DatabaseHelper.database.GameVersions.findByPk(versionId1.data.toString());
            const version2 = await DatabaseHelper.database.GameVersions.findByPk(versionId1.data.toString());
            if (!version1 || !version2) {
                return res.status(404).send({ message: `Versions not found.` });
            }

            for (let modVersion of modVersions) {
                if (modVersion.supportedGameVersionIds.includes(version1.id) && !modVersion.supportedGameVersionIds.includes(version2.id)) {
                    modVersion.supportedGameVersionIds = [...modVersion.supportedGameVersionIds, version2.id];
                }

                if (modVersion.supportedGameVersionIds.includes(version2.id) && !modVersion.supportedGameVersionIds.includes(version1.id)) {
                    modVersion.supportedGameVersionIds = [...modVersion.supportedGameVersionIds, version1.id];
                }
                modVersion.save();
            }

            return res.status(200).send({ message: `Version ${version1.gameName} ${version1.version} & ${version2.gameName} ${version2.version} have been linked.` });
        });
      
        this.router.post(`/admin/sortgameversions`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Sort all Game Versions in all mod versions.'
            // #swagger.description = 'Sort all Game Versions in all mod versions.'
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            const modVersions = await DatabaseHelper.database.ModVersions.findAll();
            const gameVersions = await DatabaseHelper.database.GameVersions.findAll();

            res.status(200).send({ message: `Sorting ${modVersions.length} mod versions. Edits will not be created.` });

            for (let modVersion of modVersions) {
                modVersion.supportedGameVersionIds = modVersion.supportedGameVersionIds.sort((a, b) => {
                    let gvA = gameVersions.find((gv) => gv.id == a);
                    let gvB = gameVersions.find((gv) => gv.id == b);
    
                    if (!gvA || !gvB) {
                        return 0;
                    }
    
                    let svA = coerce(gvA.version, { loose: true });
                    let svB = coerce(gvB.version, { loose: true });
                    if (svA && svB) {
                        return svA.compare(svB); // the earliest version is first in the array
                    } else {
                        return gvB.version.localeCompare(gvA.version);
                    }
                });
                await modVersion.save().catch((err) => {
                    Logger.error(`Error saving modVersion ${modVersion.id}: ${err}`);
                });

                Logger.debug(`Sorted ${modVersion.id}`);
            }
        });
      
        this.router.post(`/admin/database/loadBlankFileSizes`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Load blank file sizes into the database.'
            // #swagger.description = 'Check each record in the modVersions table. If the file size is 0, attempt to get the file size from the zip file.'
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let updateCount = 0;
            const versions = await DatabaseHelper.database.ModVersions.findAll({where: { fileSize: 0 }});
            for (let version of versions) {
                let filePath = path.resolve(Config.storage.modsDir, `${version.zipHash}.zip`);
                if (fs.existsSync(filePath)) {
                    let stats = fs.statSync(filePath);
                    version.fileSize = stats.size;
                    await version.save({ validate: false }); // skip validation to save time processing. validation isn't needed here.
                    updateCount++;
                } else {
                    Logger.error(`File ${filePath} does not exist.`);
                }
            }

            DatabaseHelper.refreshCache(`modVersions`);
            return res.status(200).send({ message: `Updated ${updateCount} records.` });
        });

        this.router.post(`/admin/users/addRole`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Add a role to a user.'
            // #swagger.description = 'Add a role to a user.'
            /* #swagger.requestBody = {
                    
                    description: 'The role to add.',
                    required: true,
                    schema: {
                      userId: 1,
                      role: 'string',
                      gameName: 'string'
                  }
            }
            */

            let userId = Validator.zDBID.safeParse(req.body.userId);
            let gameName = Validator.zGameName.optional().safeParse(req.body.gameName);
            let role = Validator.zUserRoles.safeParse(req.body.role);

            if (!userId.success || !role.success || !gameName.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let user = await DatabaseHelper.database.Users.findByPk(userId.data);
            if (!user) {
                return res.status(404).send({ message: `User not found.` });
            }

            let sessionId = req.session.userId;
            if (!sessionId) {
                return res.status(400).send({ message: `You cannot modify your own roles.` });
            } else {
                if (sessionId === user.id) {
                    return res.status(400).send({ message: `You cannot modify your own roles.` });
                }
            }

            let session: { user: any } = { user: null };
            if (gameName.data) {
                switch (role.data) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions, gameName.data);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Poster);
                        break;
                    case UserRoles.LargeFiles:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.LargeFiles);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.user) {
                            return;
                        }

                        if (gameName.data) {
                            if (Array.isArray(user.roles.perGame[gameName.data])) {
                                // @ts-expect-error - TS doesn't like this but it's fine
                                if (user.roles.perGame[gameName.data].length > 0) {
                                    return res.status(400).send({ message: `User cannot be banned due to already having roles.`, user });
                                }
                            }
                        }
                    
                        user.addPerGameRole(gameName.data, UserRoles.Banned);
                        break;
                    default:
                        return res.status(400).send({ message: `Invalid role.` });
                }
                Logger.log(`User ${session.user.username} added role ${role.data} to user ${user.username} for game ${gameName.data} by ${session.user?.id}.`);
            } else {
                switch (role.data) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Poster);
                        break;
                    
                    case UserRoles.LargeFiles:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.LargeFiles);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.user) {
                            return;
                        }
                        if (user.roles.sitewide.length > 0) {
                            return res.status(400).send({ message: `User cannot be banned due to already having roles.`, user });
                        }
                        user.addSiteWideRole(UserRoles.Banned);
                        break;
                    default:
                        return res.status(400).send({ message: `Invalid role.` });
                }
                Logger.log(`User ${session.user.username} added role ${role.data} to user ${user.username} by ${session.user?.id}.`);
            }

            return res.status(200).send({ message: gameName.data ? `Role ${role.data} added to user ${user.username} for game ${gameName.data}.` : `Role ${role.data} added to user ${user.username}`, user });

        });

        this.router.post(`/admin/users/removeRole`, async (req, res) => {
            // #swagger.tags = ['Admin']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Remove a role from a user.'
            // #swagger.description = 'Remove a role from a user.'
            /* #swagger.requestBody = {
                    
                    description: 'The role to remove.',
                    required: true,
                    schema: {
                      userId: 1,
                      role: 'string',
                      gameName: 'string'
                  }
            }
            */

            let userId = Validator.zDBID.safeParse(req.body.userId);
            let gameName = Validator.zGameName.optional().safeParse(req.body.gameName);
            let role = Validator.zUserRoles.safeParse(req.body.role);

            if (!userId.success || !role.success || !gameName.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let user = await DatabaseHelper.database.Users.findByPk(userId.data);
            if (!user) {
                return res.status(404).send({ message: `User not found.` });
            }

            let session: { user: any } = { user: null };
            if (gameName.data) {
                switch (role.data) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions, gameName.data);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Poster);
                        break;
                    
                    case UserRoles.LargeFiles:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.LargeFiles);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Banned);
                        break;
                    default:
                        return res.status(400).send({ message: `Invalid role.` });
                }
            } else {
                switch (role.data) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Poster);
                        break;
                    
                    case UserRoles.LargeFiles:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.LargeFiles);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Banned);
                        break;
                    default:
                        return res.status(400).send({ message: `Invalid role.` });
                }
            }
            Logger.log(`User ${session.user.username} removed role ${role.data} from user ${user.username} for game ${gameName.data} by ${session.user?.id}.`);
            return res.status(200).send({ message: gameName.data ? `Role ${role.data} removed from user ${user.username} for game ${gameName.data}.` : `Role ${role.data} removed from user ${user.username}`, user });
        });
    }
}