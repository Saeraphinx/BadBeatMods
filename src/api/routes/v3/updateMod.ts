import { Router } from 'express';
import { DatabaseHelper, Status } from '../../../shared/Database.ts';
import { validateSession } from '../../../shared/AuthHelper.ts';
import { Logger } from '../../../shared/Logger.ts';
import { Validator } from '../../../shared/Validator.ts';
import { SemVer } from 'semver';
import path from 'node:path';
import { Config } from '../../../shared/Config.ts';
import { Utils } from '../../../shared/Utils.ts';

export class UpdateProjectRoutesV3 {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    // Routes with optional parameters will return a 400 if the parameter is present but invalid
    private async loadRoutes() {
        // #region Update Project
        this.router.patch(`/projects/:projectIdParam`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.description = `Edit a project.`
            #swagger.parameters['projectIdParam'] = { description: 'Project ID', type: 'integer' }
            #swagger.requestBody = {
                description: 'Project data',
                required: true,
                schema: {
                    $ref: '#/components/schemas/zUpdateProject'
                }
            }
            #swagger.responses[200] = {
                description: 'Project updated successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/ProjectEditResponse'
                        }
                    }
                }
            }
            #swagger.responses[202] = {
                description: 'Project edit submitted for approval.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/EditApprovalQueueResponse'
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let projectId = Validator.zDBID.safeParse(req.params.projectIdParam);
            let reqBody = Validator.zUpdateProject.safeParse(req.body);
            if (!projectId.success) {
                return res.status(400).send({ message: `Invalid modId.` });
            }
            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`), errors: reqBody.error.issues });
            }
            
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            if ((!reqBody.data.name && !reqBody.data.summary && !reqBody.data.description && !reqBody.data.category && !reqBody.data.authorIds && !reqBody.data.gitUrl && !reqBody.data.gameName)) {
                return res.status(400).send({ message: `No changes provided.` });
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: projectId.data } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            let isGameChange = reqBody.data.gameName && reqBody.data.gameName !== project.gameName;
            if (project.isAllowedToEdit(session.user, isGameChange || false) == false) {
                return res.status(401).send({ message: `You cannot edit this project.` });
            }

            // validate authorIds
            if (reqBody.data.authorIds) {
                if ((await Validator.validateIDArray(reqBody.data.authorIds, `users`, true)) == false) {
                    return res.status(400).send({ message: `Invalid authorIds.` });
                }
            }

            project.edit({
                name: reqBody.data.name,
                summary: reqBody.data.summary,
                description: reqBody.data.description,
                gameName: reqBody.data.gameName,
                gitUrl: reqBody.data.gitUrl,
                authorIds: reqBody.data.authorIds,
                category: reqBody.data.category,
            }, session.user).then(async (project) => {
                if (project.isEditObj) {
                    if (project.newEdit) {
                        res.status(202).send({ message: `Edit ${project.edit.id} (for ${project.edit.objectId}) submitted by ${session.user.id} for approval.`, edit: project.edit });
                    } else {
                        res.status(202).send({ message: `Edit ${project.edit.id} (for ${project.edit.objectId}) updated by ${session.user.id}.`, edit: project.edit });
                    }
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                    return;
                } else {
                    res.status(200).send({ message: `Project updated.`, project: await project.project.toAPIResponse(`v3`, null) });
                    DatabaseHelper.refreshCache(`projects`);
                }
            }).catch((error) => {
                let errorMessage = Utils.parseErrorMessage(error);
                res.status(500).send({ message: `Error updating project: ${errorMessage}` });
            });
        });

        this.router.post(`/projects/:projectIdParam/icon`, async (req, res) => {
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.tags = ['Mods']
            #swagger.summary = 'Update a project icon.'
            #swagger.description = 'Update a project icon. (Note: This endpoint does not work on the API documentation page.)'
            #swagger.parameters['icon'] = {
                in: 'formData',
                type: 'file',
                description: 'Project icon.',
                required: true
            }
            #swagger.parameters['projectIdParam'] = { description: 'Project ID.', type: 'number' }
            #swagger.responses[200] = {
                description: 'Icon updated successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/ProjectEditResponse'
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[404]
            #swagger.responses[413]
            #swagger.responses[500]
            */
            let projectId = Validator.zDBID.safeParse(req.params.projectIdParam);
            if (!projectId.success) {
                return res.status(400).send({ message: `Invalid project ID.` });
            }
            let gameName = DatabaseHelper.getGameNameFromProjectId(projectId.data);
            if (!gameName) {
                return res.status(400).send({ message: `Invalid project ID.` });
            }
            let session = await validateSession(req, res, true, gameName);
            if (!session.user) {
                return;
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: projectId.data } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
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
            let oldFileName = project.iconFileName;
            project.iconFileName = `${icon.md5}${path.extname(icon.name)}`;
            project.save().then((project) => {
                icon.mv(filePath, (error) => {
                    if (error) {
                        Logger.error(`Error moving icon: ${error}`);
                        project.iconFileName = oldFileName;
                        project.save();
                        return res.status(500).send({ message: `Error moving icon.` });
                    }
                    res.status(200).send({ message: `Icon updated.`, project: project.toAPIResponse(`v3`, null) });
                });
            });
        });
        // #endregion Update Project

        // #region Update Version
        this.router.patch(`/version/:versionIdParam`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.description = `Update a version.`
            #swagger.parameters['versionIdParam'] = { description: 'Version ID', type: 'integer' }
            #swagger.requestBody = {
                description: 'Version data',
                required: true,
                schema: {
                    $ref: '#/components/schemas/zUpdateVersion'
                }
            }
            #swagger.responses[200] = {
                description: 'Version updated successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/VersionEditResponse'
                        }
                    }
                }
            }
            #swagger.responses[202] = {
                description: 'Version edit submitted for approval.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/EditApprovalQueueResponse'
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let versionId = Validator.zDBID.safeParse(req.params.versionIdParam);
            let reqBody = Validator.zUpdateVersion.safeParse(req.body);

            if (!versionId.success) {
                return res.status(400).send({ message: `Invalid versionIdParam.` });
            }
            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`), errors: reqBody.error.issues });
            }

            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            if (!reqBody.data || (!reqBody.data.supportedGameVersionIds && !reqBody.data.modVersion && !reqBody.data.dependencies && !reqBody.data.platform)) {
                return res.status(400).send({ message: `No changes provided.` });
            }

            let version = await DatabaseHelper.database.Versions.findOne({ where: { id: versionId.data } });
            if (!version) {
                return res.status(404).send({ message: `Version not found.` });
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: version.projectId } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            if (await version.isAllowedToEdit(session.user, project) == false) {
                return res.status(401).send({ message: `You cannot edit this project.` });
            }

            if (reqBody.data.dependencies) {
                if ((await Validator.validateIDArray(reqBody.data.dependencies.map(d => d.parentId), `projects`, true)) == false) {
                    return res.status(400).send({ message: `Invalid dependencies.` });
                }
            }

            if (reqBody.data.supportedGameVersionIds) {
                if ((await Validator.validateIDArray(reqBody.data.supportedGameVersionIds, `gameVersions`, true)) == false) {
                    return res.status(400).send({ message: `Invalid gameVersionIds.` });
                }
            }

            version.edit({
                supportedGameVersionIds: reqBody.data.supportedGameVersionIds,
                modVersion: reqBody.data.modVersion ? new SemVer(reqBody.data.modVersion) : undefined,
                dependencies: reqBody.data.dependencies,
                platform: reqBody.data.platform,
            }, session.user).then((version) => {
                if (version.isEditObj) {
                    if (version.newEdit) {
                        res.status(202).send({ message: `Edit ${version.edit.id} (for ${version.edit.objectId}) submitted by ${session.user.id} for approval.`, edit: version.edit });
                    } else {
                        res.status(202).send({ message: `Edit ${version.edit.id} (for ${version.edit.objectId}) updated by ${session.user.id}.`, edit: version.edit });
                    }
                    DatabaseHelper.refreshCache(`editApprovalQueue`);
                    return;
                } else {
                    res.status(200).send({ message: `Version updated.`, version: version.version.toRawAPIResponse() });
                    DatabaseHelper.refreshCache(`versions`);
                }
            }).catch((error) => {
                let errorMessage = Utils.parseErrorMessage(error);
                res.status(500).send({ message: `Error updating version: ${errorMessage}` });
            });
        });
        // #endregion Update Version
        // #region Submit to Approval
        this.router.post(`/projects/:projectIdParam/submit`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.description = `Submit a project for approval.`
            #swagger.parameters['projectIdParam'] = { description: 'Project ID', type: 'integer' }
            #swagger.responses[200] = {
                description: 'Project submitted successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/ProjectEditResponse'
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let projectId = Validator.zDBID.safeParse(req.params.projectIdParam);
            if (!projectId.success) {
                return res.status(400).send({ message: `Invalid modId.` });
            }
            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: projectId.data } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            if (!project.authorIds.includes(session.user.id)) {
                return res.status(401).send({ message: `You cannot submit this project.` });
            }

            if (project.status !== Status.Private) {
                return res.status(400).send({ message: `Project is already submitted.` });
            }

            project.setStatus(Status.Pending, session.user, `Project submitted for verification by ${session.user.username}`).then((project) => {
                res.status(200).send({ message: `Project submitted.`, project: project });
                DatabaseHelper.refreshCache(`projects`);
            }).catch((error) => {
                let message = `Error submitting project.`;
                if (Array.isArray(error?.errors) && error?.errors?.length > 0) {
                    message = error.errors.map((e: any) => e.message).join(`, `);
                }
                res.status(500).send({ message: `Error submitting project: ${error} ${message} ${error?.name}` });
            });
        });

        this.router.post(`/versions/:versionIdParam/submit`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.description = `Submit a version for approval.`
            #swagger.parameters['versionIdParam'] = { description: 'Version ID', type: 'integer' }
            #swagger.responses[200] = {
                description: 'Version submitted successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/VersionEditResponse'
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let versionId = Validator.zDBID.safeParse(req.params.versionIdParam);
            let version = await DatabaseHelper.database.Versions.findOne({ where: { id: versionId.data } });
            if (!version) {
                return res.status(404).send({ message: `Version not found.` });
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: version.projectId } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            if (!project.authorIds.includes(session.user.id)) {
                return res.status(401).send({ message: `You cannot submit this version.` });
            }

            if (version.status !== Status.Private) {
                return res.status(400).send({ message: `Version is already submitted.` });
            }

            version.setStatus(Status.Pending, session.user, `Version submitted for approval by ${session.user.username}`).then((version) => {
                res.status(200).send({ message: `Version submitted.`, version: version });
                DatabaseHelper.refreshCache(`versions`);
            }).catch((error) => {
                res.status(500).send({ message: `Error submitting version: ${error}` });
            });
            
        });
        // #endregion Submit
        // #region Edits
        this.router.get(`/edits`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.description = `Get all edits.`
            #swagger.responses[200] = {
                description: 'Edits found successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                message: { type: 'string' },
                                edits: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/EditApprovalQueueResponse' }
                                }
                            }
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[404]
            #swagger.responses[500]
            */
            
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let usersMods = await DatabaseHelper.cache.projects.filter((project) => {
                return project.authorIds.includes(session.user.id);
            });

            let edits = DatabaseHelper.cache.editApprovalQueue.filter((edit) => {
                if (edit.isProject()) {
                    return edit.submitterId == session.user.id || usersMods.some((project) => edit.objectId == project.id);
                } else {
                    let version = DatabaseHelper.mapCache.versions.get(edit.objectId);
                    if (!version) {
                        return false;
                    }
                    return edit.submitterId == session.user.id || usersMods.some((project) => project.id == version.projectId);
                }
            });

            res.status(200).send({ message: `Found ${edits.length} edits.`, edits: edits });
        });

        this.router.get(`/edits/:editIdParam`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.description = `Get an edit.`
            #swagger.parameters['editIdParam'] = { description: 'Edit ID', type: 'integer' }
            #swagger.responses[200] = {
                description: 'Edit found successfully.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                message: { type: 'string' },
                                edit: { $ref: '#/components/schemas/EditApprovalQueueResponse' }
                            }
                        }
                    }
                }
            }
            */
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

            let parentObj = edit.isProject() ? DatabaseHelper.mapCache.projects.get(edit.objectId) : DatabaseHelper.mapCache.versions.get(edit.objectId);
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

            let parentObj = edit.isProject() ? DatabaseHelper.mapCache.projects.get(edit.objectId) : DatabaseHelper.mapCache.versions.get(edit.objectId);
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