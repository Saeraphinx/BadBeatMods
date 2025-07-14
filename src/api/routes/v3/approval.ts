import { Router } from 'express';
import { DatabaseHelper, UserRoles, Status, Version, Project, EditQueue, ProjectAPIPublicResponseV3 } from '../../../shared/Database.ts';
import { validateAdditionalGamePermissions, validateSession } from '../../../shared/AuthHelper.ts';
import { Logger } from '../../../shared/Logger.ts';
import { SemVer } from 'semver';
import { Op } from 'sequelize';
import { Validator } from '../../../shared/Validator.ts';
import { Utils } from '../../../shared/Utils.ts';

export enum ApprovalAction {
    Accept = `accept`, // Verify/accept the project/version/edit, set its status to verified
    Deny = `deny`, // Reject the project/version, set its status to unverified, but do not remove it
    Remove = `remove`, // Remove the project/version from the database
    Restore = `restore`, // Restore the project/version if it was previously removed
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
            #swagger.summary = 'Get new projects & versions pending approval.'
            #swagger.description = 'Get a list of projects & versions pending their first approval.'
            #swagger.parameters['queueType'] = { description: 'The type of queue to get.', schema: { type: 'string', '@enum': ['projects', 'verisons', 'edits'] }, required: true }
            #swagger.parameters['gameName'] = { description: 'The name of the game to get new projects/versions for.', type: 'string', required: true }
            #swagger.responses[200] = { $ref: '#/components/responses/ApprovalQueueResponse' }
            #swagger.responses[204]
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[403]
            #swagger.responses[404]
            #swagger.responses[500]
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
            let queueType = Validator.z.enum([`projects`, `versions`, `edits`]).safeParse(req.params.queueType);
            if (!queueType.success) {
                return res.status(400).send({ message: `Invalid queue type.` });
            }

            let response: {
                projects: ProjectAPIPublicResponseV3[] | undefined,
                versions: {
                    project: ProjectAPIPublicResponseV3,
                    version: ReturnType<typeof Version.prototype.toRawAPIResponse>}[] | undefined,
                edits: {
                    project: ProjectAPIPublicResponseV3,
                    original: Project | Version
                    edit: EditQueue,
                }[] | undefined
            } = {
                projects: undefined,
                versions: undefined,
                edits: undefined
            };
            let statusQuery = includeUnverified.data ? [{ status: Status.Unverified }, { status: Status.Pending }] : [{ status: Status.Pending}];
            switch (queueType.data) {
                case `projects`:
                    //get projects and versions that are unverified (gameName filter on mods only)
                    response.projects = await Promise.all(
                        (await DatabaseHelper.database.Projects.findAll({ where: { [Op.or]: statusQuery, gameName: gameName.data } }))
                            .map(async (project) => await project.toAPIResponse(null))
                    );
                    break;
                case `versions`:
                    response.versions = (await Promise.all(
                        (await DatabaseHelper.database.Versions.findAll({ where: { [Op.or]: statusQuery } })).map(async (version) => {
                            let project = DatabaseHelper.mapCache.projects.get(version.projectId);
                            if (!project || project.gameName !== gameName.data) {
                                return null;
                            }
                            return { project: await project.toAPIResponse(null), version: version.toRawAPIResponse() };
                        })
                    )).filter((obj) => obj !== null);
                    break;
                case `edits`:
                    let editQueue = await DatabaseHelper.database.EditApprovalQueue.findAll({where: { approved: null }});
                    if (!editQueue) {
                        return res.status(204).send({ message: `No edits found.` });
                    }

                    // filter out edits that don't support the game specified
                    response.edits = (await Promise.all(editQueue.map(async (edit) => {
                        let isMod = edit.isProject();
                        if (isMod) {
                            let project = DatabaseHelper.mapCache.projects.get(edit.objectId);
                            if (!project || project.gameName !== gameName.data) {
                                return null;
                            }

                            return { project: await project.toAPIResponse(null), original: project, edit: edit };
                        } else {
                            let version = DatabaseHelper.mapCache.versions.get(edit.objectId);
                            if (!version) {
                                return null;
                            }
                            let project = DatabaseHelper.mapCache.projects.get(version.projectId);
                            
                            if (!project || project.gameName !== gameName.data) {
                                return null;
                            }
                            return { project: await project.toAPIResponse(null), original: version, edit: edit };
                        }
                    }))).filter((obj) => obj !== null);
                    break;
                        
            }

