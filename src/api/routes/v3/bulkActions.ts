import { Router } from 'express';
import { DatabaseHelper, EditQueue, Version, Status, UserRoles } from '../../../shared/Database.ts';
import { validateSession } from '../../../shared/AuthHelper.ts';
import { Validator } from '../../../shared/Validator.ts';
import { Op } from 'sequelize';
import { Logger } from '../../../shared/Logger.ts';

export class BulkActionsRoutes {
    private router: Router;
    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.post(`/ba/addGameVersion`, async (req, res) => {
            /*
            #swagger.tags = ['Bulk Actions']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Add a game version to multiple versions'
            #swagger.description = 'Add a game version to multiple versions. Submits edits if the version is already approved, otherwise queues an edit for approval. Requires the user to be an approver.'
            #swagger.requestBody = {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                "gameVersionId": {
                                    "type": "number",
                                },
                                "versionIds": {
                                    "type": "array",
                                    "items": {
                                        "type": "number"
                                    }
                                }
                            }
                        }
                    }
                }
            }
                    
            #swagger.responses[200] = {
                description: 'Success',
                schema: {
                    "editIds": [1, 2],
                    "errorIds": [3],
                    "editPreformedIds": [4]
                }
            }
            */
            let gameVersionId = Validator.zDBID.safeParse(req.body.gameVersionId);
            if (!gameVersionId.success) {
                res.status(400).send({ message: `Invalid game version ID`});
                return;
            }

            let gameVersion = await DatabaseHelper.database.GameVersions.findByPk(gameVersionId.data);
            if (!gameVersion) {
                res.status(404).send({ message: `Game version not found`});
                return;
            }

            let session = await validateSession(req, res, UserRoles.Approver, gameVersion.gameName);
            if (!session.user) {
                return;
            }

            let versionIds = Validator.zDBIDArray.safeParse(req.body.versionIds);
            if (!versionIds.success) {
                res.status(400).send({ message: `Invalid version IDs`});
                return;
            }

            if (await Validator.validateIDArray(versionIds.data, `versions`, false, false) == false) {
                res.status(404).send({ message: `One or more versions not found`});
                return;
            }

            let versions = await DatabaseHelper.database.Versions.findAll({ where: { id: versionIds.data } });

            let results = {
                editIds: [] as number[],
                errorIds: [] as number[],
                editPreformedIds: [] as number[],
            };

            for (let version of versions) {
                let outObj = await version.addGameVersionId(gameVersion.id, session.user).catch((err) => {
                    Logger.error(`Error adding game version ${gameVersion.id} to version ${version.id}: ${err}`);
                    //results.errorIds.push(version.id);
                    return null;
                });
                if (outObj) {
                    if (outObj instanceof EditQueue) {
                        results.editIds.push(outObj.id);
                    } else {
                        results.editPreformedIds.push(outObj.id);
                    }
                } else {
                    results.errorIds.push(version.id);
                }
            }

            DatabaseHelper.refreshCache(`editApprovalQueue`);
            res.status(200).send(results);
        });

        this.router.post(`/ba/linkVersionsExclude`, async (req, res) => {
            /*
            #swagger.tags = ['Bulk Actions']
            #swagger.summary = ''
            #swagger.description = 'Submits edits if the version is already approved, otherwise queues an edit for approval. Requires the user to be an approver.'
            #swagger.requestBody = {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                "gameVersionIdFrom": { type: "number" },
                                "gameVersionIdTo": { type: "number" },
                                "versionIdsToExclude": {
                                    "type": "array",
                                    "items": {
                                        "type": "number"
                                    }
                                }
                            }
                        }
                    }
                }
            }
                    
            #swagger.responses[200] = {
                description: 'Success',
                schema: {
                    "editIds": [1, 2],
                    "errorIds": [3],
                    "editPreformedIds": [4]
                }
            }
            */
            let versionIds = Validator.zDBIDArray.safeParse(req.body.versionIdsToExclude);
            let gameVersionId1 = Validator.zDBID.safeParse(req.body.gameVersionIdFrom);
            let gameVersionId2 = Validator.zDBID.safeParse(req.body.gameVersionIdTo);
            if (!versionIds.success || !gameVersionId1.success || !gameVersionId2.success) {
                res.status(400).send({ message: `Invalid parameters.`});
                return;
            }

            let gameVersion1 = DatabaseHelper.cache.gameVersions.find((gv) => gv.id === gameVersionId1.data);
            let gameVersion2 = DatabaseHelper.cache.gameVersions.find((gv) => gv.id === gameVersionId2.data);
            if (!gameVersion1 || !gameVersion2) {
                res.status(404).send({ message: `Game versions not found.`});
                return;
            }

            if (gameVersion1.id === gameVersion2.id) {
                res.status(400).send({ message: `Game versions cannot be the same.`});
                return;
            }

            if (gameVersion1.gameName !== gameVersion2.gameName) {
                res.status(400).send({ message: `Game versions must be for the same game.`});
                return;
            }

            let session = await validateSession(req, res, UserRoles.Approver, gameVersion1.gameName);
            if (!session.user) {
                return;
            }

            if (await Validator.validateIDArray(versionIds.data, `versions`, true, true) == false) {
                res.status(404).send({ message: `One or more versions not found`});
                return;
            }

            let pidsToIgnore: number[] = []; // versions that are in the exclude list
            let allVersions = await DatabaseHelper.database.Versions.findAll();
            allVersions = allVersions.filter((v) => {
                if (versionIds.data.includes(v.id)) {
                    pidsToIgnore.push(v.projectId); // do not process these project  ids further on down the line
                    return false;
                }
                return v.supportedGameVersionIds.includes(gameVersion1.id) && (v.status == Status.Verified || v.status == Status.Unverified || v.status == Status.Pending);
            });

            let versionsFiltered:{pid:number, version:Version}[] = [];
            for (let version of allVersions) {
                if (pidsToIgnore.includes(version.projectId)) {
                    continue; // skip projects that are in the exclude list
                }
                let existing = versionsFiltered.find((v) => v.pid === version.projectId && v.version.status === version.status);
                if (existing) {
                    if (version.modVersion.compare(existing.version.modVersion) == 1) {
                        versionsFiltered = versionsFiltered.filter((mv) => mv.pid !== version.projectId && mv.version.status === version.status);
                        versionsFiltered.push({pid: version.projectId, version: version});
                    }
                } else {
                    versionsFiltered.push({pid: version.projectId, version: version});
                }
            }

            versionsFiltered.sort((a, b) => a.pid - b.pid);

            let results = {
                editIds: [] as number[],
                errorIds: [] as number[],
                editPreformedIds: [] as number[],
            };

            for (let version of versionsFiltered) {
                let outObj = await version.version.addGameVersionId(gameVersion2.id, session.user).catch((err) => {
                    Logger.error(`Error adding game version ${gameVersion2.id} to version ${version.version.id}: ${err}`);
                    //results.errorIds.push(version.modVersion.id);
                    return null;
                });
                if (outObj) {
                    if (outObj instanceof EditQueue) {
                        results.editIds.push(outObj.id);
                    } else {
                        results.editPreformedIds.push(outObj.id);
                    }
                } else {
                    results.errorIds.push(version.version.id);
                }
            }

            DatabaseHelper.refreshCache(`editApprovalQueue`);
            res.status(200).send(results);
        });

