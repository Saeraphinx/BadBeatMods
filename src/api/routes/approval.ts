import { Router } from 'express';
import { DatabaseHelper, UserRoles, Status, ModVersion } from '../../shared/Database';
import { validateAdditionalGamePermissions, validateSession } from '../../shared/AuthHelper';
import { Logger } from '../../shared/Logger';
import { SemVer } from 'semver';
import { Op } from 'sequelize';
import { Validator } from '../../shared/Validator';

export class ApprovalRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        // #region Get Approvals
        this.router.get(`/approval/new`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Get new mods & modVersions pending approval.'
            // #swagger.description = 'Get a list of mods & modVersions pending their first approval.'
            // #swagger.parameters['gameName'] = { description: 'The name of the game to get new mods for.', type: 'string' }
            // #swagger.responses[200] = { description: 'List of mods pending first approval', schema: { mods: [], modVersions: [] } }
            // #swagger.responses[204] = { description: 'No mods found.' }
            // #swagger.responses[400] = { description: 'Missing game name.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            let gameName = Validator.zGameName.safeParse(req.query.gameName);
            if (!gameName.success) {
                return res.status(400).send({ message: `Missing game name.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, gameName.data);
            if (!session.user) {
                return;
            }

            //get mods and modVersions that are unverified (gameName filter on mods only)
            let newMods = (await DatabaseHelper.database.Mods.findAll({ where: { status: `unverified`, gameName: gameName.data } })).map((mod) => mod.toAPIResponse());
            let newModVersions = await DatabaseHelper.database.ModVersions.findAll({ where: { status: `unverified` } });
            if (!newMods || !newModVersions) {
                return res.status(204).send({ message: `No mods found.` });
            }

            // filter out modVersions that don't support the game specified
            let modVersions = newModVersions.filter((modVersion) => {
                for (let gameVersionId of modVersion.supportedGameVersionIds) {
                    let gV = DatabaseHelper.cache.gameVersions.find((gameVersion) => gameVersion.id === gameVersionId);
                    if (!gV || gV.gameName !== gameName.data) {
                        return false;
                    } else {
                        return true;
                    }
                }
            });

            res.status(200).send({ mods: newMods, modVersions: modVersions });
        });

        this.router.get(`/approval/edits`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Get edits pending approval.'
            // #swagger.description = 'Get a list of already existing mod & modVersions that are pending approval.'
            // #swagger.parameters['gameName'] = { description: 'The name of the game to get edits for.', type: 'string' }
            // #swagger.responses[200] = { description: 'List of edits pending approval', schema: { edits: [] } }
            // #swagger.responses[204] = { description: 'No edits found.' }
            // #swagger.responses[400] = { description: 'Missing game name.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            let gameName = Validator.zGameName.safeParse(req.query.gameName);
            if (!gameName.success) {
                return res.status(400).send({ message: `Missing game name.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, gameName.data);
            if (!session.user) {
                return;
            }

            // get all edits that are unapproved
            let editQueue = await DatabaseHelper.database.EditApprovalQueue.findAll({where: { approved: null }});
            if (!editQueue) {
                return res.status(204).send({ message: `No edits found.` });
            }

            // filter out edits that don't support the game specified
            editQueue = editQueue.filter((edit) => {
                if (`name` in edit.object) {
                    return edit.object.gameName === gameName.data;
                } else {
                    return edit.object.supportedGameVersionIds.filter((gameVersionId) => {
                        let gV = DatabaseHelper.cache.gameVersions.find((gameVersion) => gameVersion.id === gameVersionId);
                        if (!gV) {
                            return false;
                        }
                        return gV.gameName === gameName.data;
                    }).length > 0;
                }
            });

            res.status(200).send({ edits: editQueue });
        });
        // #endregion
        // #region Accept/Reject Approvals
        this.router.post(`/approval/mod/:modIdParam/approve`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Approve a mod.'
            // #swagger.description = 'Approve a mod for public visibility.'
            // #swagger.parameters['modIdParam'] = { description: 'The id of the mod to approve.', type: 'integer' }
            // #swagger.parameters['status'] = { description: 'The status to set the mod to.', type: 'string' }
            // #swagger.responses[200] = { description: 'Mod status updated.' }
            // #swagger.responses[400] = { description: 'Missing status.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'Mod not found.' }
            // #swagger.responses[500] = { description: 'Error approving mod.' }
            let modId = Validator.zDBID.safeParse(req.params.modIdParam);
            let status = Validator.zStatus.safeParse(req.body.status);
            if (!modId.success || !status.success) {
                return res.status(400).send({ message: `Invalid Mod ID or Status.` });
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId.data } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            let session = await validateSession(req, res, UserRoles.Approver, mod.gameName);
            if (!session.user) {
                return;
            }

            mod.setStatus(status.data, session.user).then(() => {
                Logger.log(`Mod ${modId} set to status ${status.data} by ${session.user!.username}.`);
                DatabaseHelper.refreshCache(`mods`);
                return res.status(200).send({ message: `Mod ${status.data}.` });
            }).catch((error) => {
                Logger.error(`Error ${status} mod: ${error}`);
                return res.status(500).send({ message: `Error ${status.data} mod:  ${error}` });
            });
        });

        this.router.post(`/approval/modversion/:modVersionIdParam/approve`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Approve a modVersion.'
            // #swagger.description = 'Approve a modVersion for public visibility.'
            // #swagger.parameters['modVersionIdParam'] = { description: 'The id of the modVersion to approve.', type: 'integer' }
            // #swagger.parameters['status'] = { description: 'The status to set the modVersion to.', type: 'string' }
            // #swagger.responses[200] = { description: 'ModVersion status updated.' }
            // #swagger.responses[400] = { description: 'Missing status.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'ModVersion not found.' }
            // #swagger.responses[500] = { description: 'Error approving modVersion.' }
            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            let status = Validator.zStatus.safeParse(req.body.status);
            if (!modVersionId.success || !status.success) {
                return res.status(400).send({ message: `Invalid ModVersion ID or Status.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromModVersionId(modVersionId.data));
            if (!session.user) {
                return;
            }

            // get db objects
            let modVersion = await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersionId.data } });
            if (!modVersion) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modVersion.modId } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            modVersion.setStatus(status.data, session.user).then(() => {
                Logger.log(`ModVersion ${modVersion.id} set to status ${status} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`modVersions`);
                return res.status(200).send({ message: `Mod ${status.data}.` });
            }).catch((error) => {
                Logger.error(`Error ${status} mod: ${error}`);
                return res.status(500).send({ message: `Error ${status.data} mod:  ${error}` });
            });
        });

        this.router.post(`/approval/edit/:editIdParam/approve`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Approve an edit.'
            // #swagger.description = 'Approve an edit for public visibility.'
            // #swagger.parameters['editIdParam'] = { description: 'The id of the edit to approve.', type: 'integer' }
            // #swagger.parameters['accepted'] = { description: 'The status to set the edit to.', type: 'boolean' }
            // #swagger.responses[200] = { description: 'Edit status updated.' }
            // #swagger.responses[400] = { description: 'Missing status.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'Edit not found.' }
            // #swagger.responses[500] = { description: 'Error approving edit.' }
            let editId = Validator.zDBID.safeParse(req.params.editIdParam);
            let accepted = Validator.zBool.safeParse(req.body.accepted);
            if (!editId.success || !accepted.success) {
                return res.status(400).send({ message: `Invalid edit id or accepted value.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromEditApprovalQueueId(editId.data));
            if (!session.user) {
                return;
            }

            // get and check db objects
            let edit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { id: editId.data } });
            if (!edit) {
                return res.status(404).send({ message: `Edit not found.` });
            }

            let isMod = `name` in edit.object;
            let modId = isMod ? edit.objectId : await DatabaseHelper.database.ModVersions.findOne({ where: { id: edit.objectId } }).then((modVersion) => {
                if (!modVersion) {
                    return null;
                } else {
                    return modVersion.modId;
                }
            });

            if (!modId) {
                return res.status(404).send({ message: `Mod not found.` });
            }
            
            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            // approve or deny edit
            if (accepted.data) {
                edit.approve(session.user).then((record) => {
                    Logger.log(`Edit ${editId.data} accepted by ${session.user.username}.`);
                    isMod ? DatabaseHelper.refreshCache(`mods`) : DatabaseHelper.refreshCache(`modVersions`);
                    return res.status(200).send({ message: `Edit accepted.`, record: record });
                }).catch((error) => {
                    Logger.error(`Error approving edit ${editId.data}: ${error}`);
                    return res.status(500).send({ message: `Error approving edit:  ${error}` });
                });
            } else {
                edit.deny(session.user).then(() => {
                    Logger.log(`Edit ${editId.data} rejected by ${session.user.username}.`);
                    isMod ? DatabaseHelper.refreshCache(`mods`) : DatabaseHelper.refreshCache(`modVersions`);
                    return res.status(200).send({ message: `Edit rejected.` });
                }).catch((error) => {
                    Logger.error(`Error rejecting edit ${editId}: ${error}`);
                    return res.status(500).send({ message: `Error rejecting edit:  ${error}` });
                });
            }
        });
        // #endregion
        // #region Edit Approvals
        this.router.patch(`/approval/mod/:modIdParam`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Edit a mod in the approval queue.'
            // #swagger.description = 'Edit a mod in the approval queue.'
            // #swagger.parameters['modIdParam'] = { description: 'The id of the mod to edit.', type: 'integer', required: true }
            // #swagger.parameters['name'] = { description: 'The new name of the mod.', type: 'string' }
            // #swagger.parameters['summary'] = { description: 'The new summary of the mod.', type: 'string' }
            // #swagger.parameters['description'] = { description: 'The new description of the mod.', type: 'string' }
            // #swagger.parameters['gitUrl'] = { description: 'The new gitUrl of the mod.', type: 'string' }
            // #swagger.parameters['category'] = { description: 'The new category of the mod.', type: 'string' }
            // #swagger.parameters['gameName'] = { description: 'The new gameName of the mod.', type: 'string' }
            // #swagger.responses[200] = { description: 'Mod updated.', schema: { mod: {} } }
            // #swagger.responses[400] = { description: 'No changes provided.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'Mod not found.' }
            // #swagger.responses[500] = { description: 'Error updating mod.' }
            let modId = Validator.zDBID.safeParse(req.params.modIdParam);
            if (!modId.success) {
                return res.status(400).send({ message: `Invalid mod id.` });
            }
            let reqBody = Validator.zUpdateMod.safeParse(req.body);
            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }
            if (!reqBody.data) {
                return res.status(400).send({ message: `Missing parameters.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromModId(modId.data));
            if (!session.user) {
                return;
            }

            // if the gameName is being changed, check if the user has permission to approve mods the new game
            if (reqBody.data.gameName && reqBody.data.gameName !== DatabaseHelper.getGameNameFromModId(modId.data) && validateAdditionalGamePermissions(session, reqBody.data.gameName, UserRoles.Approver) == false) {
                return res.status(401).send({ message: `You cannot edit this mod.` });
            }

            // parameter validation
            if (!reqBody.data.name && !reqBody.data.summary && !reqBody.data.description && !reqBody.data.gitUrl && !reqBody.data.category && !reqBody.data.gameName && !reqBody.data.authorIds) {
                return res.status(400).send({ message: `No changes provided.` });
            }

            if ((await Validator.validateIDArray(reqBody.data.authorIds, `users`, false, true)) == false) {
                return res.status(400).send({ message: `Invalid authorIds.` });
            }

            // get db object
            let mod = await DatabaseHelper.database.Mods.findByPk(modId.data);

            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            // if the parameter is not provided, keep the old value
            mod.name = reqBody.data.name || mod.name;
            mod.summary = reqBody.data.summary || mod.summary;
            mod.description = reqBody.data.description || mod.description;
            mod.gitUrl = reqBody.data.gitUrl || mod.gitUrl;
            mod.category = reqBody.data.category || mod.category;
            mod.gameName = reqBody.data.gameName || mod.gameName;
            mod.lastUpdatedById = session.user.id;
            mod.save().then(() => {
                Logger.log(`Mod ${modId} updated by ${session.user.username}.`);
                return res.status(200).send({ message: `Mod updated.`, mod: mod });
            }).catch((error) => {
                Logger.error(`Error updating mod ${modId}: ${error}`);
                return res.status(500).send({ message: `Error updating mod: ${error}` });
            });
        });

        this.router.patch(`/approval/modversion/:modVersionIdParam`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Edit a modVersion in the approval queue.'
            // #swagger.description = 'Edit a modVersion in the approval queue.'
            // #swagger.parameters['modVersionIdParam'] = { description: 'The id of the modVersion to edit.', type: 'integer', required: true }
            // #swagger.parameters['gameVersionIds'] = { description: 'The new gameVersionIds of the modVersion.', type: 'array', items: { type: 'integer' } }
            // #swagger.parameters['modVersion'] = { description: 'The new modVersion of the modVersion.', type: 'string' }
            // #swagger.parameters['dependencyIds'] = { description: 'The new dependencyIds of the modVersion.', type: 'array', items: { type: 'integer' } }
            // #swagger.parameters['platform'] = { description: 'The new platform of the modVersion.', type: 'string' }
            // #swagger.responses[200] = { description: 'ModVersion updated.', schema: { modVersion: {} } }
            // #swagger.responses[400] = { description: 'No changes provided.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'ModVersion not found.' }
            // #swagger.responses[500] = { description: 'Error updating modVersion.' }
            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            if (!modVersionId.success) {
                return res.status(400).send({ message: `Invalid mod version id.` });
            }
            let reqBody = Validator.zUpdateModVersion.safeParse(req.body);
            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromModVersionId(modVersionId.data));
            if (!session.user) {
                return;
            }

            // parameter validation & getting db object
            let modVer = await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersionId, status: Status.Unverified } });
            if (!modVer) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            if (!reqBody.data || (!reqBody.data.modVersion && !reqBody.data.supportedGameVersionIds && !reqBody.data.dependencies && !reqBody.data.platform)) {
                return res.status(400).send({ message: `No changes provided.` });
            }

            if ((await Validator.validateIDArray(reqBody.data.supportedGameVersionIds, `gameVersions`, false, true)) == false) {
                return res.status(400).send({ message: `Invalid gameVersionIds.` });
            }

            if ((await Validator.validateIDArray(reqBody.data.dependencies, `modVersions`, true, true)) == false) {
                return res.status(400).send({ message: `Invalid dependencies.` });
            }

            // if the parameter is not provided, keep the old value
            modVer.dependencies = reqBody.data.dependencies || modVer.dependencies;
            modVer.supportedGameVersionIds = reqBody.data.supportedGameVersionIds || modVer.supportedGameVersionIds;
            modVer.modVersion = reqBody.data.modVersion ? new SemVer(reqBody.data.modVersion) : modVer.modVersion;
            modVer.platform = reqBody.data.platform || modVer.platform;
            modVer.lastUpdatedById = session.user.id;
            modVer.save().then(() => {
                Logger.log(`ModVersion ${modVersionId} updated by ${session.user.username}.`);
                return res.status(200).send({ message: `ModVersion updated.`, modVersion: modVer });
            }).catch((error) => {
                Logger.error(`Error updating modVersion ${modVersionId}: ${error}`);
                return res.status(500).send({ message: `Error updating modVersion: ${error}` });
            });
        });

        this.router.patch(`/approval/edit/:editIdParam`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Edit an edit in the approval queue.'
            // #swagger.description = 'Edit an edit in the approval queue.'
            // #swagger.parameters['editIdParam'] = { description: 'The id of the edit to edit.', type: 'integer', required: true }
            // #swagger.parameters['name'] = { description: 'The new name of the mod.', type: 'string' }
            // #swagger.parameters['summary'] = { description: 'The new summary of the mod.', type: 'string' }
            // #swagger.parameters['description'] = { description: 'The new description of the mod.', type: 'string' }
            // #swagger.parameters['gitUrl'] = { description: 'The new gitUrl of the mod.', type: 'string' }
            // #swagger.parameters['category'] = { description: 'The new category of the mod.', type: 'string' }
            // #swagger.parameters['authorIds'] = { description: 'The new authorIds of the mod.', type: 'array', items: { type: 'integer' } }
            // #swagger.parameters['gameName'] = { description: 'The new gameName of the mod.', type: 'string' }
            // #swagger.parameters['gameVersionIds'] = { description: 'The new gameVersionIds of the mod.', type: 'array', items: { type: 'integer' } }
            // #swagger.parameters['modVersion'] = { description: 'The new modVersion of the mod.', type: 'string' }
            // #swagger.parameters['dependencyIds'] = { description: 'The new dependencyIds of the mod.', type: 'array', items: { type: 'integer' } }
            // #swagger.parameters['platform'] = { description: 'The new platform of the mod.', type: 'string' }
            // #swagger.responses[200] = { description: 'Edit updated.', schema: { edit: {} } }
            // #swagger.responses[400] = { description: 'No changes provided.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'Edit not found.' }
            // #swagger.responses[500] = { description: 'Error updating edit.' }
            let editId = Validator.zDBID.safeParse(req.params.editIdParam);
            if (!editId.success) {
                return res.status(400).send({ message: `Invalid edit id.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromEditApprovalQueueId(editId.data));
            if (!session.user) {
                return;
            }
            
            // get and check db objects
            let edit = await DatabaseHelper.database.EditApprovalQueue.findOne({ where: { id: editId.data, approved: null } });

            if (!edit) {
                return res.status(404).send({ message: `Edit not found.` });
            }

            let modId = edit.isMod() ? edit.objectId : await DatabaseHelper.database.ModVersions.findOne({ where: { id: edit.objectId } }).then((modVersion) => {
                if (!modVersion) {
                    return null;
                } else {
                    return modVersion.modId;
                }
            });

            if (!modId) {
                return res.status(404).send({ message: `Mod ID not found.` });
            }
            
            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId } });

            if (!mod) {
                return res.status(500).send({ message: `Mod not found.` });
            }


            switch (edit.objectTableName) {
                case `mods`:
                    if (!edit.isMod()) {
                        Logger.error(`Edit ${editId} is not a mod edit, despite the table name being "mods".`);
                        return res.status(500).send({ message: `Invalid edit.` });
                    }

                    // parameter validation for mods
                    let reqBodym = Validator.zUpdateMod.safeParse(req.body);
                    if (!reqBodym.success) {
                        return res.status(400).send({ message: `Invalid parameters.`, errors: reqBodym.error.issues });
                    }
                    
                    if (!reqBodym.data || (!reqBodym.data.name && !reqBodym.data.summary && !reqBodym.data.description && !reqBodym.data.gitUrl && !reqBodym.data.category && !reqBodym.data.gameName && !reqBodym.data.authorIds)) {
                        return res.status(400).send({ message: `No changes provided.` });
                    }

                    if ((await Validator.validateIDArray(reqBodym.data.authorIds, `users`, false, true)) == false) {
                        return res.status(400).send({ message: `Invalid authorIds.` });
                    }

                    // if the gameName is being changed, check if the user has permission to approve mods the new game
                    if (reqBodym.data.gameName && reqBodym.data.gameName !== mod.gameName && validateAdditionalGamePermissions(session, reqBodym.data.gameName, UserRoles.Approver) == false) {
                        return res.status(401).send({ message: `You cannot edit this mod.` });
                    }

                    // if the parameter is not provided, keep the old value
                    edit.object = {
                        name: reqBodym.data.name || edit.object.name,
                        summary: reqBodym.data.summary || edit.object.summary,
                        description: reqBodym.data.description || edit.object.description,
                        gitUrl: reqBodym.data.gitUrl || edit.object.gitUrl,
                        category: reqBodym.data.category || edit.object.category,
                        authorIds: reqBodym.data.authorIds || edit.object.authorIds,
                        gameName: reqBodym.data.gameName || edit.object.gameName,
                    };
                    edit.save();
                    break;
                case `modVersions`:
                    if (!edit.isModVersion()) {
                        Logger.error(`Edit ${editId} is not a mod version edit, despite the table name being "modVersions".`);
                        return res.status(500).send({ message: `Invalid edit.` });
                    }
                    
                    // parameter validation for modVersions
                    let reqBodyv = Validator.zUpdateModVersion.safeParse(req.body);
                    if (!reqBodyv.success) {
                        return res.status(400).send({ message: `Invalid parameters.`, errors: reqBodyv.error.issues });
                    }

                    // parameter validation & getting db object
                    if (!reqBodyv.data || (!reqBodyv.data.modVersion && !reqBodyv.data.supportedGameVersionIds && !reqBodyv.data.dependencies && !reqBodyv.data.platform)) {
                        return res.status(400).send({ message: `No changes provided.` });
                    }

                    if ((await Validator.validateIDArray(reqBodyv.data.supportedGameVersionIds, `gameVersions`, false, true)) == false) {
                        return res.status(400).send({ message: `Invalid gameVersionIds.` });
                    }

                    if ((await Validator.validateIDArray(reqBodyv.data.dependencies, `modVersions`, true, true)) == false) {
                        return res.status(400).send({ message: `Invalid dependencies.` });
                    }

                    edit.object = {
                        modVersion: reqBodyv.data.modVersion ? new SemVer(reqBodyv.data.modVersion) : edit.object.modVersion,
                        supportedGameVersionIds: reqBodyv.data.supportedGameVersionIds || edit.object.supportedGameVersionIds,
                        dependencies: reqBodyv.data.dependencies || edit.object.dependencies,
                        platform: reqBodyv.data.platform || edit.object.platform,
                    };
                    edit.save();
                    break;
            }

            res.status(200).send({ message: `Edit updated.`, edit: edit });
        });
        // #endregion
        // #region Revoke Approvals
        this.router.post(`/approval/modVersion/:modVersionIdParam/revoke`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Revoke a modVersion's verification.'
            // #swagger.description = 'Revoke a modVersion\'s verification status.\n\nThis will also revoke the verification status of any modVersions that depend on this modVersion.'
            // #swagger.parameters['modVersionIdParam'] = { description: 'The id of the modVersion to revoke.', type: 'integer', required: true }
            // #swagger.parameters['allowDependants'] = { description: 'Allow dependants to remain verified. This is dangerous.', type: 'boolean', required: true }
            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            if (!modVersionId.success) {
                return res.status(400).send({ message: `Invalid mod version id.` });
            }
            let session = await validateSession(req, res, UserRoles.Admin, DatabaseHelper.getGameNameFromModVersionId(modVersionId.data));
            if (!session.user) {
                return;
            }

            //get db objects
            //let status = Validator.zStatus.safeParse(req.body.status);
            let allowDependants = Validator.zBool.safeParse(req.body.allowDependants);

            let modVersion = await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersionId.data } });
            if (!modVersion) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            // i have to filter twice since in the database, the dependants are stored as a string.
            let dependants = (await DatabaseHelper.database.ModVersions.findAll({ where: { dependencies: { [Op.contains]: [modVersionId.data] } } })).filter((modVersion) => modVersion.dependencies.includes(modVersionId.data));
            
            // for each dependant, revoke their verification status
            let revokedIds:number[] = [];
            if (dependants.length > 0) {
                if (allowDependants.data == false) {
                    return res.status(400).send({ message: `Mod version has ${dependants.length} dependants. Set "allowDependants" to true to revoke this mod's approved status.` });
                }
                for (let dependant of dependants) {
                    let ids = await unverifyModVersionId(session.user.id, dependant.id, dependant);
                    revokedIds = [...revokedIds, ...ids];
                }
            } else {
                let ids = await unverifyModVersionId(session.user.id, modVersionId.data, modVersion);
                revokedIds = [...revokedIds, ...ids];
            }
            Logger.log(`ModVersion ${modVersionId.data} & its ${dependants.length} have been revoked by ${session.user.username}. This totals to ${revokedIds.length} revoked modVersions.`);
            console.log(`Revoked IDs:`, revokedIds);
            DatabaseHelper.refreshCache(`modVersions`);
            return res.status(200).send({ message: `Mod version revoked.`, revokedIds: revokedIds });
        });
        // #endregion
    }
}

async function unverifyModVersionId(approverId:number, modVersion: number, modObj?:ModVersion): Promise<number[]> {
    // get db object if it wasn't proiveded to us
    let modVersionDb = modObj || await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersion } });

    // if the modVersion doesn't exist or is already unverified, return no additional dependants
    if (!modVersionDb || modVersionDb.status !== Status.Verified) {
        return [];
    }

    // revoke the modVersion's verification
    let revokedIds = [modVersionDb.id];
    modVersionDb.lastApprovedById = approverId;
    modVersionDb.status = Status.Unverified;

    await modVersionDb.save().then(async () => {
        // for each dependant of a dependant, revoke their verification status
        for (let dependant of modVersionDb.dependencies) {
            let id = await unverifyModVersionId(approverId, dependant); // recursiveness
            revokedIds = [...revokedIds, ...id];
        }
    });
    // return the ids of all revoked modVersions
    return revokedIds;
}