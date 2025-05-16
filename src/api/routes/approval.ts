import { Router } from 'express';
import { DatabaseHelper, UserRoles, Status, Version, Project, EditQueue, ProjectAPIPublicResponse } from '../../shared/Database.ts';
import { validateAdditionalGamePermissions, validateSession } from '../../shared/AuthHelper.ts';
import { Logger } from '../../shared/Logger.ts';
import { SemVer } from 'semver';
import { Op } from 'sequelize';
import { Validator } from '../../shared/Validator.ts';

export enum ApprovalAction {
    Accept = `accept`, // Verify/accept the mod/modVersion/edit, set its status to verified
    Deny = `deny`, // Reject the mod/modVersion, set its status to unverified, but do not remove it
    Remove = `remove`, // Remove the mod/modVersion from the database
    Restore = `restore`, // Restore the mod/modVersion if it was previously removed
}

export class ApprovalRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        // #region Get Approvals
        this.router.get(`/approval/:queueType`, async (req, res) => {
            /*
            #swagger.tags = ['Approval']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Get new mods & modVersions pending approval.'
            #swagger.description = 'Get a list of mods & modVersions pending their first approval.'
            #swagger.parameters['queueType'] = { description: 'The type of queue to get.', schema: { type: 'string', '@enum': ['mods', 'modVersions', 'edits'] }, required: true }
            #swagger.parameters['gameName'] = { description: 'The name of the game to get new mods for.', type: 'string', required: true }
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
            #swagger.responses[204] = { description: 'No mods found.' }
            #swagger.responses[400] = { description: 'Missing game name.' }
            #swagger.responses[401] = { description: 'Unauthorized.' }
            */
            let gameName = Validator.zGameName.safeParse(req.query.gameName);
            let includeUnverified = Validator.z.boolean({coerce: true}).safeParse(req.query.includeUnverified === `true`);
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
                mods: ProjectAPIPublicResponse[] | undefined,
                modVersions: {
                    mod: ProjectAPIPublicResponse,
                    version: ReturnType<typeof Version.prototype.toRawAPIResponse>}[] | undefined,
                edits: {
                    mod: ProjectAPIPublicResponse,
                    original: Project | Version
                    edit: EditQueue,
                }[] | undefined
            } = {
                mods: undefined,
                modVersions: undefined,
                edits: undefined
            };
            let statusQuery = includeUnverified.data ? [{ status: Status.Unverified }, { status: Status.Pending }] : [{ status: Status.Pending}];
            switch (queueType.data) {
                case `mods`:
                    //get mods and modVersions that are unverified (gameName filter on mods only)
                    response.mods = (await DatabaseHelper.database.Projects.findAll({ where: { [Op.or]: statusQuery, gameName: gameName.data } })).map((mod) => mod.toAPIResponse());
                    break;
                case `modVersions`:
                    response.modVersions = (await DatabaseHelper.database.Versions.findAll({ where: { [Op.or]: statusQuery } })).map((modVersion) => {
                        let mod = DatabaseHelper.mapCache.projects.get(modVersion.projectId);
                        if (!mod || mod.gameName !== gameName.data) {
                            return null;
                        }
                        return { mod: mod.toAPIResponse(), version: modVersion.toRawAPIResponse() };
                    }).filter((obj) => obj !== null);
                    break;
                case `edits`:
                    let editQueue = await DatabaseHelper.database.EditApprovalQueue.findAll({where: { approved: null }});
                    if (!editQueue) {
                        return res.status(204).send({ message: `No edits found.` });
                    }

                    // filter out edits that don't support the game specified
                    response.edits = editQueue.map((edit) => {
                        let isMod = edit.objectTableName === `mods`;
                        if (isMod) {
                            let mod = DatabaseHelper.mapCache.projects.get(edit.objectId);
                            if (!mod || mod.gameName !== gameName.data) {
                                return null;
                            }

                            return { mod: mod.toAPIResponse(), original: mod, edit: edit };
                        } else {
                            let modVersion = DatabaseHelper.mapCache.versions.get(edit.objectId);
                            if (!modVersion) {
                                return null;
                            }
                            let mod = DatabaseHelper.mapCache.projects.get(modVersion.projectId);
                            
                            if (!mod || mod.gameName !== gameName.data) {
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
        // #endregion
        // #region Accept/Reject Approvals

        this.router.post(`/approval/project/:projectIdParam/approve`, async (req, res) => {
            /*
            #swagger.tags = ['Approval']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Approve a mod.'
            #swagger.description = 'Approve a mod for public visibility.'
            #swagger.parameters['modIdParam'] = { description: 'The id of the mod to approve.', type: 'integer' }
            #swagger.requestBody = {
                    required: true,
                    description: 'The status to set the mod to.',
                    schema: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                description: 'The status to set the mod to.',
                            },
                            reason: {
                                type: 'string',
                                description: 'The reason for the status change.',
                            }
                        }
                    }
                }
            
            #swagger.responses[200] = { description: 'Mod status updated.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[400] = { description: 'Missing status.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[401] = { description: 'Unauthorized.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[404] = { description: 'Mod not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[500] = { description: 'Error approving mod.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            */
            let projectId = Validator.zDBID.safeParse(req.params.projectIdParam);
            let action = Validator.z.nativeEnum(ApprovalAction).safeParse(req.body.action);
            let reason = Validator.z.string().optional().safeParse(req.body.reason);
            if (!projectId.success || !action.success || !reason.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let mod = await DatabaseHelper.database.Projects.findOne({ where: { id: projectId.data } });
            if (!mod) {
                return res.status(404).send({ message: `Project not found.` });
            }

            let session = await validateSession(req, res, UserRoles.Approver, mod.gameName);
            if (!session.user) {
                return;
            }

            if (mod.status === Status.Removed && action.data !== ApprovalAction.Restore) {
                return res.status(400).send({ message: `Project is removed. Please restore it first.` });
            }

            let promise: Promise<Project>;
            let status: Status;
            switch (action.data) {
                case ApprovalAction.Accept:
                    status = Status.Verified;
                    promise = mod.setStatus(status, session.user, reason.data);
                    break;
                case ApprovalAction.Deny:
                    status = Status.Unverified;
                    promise = mod.setStatus(status, session.user, reason.data);
                    break;
                case ApprovalAction.Remove:
                    status = Status.Removed;
                    promise = mod.setStatus(status, session.user, reason.data);
                    break;
                case ApprovalAction.Restore:
                    if (await mod.isRestorable() === false) {
                        return res.status(400).send({ message: `Project is not restorable.` });
                    }
                    status = Status.Pending;
                    promise = mod.setStatus(status, session.user, reason.data);
                    break;
                default:
                    return res.status(400).send({ message: `Invalid action.` });
            }

            promise.then(() => {
                Logger.log(`Project ${projectId.data} set to status ${status} by ${session.user!.username}.`);
                DatabaseHelper.refreshCache(`mods`);
                // logs sent out in the setStatus method
                return res.status(200).send({ message: `Project ${status}.` });
            }).catch((error) => {
                Logger.error(`Error ${status} project: ${error}`);
                return res.status(500).send({ message: `Error ${status} project:  ${error}` });
            });
        });

        this.router.post(`/approval/version/:modVersionIdParam/approve`, async (req, res) => {
            /*
            #swagger.tags = ['Approval']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Approve a modVersion.'
            #swagger.description = 'Approve a modVersion for public visibility.'
            #swagger.parameters['modVersionIdParam'] = { description: 'The id of the modVersion to approve.', type: 'integer' }
            #swagger.requestBody = {
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
            #swagger.responses[200] = { description: 'ModVersion status updated.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[400] = { description: 'Missing status.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[401] = { description: 'Unauthorized.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[404] = { description: 'ModVersion not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            #swagger.responses[500] = { description: 'Error approving modVersion.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerMessage' } } } }
            */
            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            let action = Validator.z.nativeEnum(ApprovalAction).safeParse(req.body.action);
            let reason = Validator.z.string().optional().safeParse(req.body.reason);
            if (!modVersionId.success || !action.success || !reason.success) {
                return res.status(400).send({ message: `Invalid Version ID or Status.` });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromModVersionId(modVersionId.data));
            if (!session.user) {
                return;
            }

            // get db objects
            let modVersion = await DatabaseHelper.database.Versions.findOne({ where: { id: modVersionId.data } });
            if (!modVersion) {
                return res.status(404).send({ message: `Version not found.` });
            }

            let mod = await DatabaseHelper.database.Projects.findOne({ where: { id: modVersion.projectId } });
            if (!mod) {
                return res.status(404).send({ message: `Project not found.` });
            }

            if (modVersion.status === Status.Removed && action.data !== ApprovalAction.Restore) {
                return res.status(400).send({ message: `Version is removed.` });
            }

            let promise: Promise<Version>;
            let status: Status;
            switch (action.data) {
                case ApprovalAction.Accept:
                    status = Status.Verified;
                    promise = modVersion.setStatus(status, session.user, reason.data);
                    break;
                case ApprovalAction.Deny:
                    status = Status.Unverified;
                    promise = modVersion.setStatus(status, session.user, reason.data);
                    break;
                case ApprovalAction.Remove:
                    status = Status.Removed;
                    promise = modVersion.setStatus(status, session.user, reason.data);
                    break;
                case ApprovalAction.Restore:
                    if (await modVersion.isRestorable() === false) {
                        return res.status(400).send({ message: `Version is not restorable.` });
                    }

                    if (mod.status === Status.Removed) { // above checks if the mod is restorable
                        mod.setStatus(Status.Pending, session.user, reason.data);
                    }

                    status = Status.Pending;
                    promise = modVersion.setStatus(status, session.user, reason.data);
                    break;
                default:
                    return res.status(400).send({ message: `Invalid action.` });
            }

            promise.then(() => {
                Logger.log(`Version ${modVersion.id} set to status ${status} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`modVersions`);
                // logs sent out by the modVersion.setStatus method
                return res.status(200).send({ message: `Version ${status}.` });
            }).catch((error) => {
                Logger.error(`Error ${status} version: ${error}`);
                return res.status(500).send({ message: `Error ${status} version:  ${error}` });
            });
        });

        this.router.post(`/approval/edit/:editIdParam/approve`, async (req, res) => {
            /*
            #swagger.tags = ['Approval']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Approve an edit.'
            #swagger.description = 'Approve an edit for public visibility.'
            #swagger.parameters['editIdParam'] = { description: 'The id of the edit to approve.', type: 'integer' }
            #swagger.requestBody = {
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
            #swagger.responses[200] = { description: 'Edit status updated.' }
            #swagger.responses[400] = { description: 'Missing status.' }
            #swagger.responses[401] = { description: 'Unauthorized.' }
            #swagger.responses[404] = { description: 'Edit not found.' }
            #swagger.responses[500] = { description: 'Error approving edit.' }
            */
            let editId = Validator.zDBID.safeParse(req.params.editIdParam);
            let action = Validator.z.nativeEnum(ApprovalAction).safeParse(req.body.action);
            if (!editId.success || !action.success) {
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
            let modId = isMod ? edit.objectId : await DatabaseHelper.database.Versions.findOne({ where: { id: edit.objectId } }).then((modVersion) => {
                if (!modVersion) {
                    return null;
                } else {
                    return modVersion.projectId;
                }
            });

            if (!modId) {
                return res.status(404).send({ message: `Project not found.` });
            }
            
            let mod = await DatabaseHelper.database.Projects.findOne({ where: { id: modId } });
            if (!mod) {
                return res.status(404).send({ message: `Project not found.` });
            }

            // approve or deny edit
            if (action.data === ApprovalAction.Accept) {
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
        this.router.patch(`/approval/edit/:editIdParam`, async (req, res) => {
            // #swagger.tags = ['Approval']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
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

            let modId = edit.isMod() ? edit.objectId : await DatabaseHelper.database.Versions.findOne({ where: { id: edit.objectId } }).then((modVersion) => {
                if (!modVersion) {
                    return null;
                } else {
                    return modVersion.projectId;
                }
            });

            if (!modId) {
                return res.status(404).send({ message: `Project ID not found.` });
            }
            
            let mod = await DatabaseHelper.database.Projects.findOne({ where: { id: modId } });

            if (!mod) {
                return res.status(500).send({ message: `Project not found.` });
            }


            switch (edit.objectTableName) {
                case `mods`:
                    if (!edit.isMod()) {
                        Logger.error(`Edit ${editId.data} is not a project edit, despite the table name being "mods".`);
                        return res.status(500).send({ message: `Invalid edit.` });
                    }

                    // parameter validation for mods
                    let reqBodym = Validator.zUpdateProject.safeParse(req.body);
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
                        Logger.error(`Edit ${editId.data} is not a version edit, despite the table name being "modVersions".`);
                        return res.status(500).send({ message: `Invalid edit.` });
                    }
                    
                    // parameter validation for modVersions
                    let reqBodyv = Validator.zUpdateVersion.safeParse(req.body);
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

                    if ((await Validator.validateIDArray(reqBodyv.data.dependencies?.map(d => d.parentId), `mods`, true, true)) == false) {
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
    }
}