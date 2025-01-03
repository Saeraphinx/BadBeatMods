import { Router } from 'express';
import { DatabaseHelper, GameVersion, UserRoles } from '../../shared/Database';
import { validateSession } from '../../shared/AuthHelper';
import { Config } from '../../shared/Config';
import * as fs from 'fs';
import * as path from 'path';
import { Validator } from '../../shared/Validator';
import { Logger } from '../../shared/Logger';

export class AdminRoutes {
    private router: Router;
    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/admin/health/hashCheck`, async (req, res) => {
            // #swagger.tags = ['Admin']
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.approved) {
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
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.approved) {
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
            // #swagger.parameters['versionId'] = { description: 'The version ID to check.', required: true }
            // #swagger.parameters['gameName'] = { description: 'The game name to check.', required: true }
            // #swagger.parameters['includeUnverified'] = { description: 'Include unverified mods.', required: false, type: 'boolean' }
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.approved) {
                return;
            }

            let params = Validator.z.object({
                versionId: Validator.z.number({ coerce: true }).int(),
                gameName: Validator.zGameName,
                includeUnverified: Validator.z.boolean({ coerce: true }).default(false),
            }).required().strict().safeParse(req.query);

            if (!params.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let isSpecificVersion = params.data.versionId === 0 || params.data.versionId === -1;
            let versions: GameVersion[] = [];
            if (isSpecificVersion === true) {
                if (params.data.versionId === 0) {
                    versions = await DatabaseHelper.database.GameVersions.findAll({ where: { gameName: params.data.gameName } });
                } else {
                    versions.push(await GameVersion.getDefaultVersionObject(params.data.gameName));
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
                let request = await fetch(`${Config.server.url}${Config.server.apiRoute}/mods?gameName=${encodeURIComponent(params.data.gameName)}&versionId=${encodeURIComponent(version.version)}&includeUnverified=${params.data.includeUnverified ? `unverified` : `verified`}`);
                if (!request.ok) {
                    return res.status(500).send({ message: `Unable to fetch mods.`, status: request.status, statusText: request.statusText });
                }
                let mods = await request.json() as any;

                for (let mod of mods.mods) {
                    for (let dependancy of mod.latest.dependencies) {
                        if (!mods.mods.find((m: any) => m.latest.id === dependancy)) {
                            errors.push({ mod: mod.mod.name, versionId: mod.latest.id, dependency: dependancy });
                        }
                    }
                }
            }

            if (errors.length > 0) {
                let missingIds = Array.from(new Set(errors.map((error: any) => error.dependency)));
                return res.status(500).send({ message: `Unable to resolve ${errors.length} dependencies.`, missingIds, errors });
            }

            return res.status(200).send({ message: `All dependencies are valid.` });
        });

        this.router.post(`/admin/linkversions`, async (req, res) => {
            // #swagger.tags = ['Admin']
            // #swagger.summary = 'Mark all versions as compatible with another gameversion.'
            // #swagger.description = 'Link two versions together.'
            /* #swagger.parameters['body'] = {
                in: 'body',
                description: 'The versions to link.',
                required: true,
                schema: {
                    version1: 1,
                    version2: 2
                }
            } */
            let session = await validateSession(req, res, UserRoles.Admin);
            if (!session.approved) {
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

        this.router.post(`/admin/users/addRole`, async (req, res) => {
            // #swagger.tags = ['Admin']
            // #swagger.summary = 'Add a role to a user.'
            // #swagger.description = 'Add a role to a user.'
            /* #swagger.parameters['body'] = {
                    in: 'body',
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

            let session: { approved: boolean, user: any } = { approved: false, user: null };
            if (gameName.data) {
                switch (role.data) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions, gameName.data);
                        if (!session.approved) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.addPerGameRole(gameName.data, UserRoles.Poster);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.approved) {
                            return;
                        }

                        if (user.roles.perGame[gameName.data].length > 0) {
                            return res.status(400).send({ message: `User cannot be banned due to already having roles.`, user });
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
                        if (!session.approved) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.addSiteWideRole(UserRoles.Poster);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.approved) {
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
            // #swagger.summary = 'Remove a role from a user.'
            // #swagger.description = 'Remove a role from a user.'
            /* #swagger.parameters['body'] = {
                    in: 'body',
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

            let session: { approved: boolean, user: any } = { approved: false, user: null };
            if (gameName.data) {
                switch (role.data) {
                    case UserRoles.Admin:
                        session = await validateSession(req, res, UserRoles.AllPermissions, gameName.data);
                        if (!session.approved) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.removePerGameRole(gameName.data, UserRoles.Poster);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.approved) {
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
                        if (!session.approved) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Admin);
                        break;
                    case UserRoles.Moderator:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Moderator);
                        break;
                    case UserRoles.Approver:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Approver);
                        break;
                    case UserRoles.Poster:
                        session = await validateSession(req, res, UserRoles.Admin);
                        if (!session.approved) {
                            return;
                        }
                        user.removeSiteWideRole(UserRoles.Poster);
                        break;
                    case UserRoles.Banned:
                        session = await validateSession(req, res, UserRoles.Approver);
                        if (!session.approved) {
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