import { Router } from 'express';
import { DatabaseHelper, GameVersion, UserRoles } from '../../../shared/Database.ts';
import { validateSession } from '../../../shared/AuthHelper.ts';
import { Config } from '../../../shared/Config.ts';
import * as fs from 'fs';
import * as path from 'path';
import { Validator } from '../../../shared/Validator.ts';
import { Logger } from '../../../shared/Logger.ts';
import { coerce } from 'semver';
import { sendVersionLog, WebhookLogType } from '../../../shared/ModWebhooks.ts';
import { Utils } from '../../../shared/Utils.ts';

export class AdminRoutes {
    private router: Router;
    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/admin/health/hashCheck`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Check if all hashes are valid & present.'
            #swagger.description = 'Check if all hashes are valid & their files are still present on the server.'
            #swagger.responses[200] = {
                $ref: '#/components/responses/ServerMessage'
            }
            #swagger.responses[500] = {
                $ref: '#/components/responses/ServerMessageWithErrorStringArray'
            }
            */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let versions = await DatabaseHelper.database.Versions.findAll();
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
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Check if all icons are valid & present.'
            #swagger.description = 'Check if all icons are valid & their files are still present on the server.'
            #swagger.responses[200] = {
                $ref: '#/components/responses/ServerMessage'
            }
            #swagger.responses[500] = {
                $ref: '#/components/responses/ServerMessageWithErrorStringArray',
            }
            */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let projects = await DatabaseHelper.database.Projects.findAll();
            let errors = [];

            let allIcons = fs.readdirSync(path.resolve(Config.storage.iconsDir), { withFileTypes: true }).filter(dirent => dirent.isFile()).map(dirent => dirent.name);

            for (let project of projects) {
                if (!allIcons.find(icon => icon === project.iconFileName)) {
                    errors.push(project.iconFileName);
                }
            }

            if (errors.length > 0) {
                return res.status(500).send({ message: `Unable to resolve ${errors.length} icons.`, errors });
            }

            return res.status(200).send({ message: `All icons are valid.` });
        });

        this.router.get(`/admin/health/dependencyResolution`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['versionId'] = {
                description: 'The version ID to check.',
                required: true
            }
            #swagger.parameters['gameName'] = {
                description: 'The game name to check.',
                required: true
            }
            #swagger.parameters['includeUnverified'] = {
                description: 'Include unverified mods.',
                required: false,
                type: 'boolean'
            }
            */
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
                return res.status(400).send({ message: Utils.parseErrorMessage(params.error, `Invalid parameters.`), errors: params.error.issues });
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
                        return res.status(404).send({ message: `Default GameVersion not found.` });
                    }
                    versions.push(defaultVersion);
                }
            } else {
                if (params.data.versionId <= -2) {
                    return res.status(400).send({ message: `Invalid GameVersion ID.` });
                }
                let version = await DatabaseHelper.database.GameVersions.findByPk(params.data.versionId as number);
                if (!version) {
                    return res.status(404).send({ message: `GameVersion not found.` });
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

                for (let project of mods.mods) {
                    for (let dependancyId of project.latest.dependencies) {
                        if (!mods.mods.find((m: any) => m.latest.id === dependancyId)) {
                            let versionString = (project.latest.supportedGameVersions as object[]).flatMap((gV:any) => `${gV.gameName} ${gV.version}`).join(`, `);
                            let dependancy = DatabaseHelper.cache.versions.find((mV: any) => mV.id === dependancyId);
                            if (!dependancy) {
                                return res.status(404).send({ message: `Database ID for version not found.`, dependancyId });
                            }
                            let dependancyMod = DatabaseHelper.cache.projects.find((m: any) => m.id === dependancy.projectId);
                            if (!dependancyMod) {
                                return res.status(404).send({ message: `Database ID for project not found.`, dependancyId });
                            }

                            errors.push({
                                gV: versionString,
                                dependant: {
                                    name: project.mod.name,
                                    versionId: project.latest.id
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
    
        this.router.post(`/admin/sortgameversions`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Sort game versions.'
            #swagger.description = 'Sort game versions within versions by a gameversions version using SemVer's compare function.'
            #swagger.responses[200] = {
                $ref: '#/components/responses/ServerMessage'
            }
            */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            const versions = await DatabaseHelper.database.Versions.findAll();
            const gameVersions = await DatabaseHelper.database.GameVersions.findAll();

            res.status(200).send({ message: `Sorting ${versions.length} versions. Edits will not be created.` });

            for (let version of versions) {
                version.supportedGameVersionIds = version.supportedGameVersionIds.sort((a, b) => {
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
                await version.save().catch((err) => {
                    Logger.error(`Error saving version ${version.id}: ${err}`);
                });

                Logger.debug(`Sorted ${version.id}`);
            }
        });
      
        this.router.post(`/admin/database/loadBlankFileSizes`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Load blank file sizes into the database.'
            #swagger.description = 'Check each record in the modVersions table. If the file size is 0, attempt to get the file size from the zip file.'
            #swagger.responses[200] = {
                $ref: '#/components/responses/ServerMessage'
            }
            */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.user) {
                return;
            }

            let updateCount = 0;
            const versions = await DatabaseHelper.database.Versions.findAll({where: { fileSize: 0 }});
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

            DatabaseHelper.refreshCache(`versions`);
            return res.status(200).send({ message: `Updated ${updateCount} records.` });
        });

        this.router.post(`/admin/users/addRole`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Add a role to a user.'
            #swagger.description = 'Add a role to a user.'
            #swagger.requestBody = {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/definitions/zUpdateUserRoles'
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                $ref: '#/components/responses/ServerMessage'
            }
            #swagger.responses[400]
            #swagger.responses[404]
            */

            let reqBody = Validator.zEditUserRoles.safeParse(req.body);
            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`) });
            }

            let user = await DatabaseHelper.database.Users.findByPk(reqBody.data.userId);
            if (!user) {
                return res.status(404).send({ message: `User not found.` });
            }

            let sessionId = req.bbmAuth?.userId;
            if (!sessionId) {
                return res.status(400).send({ message: `You cannot modify your own roles.` });
            } else {
                if (sessionId === user.id) {
                    return res.status(400).send({ message: `You cannot modify your own roles.` });
                }
            }

            let session: { user: any } = { user: null };
            if (reqBody.data.gameName) {
                switch (reqBody.data.role) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(reqBody.data.gameName, UserRoles.Admin);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(reqBody.data.gameName, UserRoles.Approver);
                        break;
                    case UserRoles.GameManager:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(reqBody.data.gameName, UserRoles.GameManager);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(reqBody.data.gameName, UserRoles.Poster);
                        break;
                    case UserRoles.LargeFiles:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.addPerGameRole(reqBody.data.gameName, UserRoles.LargeFiles);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }

                        if (reqBody.data.gameName) {
                            if (Array.isArray(user.roles.perGame[reqBody.data.gameName])) {
                                if (user.roles.perGame[reqBody.data.gameName].length > 0) {
                                    return res.status(400).send({ message: `User cannot be banned due to already having roles.`, user });
                                }
                            }
                        }
                    
                        user.addPerGameRole(reqBody.data.gameName, UserRoles.Banned);
                        break;
                    default:
                        return res.status(400).send({ message: `Invalid role.` });
                }
                Logger.log(`User ${session.user.username} added role ${reqBody.data.role} to user ${user.username} for game ${reqBody.data.gameName} by ${session.user?.id}.`);
            } else {
                switch (reqBody.data.role) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Admin);
                        break;
                    case UserRoles.GameManager:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.GameManager);
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
                Logger.log(`User ${session.user.username} added role ${reqBody.data.role} to user ${user.username} by ${session.user?.id}.`);
            }

            return res.status(200).send({ message: reqBody.data.gameName ? `Role ${reqBody.data.role} added to user ${user.username} for game ${reqBody.data.gameName}.` : `Role ${reqBody.data.role} added to user ${user.username}`, user });

        });

        this.router.post(`/admin/users/removeRole`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Remove a role from a user.'
            #swagger.description = 'Remove a role from a user.'
            #swagger.requestBody = {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/definitions/zUpdateUserRoles'
                        }
                    }
                }
            }
            #swagger.responses[200]
            #swagger.responses[400]
            #swagger.responses[404]
            */

            let reqBody = Validator.zEditUserRoles.safeParse(req.body);

            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`) });
            }

            let user = await DatabaseHelper.database.Users.findByPk(reqBody.data.userId);
            if (!user) {
                return res.status(404).send({ message: `User not found.` });
            }

            let session: { user: any } = { user: null };
            if (reqBody.data.gameName) {
                switch (reqBody.data.role) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(reqBody.data.gameName, UserRoles.Admin);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(reqBody.data.gameName, UserRoles.Approver);
                        break;
                    case UserRoles.GameManager:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(reqBody.data.gameName, UserRoles.GameManager);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(reqBody.data.gameName, UserRoles.Poster);
                        break;
                    
                    case UserRoles.LargeFiles:
                        session = await validateSession(req, res, UserRoles.Admin, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(reqBody.data.gameName, UserRoles.LargeFiles);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver, reqBody.data.gameName);
                        if (!session.user) {
                            return;
                        }
                        user.removePerGameRole(reqBody.data.gameName, UserRoles.Banned);
                        break;
                    default:
                        return res.status(400).send({ message: `Invalid role.` });
                }
            } else {
                switch (reqBody.data.role) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Admin);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Approver);
                        break;
                    case UserRoles.GameManager:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.user) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.GameManager);
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
            Logger.log(`User ${session.user.username} removed role ${reqBody.data.role} from user ${user.username} for game ${reqBody.data.gameName} by ${session.user?.id}.`);
            return res.status(200).send({ message: reqBody.data.gameName ? `Role ${reqBody.data.role} removed from user ${user.username} for game ${reqBody.data.gameName}.` : `Role ${reqBody.data.role} removed from user ${user.username}`, user });
        });

        this.router.post(`/admin/versions/moveVersion`, async (req, res) => {
            /*
            #swagger.tags = ['Admin']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Move a mod version to a new mod.'
            #swagger.description = 'Move a mod version to a new mod.'
            #swagger.requestBody = {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                versionId: {
                                    type: 'number',
                                    description: 'The mod version ID to move.'
                                },
                                newModId: {
                                    type: 'number',
                                    description: 'The new mod ID to move the version to.'
                                }
                            }
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                $ref: '#/components/responses/ServerMessage'
            }
            #swagger.responses[400]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let modVersionId = Validator.zDBID.safeParse(req.body.versionId);
            let newModId = Validator.zDBID.safeParse(req.body.newModId);
            if (!modVersionId.success || !newModId.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let modVersion = await DatabaseHelper.database.Versions.findByPk(modVersionId.data);
            if (!modVersion) {
                return res.status(404).send({ message: `Version not found.` });
            }

            let originalMod = await DatabaseHelper.database.Projects.findByPk(modVersion.projectId);
            if (!originalMod) {
                return res.status(404).send({ message: `Project not found.` });
            }

            let session = await validateSession(req, res, UserRoles.Approver, originalMod.gameName);
            if (!session.user) {
                return;
            }

            let newMod = await DatabaseHelper.database.Projects.findByPk(newModId.data);
            if (!newMod) {
                return res.status(404).send({ message: `New project not found.` });
            }

            if (originalMod.gameName !== newMod.gameName) {
                return res.status(400).send({ message: `Versions must be for the same game.` });
            }

            modVersion.projectId = newMod.id;
            await modVersion.save().then(() => {
                DatabaseHelper.refreshCache(`versions`);
                sendVersionLog(modVersion, session.user, WebhookLogType.Text_Updated, newMod);
                return res.status(200).send({ message: `Version ${modVersionId.data} moved to project ${newModId.data}.` });
            }).catch((err) => {
                Logger.error(`Error moving mod version ${modVersionId.data}: ${err}`);
                return res.status(500).send({ message: `Error moving Version ${modVersionId.data}: ${Utils.parseErrorMessage(err)}` });
            });
        });
    }
}