        this.router.post(`/ba/approveEdits`, async (req, res) => {
            /*
            #swagger.tags = ['Bulk Actions']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Approve multiple edit requests'
            #swagger.description = 'Approve multiple edit requests. Requires the user to be an approver.'
            #swagger.requestBody = {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                "approve": {
                                    "type": "boolean",
                                    "default": true
                                },
                                "editIds": {
                                    "type": "array",
                                    "items": {
                                        "type": "number"
                                    }
                                }
                            }
                        }
                    }
                }
            }
                    
            #swagger.responses[200] = {
                description: 'Success',
                schema: {
                    "successIds": [1, 2],
                    "errorIds": [3]
                }
            }
            */
            let session = await validateSession(req, res, UserRoles.Approver, true); // todo: make this per game
            if (!session.user) {
                return;
            }

            let editIds = Validator.zDBIDArray.safeParse(req.body.editIds);
            let approve = Validator.zBool.default(true).safeParse(req.body.approve);
            if (!editIds.success) {
                res.status(400).send({ message: `Invalid edit IDs`, error: editIds.error });
                return;
            }

            if (!approve.success) {
                res.status(400).send({ message: `Invalid approve value`, error: approve.error });
                return;
            }

            if (await Validator.validateIDArray(editIds.data, `editQueue`, false, false) == false) {
                res.status(404).send({ message: `One or more edits not found`});
                return;
            }

            let edits = await DatabaseHelper.database.EditApprovalQueue.findAll({ where: { id: editIds.data, approved: { [Op.eq]: null } } });

            if (edits.length == 0 || edits.length != editIds.data.length) {
                res.status(404).send({ message: `One or more edits are already approved or not found` });
                return;
            }

            let results = {
                successIds: [] as number[],
                errorIds: [] as number[],
            };

            let refreshProjects = false;
            let refreshVersions = false;
            for (let edit of edits) {
                try {
                    let isMod = `name` in edit.object;
                    let modId = isMod ? edit.objectId : await DatabaseHelper.database.Versions.findOne({ where: { id: edit.objectId } }).then((version) => {
                        if (!version) {
                            return null;
                        } else {
                            return version.projectId;
                        }
                    });

                    if (!modId) {
                        results.errorIds.push(edit.id);
                        continue;
                    }
            
                    let project = await DatabaseHelper.database.Projects.findOne({ where: { id: modId } });
                    if (!project) {
                        results.errorIds.push(edit.id);
                        continue;
                    }

                    if (!session.user.roles.perGame[project.gameName]?.includes(UserRoles.Approver) && !session.user.roles.perGame[project.gameName]?.includes(UserRoles.AllPermissions)) {
                        return res.status(403).send({ message: `You do not have permission to approve this edit.` });
                    }

                    if (approve.data === true) {
                        await edit.approve(session.user).then(() => {
                            if (isMod) {
                                refreshProjects = true;
                            } else {
                                refreshVersions = true;
                            }
                            Logger.log(`Edit ${edit.id} accepted by ${session.user.username}.`);
                        });
                    } else {
                        await edit.deny(session.user).then(() => {
                            Logger.log(`Edit ${edit.id} rejected by ${session.user.username}.`);
                        });
                    }
                    results.successIds.push(edit.id);
                } catch (e) {
                    Logger.error(`Error approving edit ${edit.id}: ${e}`);
                    results.errorIds.push(edit.id);
                }
            }

            if (refreshProjects) {
                DatabaseHelper.refreshCache(`projects`);
            }

            if (refreshVersions) {
                DatabaseHelper.refreshCache(`versions`);
            }

            DatabaseHelper.refreshCache(`editApprovalQueue`);

            res.status(200).send(results);
        });
    }
}