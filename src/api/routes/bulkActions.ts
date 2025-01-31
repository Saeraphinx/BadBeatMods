import { Router } from 'express';
import { DatabaseHelper, EditQueue } from '../../shared/Database';
import { validateSession } from '../../shared/AuthHelper';
import { Validator } from '../../shared/Validator';
import { Op } from 'sequelize';
import { Logger } from '../../shared/Logger';

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
            #swagger.summary = 'Add a game version to multiple mod versions'
            #swagger.description = 'Add a game version to multiple mod versions. Submits edits if the mod is already approved, otherwise queues an edit for approval. Requires the user to be an approver.'
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
                                "modVersionIds": {
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
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

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

            let modVersionIds = Validator.zDBIDArray.safeParse(req.body.modVersionIds);
            if (!modVersionIds.success) {
                res.status(400).send({ message: `Invalid mod version IDs`});
                return;
            }

            if (await Validator.validateIDArray(modVersionIds.data, `modVersions`, false, false) == false) {
                res.status(404).send({ message: `One or more mod versions not found`});
                return;
            }

            let modVersions = await DatabaseHelper.database.ModVersions.findAll({ where: { id: modVersionIds.data } });

            let results = {
                editIds: [] as number[],
                errorIds: [] as number[],
                editPreformedIds: [] as number[],
            };

            for (let modVersion of modVersions) {
                let outObj = await modVersion.addGameVersionId(gameVersion.id, session.user.id);
                if (outObj) {
                    if (outObj instanceof EditQueue) {
                        results.editIds.push(outObj.id);
                    } else {
                        results.editPreformedIds.push(outObj.id);
                    }
                } else {
                    results.errorIds.push(modVersion.id);
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
            let session = await validateSession(req, res, true);
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

            let refreshMods = false;
            let refreshModVersions = false;
            for (let edit of edits) {
                try {
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

                    if (approve.data === true) {
                        await edit.approve(session.user).then(() => {
                            if (isMod) {
                                refreshMods = true;
                            } else {
                                refreshModVersions = true;
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

            if (refreshMods) {
                DatabaseHelper.refreshCache(`mods`);
            }

            if (refreshModVersions) {
                DatabaseHelper.refreshCache(`modVersions`);
            }

            DatabaseHelper.refreshCache(`editApprovalQueue`);

            res.status(200).send(results);
        });
    }
}