            if (response.projects?.length === 0 && response.versions?.length === 0 && response.edits?.length === 0) {
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
            #swagger.summary = 'Approve a project.'
            #swagger.description = 'Approve a project for public visibility.'
            #swagger.parameters['projectIdParam'] = { description: 'The id of the project to approve.', type: 'integer' }
            #swagger.requestBody = {
                $ref: '#/components/requestBodies/ApproveObjectBody'
            }
            #swagger.responses[200] = { $ref: '#/components/responses/ServerMessage' }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[403]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let reqBody = Validator.zApproveObject.safeParse({
                id: req.params.projectIdParam,
                action: req.body.action,
                reason: req.body.reason
            });
            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`), errors: reqBody.error.issues });
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: reqBody.data.id } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            let session = await validateSession(req, res, UserRoles.Approver, project.gameName);
            if (!session.user) {
                return;
            }

            if (project.status === Status.Removed && reqBody.data.action !== ApprovalAction.Restore) {
                return res.status(400).send({ message: `Project is removed. Please restore it first.` });
            }

            let promise: Promise<Project>;
            let status: Status;
            switch (reqBody.data.action) {
                case ApprovalAction.Accept:
                    status = Status.Verified;
                    promise = project.setStatus(status, session.user, reqBody.data.reason);
                    break;
                case ApprovalAction.Deny:
                    status = Status.Unverified;
                    promise = project.setStatus(status, session.user, reqBody.data.reason);
                    break;
                case ApprovalAction.Remove:
                    status = Status.Removed;
                    promise = project.setStatus(status, session.user, reqBody.data.reason);
                    break;
                case ApprovalAction.Restore:
                    if (await project.isRestorable() === false) {
                        return res.status(400).send({ message: `Project is not restorable.` });
                    }
                    status = Status.Pending;
                    promise = project.setStatus(status, session.user, reqBody.data.reason);
                    break;
                default:
                    return res.status(400).send({ message: `Invalid action.` });
            }

            promise.then(() => {
                Logger.log(`Project ${reqBody.data.id} set to status ${status} by ${session.user!.username}.`);
                DatabaseHelper.refreshCache(`projects`);
                // logs sent out in the setStatus method
                return res.status(200).send({ message: `Project ${status}.` });
            }).catch((error) => {
                Logger.error(`Error ${status} project: ${error}`);
                return res.status(500).send({ message: `Error ${status} project:  ${error}` });
            });
        });

        this.router.post(`/approval/version/:versionIdParam/approve`, async (req, res) => {
            /*
            #swagger.tags = ['Approval']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Approve a version.'
            #swagger.description = 'Approve a version for public visibility.'
            #swagger.parameters['versionIdParam'] = { description: 'The id of the version to approve.', type: 'integer' }
            #swagger.requestBody = { $ref: '#/components/requestBodies/ApproveObjectBody' }
            #swagger.responses[200] = { $ref: '#/components/responses/ServerMessage' }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[403]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let reqBody = Validator.zApproveObject.safeParse({
                id: req.params.versionIdParam,
                action: req.body.action,
                reason: req.body.reason
            });
            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`), errors: reqBody.error.issues });
            }
            let session = await validateSession(req, res, UserRoles.Approver, DatabaseHelper.getGameNameFromVersionId(reqBody.data.id));
            if (!session.user) {
                return;
            }

            // get db objects
            let version = await DatabaseHelper.database.Versions.findOne({ where: { id: reqBody.data.id } });
            if (!version) {
                return res.status(404).send({ message: `Version not found.` });
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: version.projectId } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            if (version.status === Status.Removed && reqBody.data.action !== ApprovalAction.Restore) {
                return res.status(400).send({ message: `Version is removed.` });
            }

            let promise: Promise<Version>;
            let status: Status;
            switch (reqBody.data.action) {
                case ApprovalAction.Accept:
                    status = Status.Verified;
                    promise = version.setStatus(status, session.user, reqBody.data.reason);
                    break;
                case ApprovalAction.Deny:
                    status = Status.Unverified;
                    promise = version.setStatus(status, session.user, reqBody.data.reason);
                    break;
                case ApprovalAction.Remove:
                    status = Status.Removed;
                    promise = version.setStatus(status, session.user, reqBody.data.reason);
                    break;
                case ApprovalAction.Restore:
                    if (await version.isRestorable() === false) {
                        return res.status(400).send({ message: `Version is not restorable.` });
                    }

                    if (project.status === Status.Removed) { // above checks if the project is restorable
                        project.setStatus(Status.Pending, session.user, reqBody.data.reason);
                    }

                    status = Status.Pending;
                    promise = version.setStatus(status, session.user, reqBody.data.reason);
                    break;
                default:
                    return res.status(400).send({ message: `Invalid action.` });
            }

            promise.then(() => {
                Logger.log(`Version ${version.id} set to status ${status} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`versions`);
                // logs sent out by the version.setStatus method
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
                description: 'The action to take on the edit.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                action: { type: 'string', enum: ['accept', 'deny'] }
                            },
                        }
                    }
                }
            }
            #swagger.responses[200] = { $ref: '#/components/responses/ServerMessage' }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[403]
            #swagger.responses[404]
            #swagger.responses[500]
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
            let modId = isMod ? edit.objectId : await DatabaseHelper.database.Versions.findOne({ where: { id: edit.objectId } }).then((version) => {
                if (!version) {
                    return null;
                } else {
                    return version.projectId;
                }
            });

            if (!modId) {
                return res.status(404).send({ message: `Project not found.` });
            }
            
            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: modId } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            // approve or deny edit
            if (action.data === ApprovalAction.Accept) {
                edit.approve(session.user).then((record) => {
                    Logger.log(`Edit ${editId.data} accepted by ${session.user.username}.`);
                    isMod ? DatabaseHelper.refreshCache(`projects`) : DatabaseHelper.refreshCache(`versions`);
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                    return res.status(200).send({ message: `Edit accepted.`, record: record });
                }).catch((error) => {
                    Logger.error(`Error approving edit ${editId.data}: ${error}`);
                    return res.status(500).send({ message: `Error approving edit:  ${error}` });
                });
            } else {
                edit.deny(session.user).then(() => {
                    Logger.log(`Edit ${editId.data} rejected by ${session.user.username}.`);
                    isMod ? DatabaseHelper.refreshCache(`projects`) : DatabaseHelper.refreshCache(`versions`);
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
            /*
            #swagger.tags = ['Approval']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Edit an edit in the approval queue.'
            #swagger.description = 'Edit an edit in the approval queue.'
            #swagger.parameters['editIdParam'] = { description: 'The id of the edit to edit.', type: 'integer', required: true }
            #swagger.requestBody = {
                required: true,
                description: 'The edit object to update.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                summary: { type: 'string' },
                                description: { type: 'string' },
                                gitUrl: { type: 'string' },
                                category: { type: 'string' },
                                authorIds: { type: 'array', items: { type: 'integer' } },
                                gameName: { type: 'string' },

                                modVersion: { type: 'string' },
                                supportedGameVersionIds: { type: 'array', items: { type: 'integer' } },
                                dependencies: { type: 'array', items: { type: 'object', properties: { parentId: { type: 'integer' }, sv: { type: 'string' } } } },
                                platform: { type: 'string' },
                            }
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                description: 'Edit updated.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                message: { type: 'string' },
                                edit: { $ref: '#/components/schemas/EditApprovalQueueDBObject' }
                            }
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[403]
            #swagger.responses[404]
            #swagger.responses[500]
            */
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

            let modId = edit.isProject() ? edit.objectId : await DatabaseHelper.database.Versions.findOne({ where: { id: edit.objectId } }).then((version) => {
                if (!version) {
                    return null;
                } else {
                    return version.projectId;
                }
            });

            if (!modId) {
                return res.status(404).send({ message: `Project ID not found.` });
            }
            
            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: modId } });

            if (!project) {
                return res.status(500).send({ message: `Project not found.` });
            }


            switch (edit.objectTableName) {
                case `mods`:
                    if (!edit.isProject()) {
                        Logger.error(`Edit ${editId.data} is not a project edit, despite the table name being "mods".`);
                        return res.status(500).send({ message: `Invalid edit.` });
                    }

                    // parameter validation for projects
                    let reqBodym = Validator.zUpdateProject.safeParse(req.body);
                    if (!reqBodym.success) {
                        return res.status(400).send({ message: Utils.parseErrorMessage(reqBodym.error, `Invalid parameters.`), errors: reqBodym.error.issues });
                    }
                    
                    if (!reqBodym.data || (!reqBodym.data.name && !reqBodym.data.summary && !reqBodym.data.description && !reqBodym.data.gitUrl && !reqBodym.data.category && !reqBodym.data.gameName && !reqBodym.data.authorIds)) {
                        return res.status(400).send({ message: `No changes provided.` });
                    }

                    if ((await Validator.validateIDArray(reqBodym.data.authorIds, `users`, false, true)) == false) {
                        return res.status(400).send({ message: `Invalid authorIds.` });
                    }

                    // if the gameName is being changed, check if the user has permission to approve mods the new game
                    if (reqBodym.data.gameName && reqBodym.data.gameName !== project.gameName && validateAdditionalGamePermissions(session, reqBodym.data.gameName, UserRoles.Approver) == false) {
                        return res.status(401).send({ message: `You cannot edit this project.` });
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
                    if (!edit.isVersion()) {
                        Logger.error(`Edit ${editId.data} is not a version edit, despite the table name being "modVersions".`);
                        return res.status(500).send({ message: `Invalid edit.` });
                    }
                    
                    // parameter validation for modVersions
                    let reqBodyv = Validator.zUpdateVersion.safeParse(req.body);
                    if (!reqBodyv.success) {
                        return res.status(400).send({ message: Utils.parseErrorMessage(reqBodyv.error, `Invalid parameters.`), errors: reqBodyv.error.issues });
                    }

                    // parameter validation & getting db object
                    if (!reqBodyv.data || (!reqBodyv.data.modVersion && !reqBodyv.data.supportedGameVersionIds && !reqBodyv.data.dependencies && !reqBodyv.data.platform)) {
                        return res.status(400).send({ message: `No changes provided.` });
                    }

                    if ((await Validator.validateIDArray(reqBodyv.data.supportedGameVersionIds, `gameVersions`, false, true)) == false) {
                        return res.status(400).send({ message: `Invalid gameVersionIds.` });
                    }

                    if ((await Validator.validateIDArray(reqBodyv.data.dependencies?.map(d => d.parentId), `projects`, true, true)) == false) {
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