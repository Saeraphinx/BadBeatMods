import { Router } from 'express';
import { DatabaseHelper, Status, UserRoles } from '../../shared/Database';
import { validateSession } from '../../shared/AuthHelper';
import { Logger } from '../../shared/Logger';
import { Validator } from '../../shared/Validator';
import { SemVer } from 'semver';
import path from 'node:path';
import { Config } from '../../shared/Config';

export class UpdateModRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    // Routes with optional parameters will return a 400 if the parameter is present but invalid
    private async loadRoutes() {
        // #region Update Mod
        this.router.patch(`/mods/:modIdParam`, async (req, res) => {
            // #swagger.tags = ['Mods']
            // #swagger.description = `Update a mod.`
            // #swagger.parameters['modIdParam'] = { description: 'Mod ID', type: 'integer' }
            /* #swagger.requestBody = {
                description: 'Mod data',
                required: true,
                schema: {
                    $ref: '#/definitions/EditMod'
                }
            }
            */
            let modId = Validator.zDBID.safeParse(req.params.modIdParam);
            let reqBody = Validator.zUpdateMod.safeParse(req.body);
            if (!modId.success) {
                return res.status(400).send({ message: `Invalid modId.` });
            }
            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }
            
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            if (!reqBody.data || (!reqBody.data.name && !reqBody.data.summary && !reqBody.data.description && !reqBody.data.category && !reqBody.data.authorIds && !reqBody.data.gitUrl && !reqBody.data.gameName)) {
                return res.status(400).send({ message: `No changes provided.` });
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId.data } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            // check permissions
            let allowedToEdit = false;
            if (session.user.roles.sitewide.includes(UserRoles.AllPermissions) || session.user.roles.sitewide.includes(UserRoles.Approver) || mod.authorIds.includes(session.user.id)) {
                allowedToEdit = true;
            }

            if (reqBody.data.gameName && reqBody.data.gameName !== mod.gameName) {
                // if changing game, check if user has permissions for the new game
                if (session.user.roles.perGame[reqBody.data.gameName]?.includes(UserRoles.AllPermissions) || session. user.roles.perGame[reqBody.data.gameName]?.includes(UserRoles.Approver)) {
                    // and if they have permissions for the current game
                    if (session.user.roles.perGame[mod.gameName]?.includes(UserRoles.AllPermissions) || session.user.roles.perGame[mod.gameName]?.includes(UserRoles.Approver)) {
                        allowedToEdit = true;
                    }
                }
            } else {
                // if not changing game, check if user has permissions for the current game
                if (session.user.roles.perGame[mod.gameName]?.includes(UserRoles.AllPermissions) || session.user.roles.perGame[mod.gameName]?.includes(UserRoles.Approver)) {
                    allowedToEdit = true;
                }
            }

            if (!allowedToEdit) {
                return res.status(401).send({ message: `You cannot edit this mod.` });
            }

            // validate authorIds
            if (reqBody.data.authorIds) {
                if ((await Validator.validateIDArray(reqBody.data.authorIds, `users`, true)) == false) {
                    return res.status(400).send({ message: `Invalid authorIds.` });
                }
            }

            if (mod.status == Status.Verified) {
                let existingEdit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { objectId: mod.id, objectTableName: `mods`, submitterId: session.user.id, approved: null } });

                if (existingEdit) {
                    return res.status(400).send({ message: `You already have a pending edit for this mod.` }); // todo: allow updating the edit
                }

                await DatabaseHelper.database.EditApprovalQueue.create({
                    submitterId: session.user.id,
                    objectTableName: `mods`,
                    objectId: mod.id,
                    object: {
                        name: reqBody.data.name || mod.name,
                        summary: reqBody.data.summary || mod.summary,
                        description: reqBody.data.description || mod.description,
                        gameName: reqBody.data.gameName || mod.gameName,
                        gitUrl: reqBody.data.gitUrl || mod.gitUrl,
                        authorIds: reqBody.data.authorIds || mod.authorIds,
                        category: reqBody.data.category || mod.category,
                        fileSize: mod.fileSize
                    }
                }).then((edit) => {
                    Logger.log(`Edit ${edit.id} (for ${edit.objectId}) submitted by ${session.user.id} for approval.`);
                    res.status(200).send({ message: `Edit ${edit.id} (for ${edit.objectId}) submitted by ${session.user.id} for approval.`, edit: edit });
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                }).catch((error) => {
                    Logger.error(`Error submitting edit: ${error}`);
                    res.status(500).send({ message: `Error creating edit submitted by ${session.user.id}.` });
                });
            } else {
                await mod.update({
                    name: reqBody.data.name || mod.name,
                    summary: reqBody.data.summary || mod.summary,
                    description: reqBody.data.description || mod.description,
                    gameName: reqBody.data.gameName || mod.gameName,
                    gitUrl: reqBody.data.gitUrl || mod.gitUrl,
                    authorIds: reqBody.data.authorIds || mod.authorIds,
                    category: reqBody.data.category || mod.category,
                    lastUpdatedById: session.user.id,
                }).then((mod) => {
                    res.status(200).send({ message: `Mod ${mod.id} updated by ${session.user.id}.`, edit: mod });
                }).catch((error) => {
                    Logger.error(`Error updating mod: ${error}`);
                    res.status(500).send({ message: `Error updating mod ${mod.id}.` });
                });
            }
        });

        this.router.post(`/mods/:modIdParam/icon`, async (req, res) => {
            /* #swagger.parameters['icon'] = {
                in: 'formData',
                type: 'file',
                description: 'Mod icon.',
                required: false
            } */
            // #swagger.tags = ['Mods']
            // #swagger.summary = 'Update a mod icon.'
            // #swagger.description = 'Update a mod icon.'
            // #swagger.parameters['modIdParam'] = { description: 'Mod ID.', type: 'number' }
            let modId = Validator.zDBID.safeParse(req.params.modIdParam);
            if (!modId.success) {
                return res.status(400).send({ message: `Invalid modId.` });
            }
            let gameName = DatabaseHelper.getGameNameFromModId(modId.data);
            if (!gameName) {
                return res.status(400).send({ message: `Invalid modId.` });
            }
            let session = await validateSession(req, res, true, gameName);
            if (!session.user) {
                return;
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId.data } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            let icon = req.files?.icon;
            
            // validate icon if it exists
            if (icon !== undefined && !Array.isArray(icon)) {
                if (icon.size > 8 * 1024 * 1024) {
                    return res.status(413).send({ message: `Invalid file (Might be too large, 8MB max.)` });
                } else {
                    let isAcceptableImage = (icon.mimetype === `image/png` && icon.name.endsWith(`.png`)) || (icon.mimetype === `image/jpeg` && (icon.name.endsWith(`.jpeg`) || icon.name.endsWith(`.jpg`)) || (icon.mimetype === `image/webp` && icon.name.endsWith(`.webp`)));
            
                    if (!isAcceptableImage) {
                        return res.status(400).send({ message: `Invalid file type.` });
                    }
                }
            } else {
                return res.status(400).send({ message: `Invalid file.` });
            }
            
            // if the icon is invalid, we don't need to do anything since it was delt with above
            let filePath = ``;
            // this is jsut so that the following code doesn't have to cast icon as UploadedFile every time
            // move the icon to the correct location
            filePath = `${path.resolve(Config.storage.iconsDir)}/${icon.md5}${path.extname(icon.name)}`;
            if (filePath.startsWith(`${path.resolve(Config.storage.iconsDir)}`) == false) {
                return res.status(400).send({ message: `Invalid icon.` });
            }
            let oldFileName = mod.iconFileName;
            mod.iconFileName = `${icon.md5}${path.extname(icon.name)}`;
            mod.save().then((mod) => {
                icon.mv(filePath, (error) => {
                    if (error) {
                        Logger.error(`Error moving icon: ${error}`);
                        mod.iconFileName = oldFileName;
                        mod.save();
                        return res.status(500).send({ message: `Error moving icon.` });
                    }
                    res.status(200).send({ message: `Icon updated.`, mod });
                });
            });
        });
        // #endregion Update Mod

        // #region Update Mod Version
        this.router.patch(`/modversion/:modVersionIdParam`, async (req, res) => {
            // #swagger.tags = ['Mods']
            // #swagger.description = `Update a mod version.`
            // #swagger.parameters['modVersionIdParam'] = { description: 'Mod Version ID', type: 'integer' }
            /* #swagger.requestBody = {
                description: 'Mod version data',
                required: true,
                schema: {
                    $ref: '#/definitions/CreateEditModVersion'
                }
            }
            */
            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            let reqBody = Validator.zUpdateModVersion.safeParse(req.body);

            if (!modVersionId.success) {
                return res.status(400).send({ message: `Invalid modVersionId.` });
            }
            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }

            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            if (!reqBody.data || (!reqBody.data.supportedGameVersionIds && !reqBody.data.modVersion && !reqBody.data.dependencies && !reqBody.data.platform)) {
                return res.status(400).send({ message: `No changes provided.` });
            }

            let modVersion = await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersionId.data } });
            if (!modVersion) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modVersion.modId } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            let allowedToEdit = false;
            if (session.user.roles.sitewide.includes(UserRoles.AllPermissions) || session.user.roles.sitewide.includes(UserRoles.Approver) || mod.authorIds.includes(session.user.id)) {
                allowedToEdit = true;
            }

            if (session.user.roles.perGame[mod.gameName]?.includes(UserRoles.AllPermissions) || session.user.roles.perGame[mod.gameName]?.includes(UserRoles.Approver)) {
                allowedToEdit = true;
            }

            if (!allowedToEdit) {
                return res.status(401).send({ message: `You cannot edit this mod.` });
            }

            if (reqBody.data.dependencies) {
                if ((await Validator.validateIDArray(reqBody.data.dependencies, `modVersions`, true)) == false) {
                    return res.status(400).send({ message: `Invalid dependencies.` });
                }
            }

            if (reqBody.data.supportedGameVersionIds) {
                if ((await Validator.validateIDArray(reqBody.data.supportedGameVersionIds, `gameVersions`, true)) == false) {
                    return res.status(400).send({ message: `Invalid gameVersionIds.` });
                }
            }

            if (modVersion.status == Status.Verified) {
                let existingEdit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { objectId: modVersion.id, objectTableName: `modVersions`, submitterId: session.user.id, approved: null } });

                if (existingEdit) {
                    return res.status(400).send({ message: `You already have a pending edit for this mod version.` }); // todo: allow updating the edit
                }

                await DatabaseHelper.database.EditApprovalQueue.create({
                    submitterId: session.user.id,
                    objectTableName: `modVersions`,
                    objectId: modVersion.id,
                    object: {
                        supportedGameVersionIds: reqBody.data.supportedGameVersionIds || modVersion.supportedGameVersionIds,
                        modVersion: reqBody.data.modVersion ? new SemVer(reqBody.data.modVersion) : modVersion.modVersion,
                        dependencies: reqBody.data.dependencies || modVersion.dependencies,
                        platform: reqBody.data.platform || modVersion.platform,
                        fileSize: modVersion.fileSize
                    }
                }).then((edit) => {
                    res.status(200).send({ message: `Edit ${edit.id} (for ${edit.objectId}) submitted by ${session.user.id} for approval.`, edit: edit });
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                }).catch((error) => {
                    Logger.error(`Error submitting edit: ${error}`);
                    res.status(500).send({ message: `Error submitting edit.` });
                });
            } else {
                await modVersion.update({
                    supportedGameVersionIds: reqBody.data.supportedGameVersionIds || modVersion.supportedGameVersionIds,
                    modVersion: reqBody.data.modVersion ? new SemVer(reqBody.data.modVersion) : modVersion.modVersion,
                    dependencies: reqBody.data.dependencies || modVersion.dependencies,
                    platform: reqBody.data.platform || modVersion.platform,
                }).then((modVersion) => {
                    res.status(200).send({ message: `Mod version updated.`, modVersion });
                }).catch((error) => {
                    Logger.error(`Error updating mod version: ${error}`);
                    res.status(500).send({ message: `Error updating mod version.` });
                });
            }
        });
        // #endregion Update Mod Version
        // #region Submit to Approval
        this.router.post(`/mods/:modIdParam/submit`, async (req, res) => {
            // #swagger.tags = ['Mods']
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let modId = Validator.zDBID.safeParse(req.params.modIdParam);
            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId.data } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            if (!mod.authorIds.includes(session.user.id)) {
                return res.status(401).send({ message: `You cannot submit this mod.` });
            }

            if (mod.status !== Status.Private) {
                return res.status(400).send({ message: `Mod is already submitted.` });
            }

            mod.setStatus(Status.Unverified, session.user).then((mod) => {
                res.status(200).send({ message: `Mod submitted.`, mod });
            }).catch((error) => {
                res.status(500).send({ message: `Error submitting mod: ${error}` });
            });
        });

        this.router.post(`/modVersions/:modVersionIdParam/submit`, async (req, res) => {
            // #swagger.tags = ['Mods']
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            let modVersion = await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersionId.data } });
            if (!modVersion) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modVersion.modId } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            if (!mod.authorIds.includes(session.user.id)) {
                return res.status(401).send({ message: `You cannot submit this mod version.` });
            }

            if (modVersion.status !== Status.Private) {
                return res.status(400).send({ message: `Mod version is already submitted.` });
            }

            modVersion.setStatus(Status.Unverified, session.user).then((modVersion) => {
                res.status(200).send({ message: `Mod version submitted.`, modVersion });
            }).catch((error) => {
                res.status(500).send({ message: `Error submitting mod version: ${error}` });
            });
            // #endregion Submit
        });
    }
}