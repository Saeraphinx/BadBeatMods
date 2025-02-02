import { Router } from 'express';
import { DatabaseHelper, UserRoles, Status, ModVersion, Mod, EditQueue, ModAPIPublicResponse } from '../../shared/Database';
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
        this.router.get(`/approval/:queueType`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Get new mods & modVersions pending approval.'
            // #swagger.description = 'Get a list of mods & modVersions pending their first approval.'
            // #swagger.parameters['queueType'] = { description: 'The type of queue to get.', schema: { type: 'string', '@enum': ['mods', 'modVersions', 'edits'] }, required: true }
            // #swagger.parameters['gameName'] = { description: 'The name of the game to get new mods for.', type: 'string', required: true }
            /*
            #swagger.responses[200] = {
                description: 'List of mods pending first approval. The response will contain the mods, modVersions, and edits that are pending approval. Note that mods, modVersions, and edits will only be returned depending on the queueType specified. The edit objects `original` property will contain the original mod or modVersion object.',
                schema: {
                    mods: [
                        {
                            '$ref': '#/components/schemas/ModAPIPublicResponse'
                        }
                    ],
                    modVersions: [{
                        mod: {
                            '$ref': '#/components/schemas/ModAPIPublicResponse'
                        },
                        modVersion: {
                            '$ref': '#/components/schemas/ModVersionDBObject'
                        }
                    }],
                    edits: [{
                        mod: {
                            '$ref': '#/components/schemas/ModAPIPublicResponse'
                        },
                        original: {
                            '$ref': '#/components/schemas/ModVersionDBObject'
                        },
                        edit:{
                            '$ref': '#/components/schemas/EditApprovalQueueDBObject'
                        }
                    }]
                }
            }
            */
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
            let queueType = Validator.z.enum([`mods`, `modVersions`, `edits`]).safeParse(req.params.queueType);
            if (!queueType.success) {
                return res.status(400).send({ message: `Invalid queue type.` });
            }

            let response: {
                mods: ModAPIPublicResponse[] | undefined,
                modVersions: {
                    mod: ModAPIPublicResponse,
                    version: ReturnType<typeof ModVersion.prototype.toRawAPIResonse>}[] | undefined,
                edits: {
                    mod: ModAPIPublicResponse,
                    original: Mod | ModVersion
                    edit: EditQueue,
                }[] | undefined
            } = {
                mods: undefined,
                modVersions: undefined,
                edits: undefined
            };
            switch (queueType.data) {
                case `mods`:
                    //get mods and modVersions that are unverified (gameName filter on mods only)
                    response.mods = (await DatabaseHelper.database.Mods.findAll({ where: { status: `unverified`, gameName: gameName.data } })).map((mod) => mod.toAPIResponse());
                    break;
                case `modVersions`:
                    response.modVersions = (await DatabaseHelper.database.ModVersions.findAll({ where: { status: `unverified` } })).map((modVersion) => {
                        let mod = DatabaseHelper.cache.mods.find((mod) => mod.id === modVersion.modId);
                        if (!mod || mod.gameName !== gameName.data) {
                            return null;
                        }
                        return { mod: mod.toAPIResponse(), version: modVersion.toRawAPIResonse() };
                    }).filter((obj) => obj !== null);
                    break;
                case `edits`:
                    let editQueue = await DatabaseHelper.database.EditApprovalQueue.findAll({where: { approved: null }});
                    if (!editQueue) {
                        return res.status(204).send({ message: `No edits found.` });
                    }

                    // filter out edits that don't support the game specified
                    response.edits = editQueue.filter((edit) => {
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
                    }).map((edit) => {
                        let isMod = edit.objectTableName === `mods`;
                        if (isMod) {
                            let mod = DatabaseHelper.cache.mods.find((mod) => mod.id === edit.objectId);
                            if (!mod) {
                                return null;
                            }
                            return { mod: mod.toAPIResponse(), original: mod, edit: edit };
                        } else {
                            let modVersion = DatabaseHelper.cache.modVersions.find((modVersion) => modVersion.id === edit.objectId);
                            if (!modVersion) {
                                return null;
                            }
                            let mod = DatabaseHelper.cache.mods.find((mod) => mod.id === modVersion.modId);
                            if (!mod) {
                                return null;
                            }
                            return { mod: mod.toAPIResponse(), original: modVersion, edit: edit };
                        }
                    }).filter((obj) => obj !== null);
                    break;
                        
            }

            if (response.mods?.length === 0 && response.modVersions?.length === 0 && response.edits?.length === 0) {
                return res.status(204).send({ message: `No ${queueType.data} found.` });
            }
            res.status(200).send(response);
        });

        /*this.router.get(`/approval/edits`, async (req, res) => {
            // #swagger.tags = ['Approval']
            //
            // #swagger.summary = 'Get edits pending approval.'
            // #swagger.description = 'Get a list of already existing mod & modVersions that are pending approval.'
            // #swagger.parameters['gameName'] = { description: 'The name of the game to get edits for.', type: 'string' }
            // #swagger.responses[200] = { description: 'List of edits pending approval', schema: { edits: [{$ref: '#/components/schemas/EditApprovalQueueDBObject'}] } }
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

            res.status(200).send({ edits: editQueue });
        });*/
        // #endregion
        // #region Accept/Reject Approvals
        this.router.post(`/approval/mod/:modIdParam/approve`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Approve a mod.'
            // #swagger.description = 'Approve a mod for public visibility.'
            // #swagger.parameters['modIdParam'] = { description: 'The id of the mod to approve.', type: 'integer' }
            /* #swagger.requestBody = {
                    required: true,
                    description: 'The status to set the mod to.',
                    schema: {
                        type: 'object',
                        properties: {
                            status: {
                                type: 'string',
                                description: 'The status to set the mod to.',
                                example: 'verified'
                            }
                        }
                    }
                }
            */
            // #swagger.responses[200] = { description: 'Mod status updated.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[400] = { description: 'Missing status.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[401] = { description: 'Unauthorized.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[404] = { description: 'Mod not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[500] = { description: 'Error approving mod.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
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

            if (mod.status !== Status.Unverified) {
                return res.status(400).send({ message: `Mod is not in unverified status.` });
            }

            if (status.data === Status.Unverified) {
                return res.status(400).send({ message: `Invalid status.` });
            }

            mod.setStatus(status.data, session.user).then(() => {
                Logger.log(`Mod ${modId.data} set to status ${status.data} by ${session.user!.username}.`);
                DatabaseHelper.refreshCache(`mods`);
                return res.status(200).send({ message: `Mod ${status.data}.` });
            }).catch((error) => {
                Logger.error(`Error ${status.data} mod: ${error}`);
                return res.status(500).send({ message: `Error ${status.data} mod:  ${error}` });
            });
        });

        this.router.post(`/approval/modversion/:modVersionIdParam/approve`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Approve a modVersion.'
            // #swagger.description = 'Approve a modVersion for public visibility.'
            // #swagger.parameters['modVersionIdParam'] = { description: 'The id of the modVersion to approve.', type: 'integer' }
            /* #swagger.requestBody = {
                    required: true,
                    description: 'The status to set the modVersion to.',
                    schema: {
                        type: 'object',
                        properties: {
                            status: {
                                type: 'string',
                                description: 'The status to set the modVersion to.',
                                example: 'verified'
                            }
                        }
                    }
                }
            */
            // #swagger.responses[200] = { description: 'ModVersion status updated.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[400] = { description: 'Missing status.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[401] = { description: 'Unauthorized.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[404] = { description: 'ModVersion not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[500] = { description: 'Error approving modVersion.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
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

            if (modVersion.status !== Status.Unverified) {
                return res.status(400).send({ message: `Mod is not in unverified status.` });
            }

            if (status.data === Status.Unverified) {
                return res.status(400).send({ message: `Invalid status. Use /approval/modVersion/:modVersionIdParam/revoke instead` });
            }

            modVersion.setStatus(status.data, session.user).then(() => {
                Logger.log(`ModVersion ${modVersion.id} set to status ${status.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`modVersions`);
                return res.status(200).send({ message: `Mod ${status.data}.` });
            }).catch((error) => {
                Logger.error(`Error ${status.data} mod: ${error}`);
                return res.status(500).send({ message: `Error ${status.data} mod:  ${error}` });
            });
        });

        this.router.post(`/approval/edit/:editIdParam/approve`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Approve an edit.'
            // #swagger.description = 'Approve an edit for public visibility.'
            // #swagger.parameters['editIdParam'] = { description: 'The id of the edit to approve.', type: 'integer' }
            /* #swagger.requestBody = {
                required: true,
                description: 'The accepted value.',
                schema: {
                    type: 'object',
                    properties: {
                        accepted: {
                            type: 'boolean',
                            description: 'Whether to accept the edit or not.'
                        }
                    },
                }
            }
            */
            // #swagger.responses[200] = { description: 'Edit status updated.' }
            // #swagger.responses[400] = { description: 'Missing status.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'Edit not found.' }
            // #swagger.responses[500] = { description: 'Error approving edit.' }
            let editId = Validator.zDBID.safeParse(req.params.editIdParam);
            let accepted = Validator.z.boolean().safeParse(req.body.accepted);
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

            if (edit.approved !== null) {
                return res.status(400).send({ message: `Edit already ${edit.approved ? `approved` : `denied`}. Please submit a new edit.` });
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
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                    return res.status(200).send({ message: `Edit accepted.`, record: record });
                }).catch((error) => {
                    Logger.error(`Error approving edit ${editId.data}: ${error}`);
                    return res.status(500).send({ message: `Error approving edit:  ${error}` });
                });
            } else {
                edit.deny(session.user).then(() => {
                    Logger.log(`Edit ${editId.data} rejected by ${session.user.username}.`);
                    isMod ? DatabaseHelper.refreshCache(`mods`) : DatabaseHelper.refreshCache(`modVersions`);
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
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
            // #swagger.deprecated = true
            /* #swagger.requestBody = {
                required: true,
                description: 'The mod object to update.',
                schema: {
                    name: 'string',
                    summary: 'string',
                    description: 'string',
                    gitUrl: 'string',
                    category: 'string',
                    gameName: 'string',
                    authorIds: [1, 2, 3],
                }
            } */
            // #swagger.responses[200] = { description: 'Mod updated.', schema: { mod: {} } }
            // #swagger.responses[400] = { description: 'No changes provided.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'Mod not found.' }
            // #swagger.responses[500] = { description: 'Error updating mod.' }
            return res.status(501).send({ message: `This endpoint is deprecated.` });
            /*
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
                Logger.log(`Mod ${modId.data} updated by ${session.user.username}.`);
                return res.status(200).send({ message: `Mod updated.`, mod: mod });
            }).catch((error) => {
                Logger.error(`Error updating mod ${modId.data}: ${error}`);
                return res.status(500).send({ message: `Error updating mod: ${error}` });
            });
            */
        });

        this.router.patch(`/approval/modversion/:modVersionIdParam`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Edit a modVersion in the approval queue.'
            // #swagger.description = 'Edit a modVersion in the approval queue.'
            // #swagger.parameters['modVersionIdParam'] = { description: 'The id of the modVersion to edit.', type: 'integer', required: true }
            // #swagger.deprecated = true
            /* #swagger.requestBody = {
                required: true,
                description: 'The modVersion object to update.',
                schema: {
                    modVersion: 'string',
                    supportedGameVersionIds: [1, 2, 3],
                    dependencies: [1, 2, 3],
                    platform: 'string',
                }
            } */
            // #swagger.responses[200] = { description: 'ModVersion updated.', schema: { modVersion: {} } }
            // #swagger.responses[400] = { description: 'No changes provided.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[404] = { description: 'ModVersion not found.' }
            // #swagger.responses[500] = { description: 'Error updating modVersion.' }
            return res.status(501).send({ message: `This endpoint is deprecated.` });
            /*
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
            let modVer = await DatabaseHelper.database.ModVersions.findOne({ where: { id: modVersionId.data, status: Status.Unverified } });
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
                Logger.log(`ModVersion ${modVersionId.data} updated by ${session.user.username}.`);
                return res.status(200).send({ message: `ModVersion updated.`, modVersion: modVer });
            }).catch((error) => {
                Logger.error(`Error updating modVersion ${modVersionId.data}: ${error}`);
                return res.status(500).send({ message: `Error updating modVersion: ${error}` });
            });
            */
        });

        this.router.patch(`/approval/edit/:editIdParam`, async (req, res) => {
            // #swagger.tags = ['Approval']
            // #swagger.summary = 'Edit an edit in the approval queue.'
            // #swagger.description = 'Edit an edit in the approval queue.'
            // #swagger.parameters['editIdParam'] = { description: 'The id of the edit to edit.', type: 'integer', required: true }
            /* #swagger.requestBody = {
                required: true,
                description: 'The edit object to update.',
                schema: {
                    name: 'string',
                    summary: 'string',
                    description: 'string',
                    gitUrl: 'string',
                    category: 'string',
                    gameName: 'string',
                    authorIds: [1, 2, 3],

                    supportedGameVersionIds: [1, 2, 3],
                    modVersion: 'string',
                    platform: 'string',
                    dependencies: [1, 2, 3],
                }
            } */
            /* #swagger.responses[200] = { description: 'Edit updated.', schema: {
                    message: 'Edit updated.',
                    edit: { '$ref': '#/components/schemas/EditApprovalQueueDBObject' }
                }
            }
            */
            // #swagger.responses[400] = { description: 'No changes provided.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[401] = { description: 'Unauthorized.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[404] = { description: 'Edit not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            // #swagger.responses[500] = { description: 'Error updating edit.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
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
                        Logger.error(`Edit ${editId.data} is not a mod edit, despite the table name being "mods".`);
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
                        fileSize: mod.fileSize || edit.object.fileSize
                    };
                    edit.save();
                    break;
                case `modVersions`:
                    if (!edit.isModVersion()) {
                        Logger.error(`Edit ${editId.data} is not a mod version edit, despite the table name being "modVersions".`);
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
                        fileSize: mod.fileSize || edit.object.fileSize
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
            // #swagger.responses[200] = { description: 'ModVersion revoked.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
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