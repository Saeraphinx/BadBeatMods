import { Router } from 'express';
import { DatabaseHelper, Status } from '../../shared/Database.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Logger } from '../../shared/Logger.ts';
import { Validator } from '../../shared/Validator.ts';
import { SemVer } from 'semver';
import path from 'node:path';
import { Config } from '../../shared/Config.ts';
import { Utils } from '../../shared/Utils.ts';

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
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
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

            let isGameChange = reqBody.data.gameName && reqBody.data.gameName !== mod.gameName;
            if (mod.isAllowedToEdit(session.user, isGameChange) == false) {
                return res.status(401).send({ message: `You cannot edit this mod.` });
            }

            // validate authorIds
            if (reqBody.data.authorIds) {
                if ((await Validator.validateIDArray(reqBody.data.authorIds, `users`, true)) == false) {
                    return res.status(400).send({ message: `Invalid authorIds.` });
                }
            }

            mod.edit({
                name: reqBody.data.name || mod.name,
                summary: reqBody.data.summary || mod.summary,
                description: reqBody.data.description || mod.description,
                gameName: reqBody.data.gameName || mod.gameName,
                gitUrl: reqBody.data.gitUrl || mod.gitUrl,
                authorIds: reqBody.data.authorIds || mod.authorIds,
                category: reqBody.data.category || mod.category,
            }, session.user).then((mod) => {
                if (mod.isEditObj) {
                    if (mod.newEdit) {
                        res.status(200).send({ message: `Edit ${mod.edit.id} (for ${mod.edit.objectId}) submitted by ${session.user.id} for approval.`, edit: mod.edit });
                    } else {
                        res.status(200).send({ message: `Edit ${mod.edit.id} (for ${mod.edit.objectId}) updated by ${session.user.id}.`, edit: mod.edit });
                    }
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                    return;
                } else {
                    res.status(200).send({ message: `Mod updated.`, mod: mod.mod });
                    DatabaseHelper.refreshCache(`mods`);
                }
            }).catch((error) => {
                let errorMessage = Utils.parseErrorMessage(error);
                res.status(500).send({ message: `Error updating mod: ${errorMessage}` });
            });
        });

        this.router.post(`/mods/:modIdParam/icon`, async (req, res) => {
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
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
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
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

            if (await modVersion.isAllowedToEdit(session.user, mod) == false) {
                return res.status(401).send({ message: `You cannot edit this mod.` });
            }

            if (reqBody.data.dependencies) {
                if ((await Validator.validateIDArray(reqBody.data.dependencies.map(d => d.parentId), `mods`, true)) == false) {
                    return res.status(400).send({ message: `Invalid dependencies.` });
                }
            }

            if (reqBody.data.supportedGameVersionIds) {
                if ((await Validator.validateIDArray(reqBody.data.supportedGameVersionIds, `gameVersions`, true)) == false) {
                    return res.status(400).send({ message: `Invalid gameVersionIds.` });
                }
            }

            modVersion.edit({
                supportedGameVersionIds: reqBody.data.supportedGameVersionIds || modVersion.supportedGameVersionIds,
                modVersion: reqBody.data.modVersion ? new SemVer(reqBody.data.modVersion) : modVersion.modVersion,
                dependencies: reqBody.data.dependencies || modVersion.dependencies,
                platform: reqBody.data.platform || modVersion.platform,
            }, session.user).then((modVersion) => {
                if (modVersion.isEditObj) {
                    if (modVersion.newEdit) {
                        res.status(200).send({ message: `Edit ${modVersion.edit.id} (for ${modVersion.edit.objectId}) submitted by ${session.user.id} for approval.`, edit: modVersion.edit });
                    } else {
                        res.status(200).send({ message: `Edit ${modVersion.edit.id} (for ${modVersion.edit.objectId}) updated by ${session.user.id}.`, edit: modVersion.edit });
                    }
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                    return;
                } else {
                    res.status(200).send({ message: `Mod version updated.`, modVersion });
                    DatabaseHelper.refreshCache(`modVersions`);
                }
            }).catch((error) => {
                let errorMessage = Utils.parseErrorMessage(error);
                res.status(500).send({ message: `Error updating mod version: ${errorMessage}` });
            });
        });
        // #endregion Update Mod Version
        // #region Submit to Approval
        this.router.post(`/mods/:modIdParam/submit`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
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

            mod.setStatus(Status.Pending, session.user, `Mod submitted for verification by ${session.user.username}`).then((mod) => {
                res.status(200).send({ message: `Mod submitted.`, mod });
                DatabaseHelper.refreshCache(`mods`);
            }).catch((error) => {
                let message = `Error submitting mod.`;
                if (Array.isArray(error?.errors) && error?.errors?.length > 0) {
                    message = error.errors.map((e: any) => e.message).join(`, `);
                }
                res.status(500).send({ message: `Error submitting mod: ${error} ${message} ${error?.name}` });
            });
        });

        this.router.post(`/modVersions/:modVersionIdParam/submit`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
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

            modVersion.setStatus(Status.Pending, session.user, `Version submitted for approval by ${session.user.username}`).then((modVersion) => {
                res.status(200).send({ message: `Mod version submitted.`, modVersion });
                DatabaseHelper.refreshCache(`modVersions`);
            }).catch((error) => {
                res.status(500).send({ message: `Error submitting mod version: ${error}` });
            });
            
        });
        // #endregion Submit
        // #region Edits
        this.router.get(`/edits`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.description = `Get all edits.`
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let usersMods = await DatabaseHelper.cache.mods.filter((mod) => {
                return mod.authorIds.includes(session.user.id);
            });

            let edits = DatabaseHelper.cache.editApprovalQueue.filter((edit) => {
                if (edit.isMod()) {
                    return edit.submitterId == session.user.id || usersMods.some((mod) => edit.objectId == mod.id);
                } else {
                    let modVersion = DatabaseHelper.mapCache.modVersions.get(edit.objectId);
                    if (!modVersion) {
                        return false;
                    }
                    return edit.submitterId == session.user.id || usersMods.some((mod) => mod.id == modVersion.modId);
                }
            });

            res.status(200).send({ message: `Found ${edits.length} edits.`, edits: edits });
        });

        this.router.get(`/edits/:editIdParam`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.description = `Get an edit.`
            // #swagger.parameters['editIdParam'] = { description: 'Edit ID', type: 'integer' }
            let editId = Validator.zDBID.safeParse(req.params.editIdParam);
            if (!editId.success) {
                return res.status(400).send({ message: `Invalid editId.` });
            }

            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let edit = DatabaseHelper.cache.editApprovalQueue.find((edit) => edit.id == editId.data);
            if (!edit) {
                return res.status(404).send({ message: `Edit not found.` });
            }

            let parentObj = edit.isMod() ? DatabaseHelper.mapCache.mods.get(edit.objectId) : DatabaseHelper.mapCache.modVersions.get(edit.objectId);
            if (!parentObj) {
                return res.status(404).send({ message: `Parent object not found.` });
            }

            let isAllowedToView = parentObj?.isAllowedToView(session.user);

            if (!isAllowedToView) {
                return res.status(401).send({ message: `You cannot view this edit.` });
            }

            return res.status(200).send({ message: `Edit found.`, edit });
        });

        this.router.delete(`/edits/:editIdParam`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.description = `Delete an edit.`
            // #swagger.parameters['editIdParam'] = { description: 'Edit ID', type: 'integer' }
            let editId = Validator.zDBID.safeParse(req.params.editIdParam);
            if (!editId.success) {
                return res.status(400).send({ message: `Invalid editId.` });
            }

            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let edit = DatabaseHelper.cache.editApprovalQueue.find((edit) => edit.id == editId.data);
            if (!edit) {
                return res.status(404).send({ message: `Edit not found.` });
            }

            let parentObj = edit.isMod() ? DatabaseHelper.mapCache.mods.get(edit.objectId) : DatabaseHelper.mapCache.modVersions.get(edit.objectId);
            if (!parentObj) {
                return res.status(404).send({ message: `Parent object not found.` });
            }

            let isAllowedToDelete = parentObj?.isAllowedToEdit(session.user);

            if (!isAllowedToDelete) {
                return res.status(401).send({ message: `You cannot delete this edit.` });
            }

            await edit.deny(session.user).then(() => {
                res.status(200).send({ message: `Edit deleted.` });
                DatabaseHelper.refreshCache(`editApprovalQueue`);
            }).catch((error) => {
                let errorMessage = Utils.parseErrorMessage(error);
                res.status(500).send({ message: `Error deleting edit: ${errorMessage}` });
            });
        });
    }
}