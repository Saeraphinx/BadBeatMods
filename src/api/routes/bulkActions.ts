import { Router } from 'express';
import { DatabaseHelper, EditQueue, ModVersion, Status, UserRoles } from '../../shared/Database.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Validator } from '../../shared/Validator.ts';
import { Op } from 'sequelize';
import { Logger } from '../../shared/Logger.ts';
import { compare } from 'semver';

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
                let outObj = await modVersion.addGameVersionId(gameVersion.id, session.user).catch((err) => {
                    Logger.error(`Error adding game version ${gameVersion.id} to mod version ${modVersion.id}: ${err}`);
                    //results.errorIds.push(modVersion.id);
                    return null;
                });
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

        this.router.post(`/ba/linkVersionsExclude`, async (req, res) => {
            /*
            #swagger.tags = ['Bulk Actions']
            #swagger.summary = ''
            #swagger.description = 'Submits edits if the mod is already approved, otherwise queues an edit for approval. Requires the user to be an approver.'
            #swagger.requestBody = {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                "gameVersionIdFrom": { type: "number" },
                                "gameVersionIdTo": { type: "number" },
                                "modVersionIdsToExclude": {
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
            let excludedModVersionIds = Validator.zDBIDArray.safeParse(req.body.modVersionIdsToExclude);
            let gameVersionId1 = Validator.zDBID.safeParse(req.body.gameVersionIdFrom);
            let gameVersionId2 = Validator.zDBID.safeParse(req.body.gameVersionIdTo);
            if (!excludedModVersionIds.success || !gameVersionId1.success || !gameVersionId2.success) {
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

            if (await Validator.validateIDArray(excludedModVersionIds.data, `modVersions`, true, true) == false) {
                res.status(404).send({ message: `One or more mod versions not found`});
                return;
            }

            let modVersions = await DatabaseHelper.database.ModVersions.findAll();

            // find latest mod version that does not have gameVersion2 but has gameVersion1 & is not removed
            let modVersionsToProcess: ModVersion[] = [];
            for (let modVersion of modVersions) {
                if (excludedModVersionIds.data.includes(modVersion.id)) {
                    continue;
                }

                if (modVersion.supportedGameVersionIds.includes(gameVersionId2.data)) {
                    continue;
                }

                if (!modVersion.supportedGameVersionIds.includes(gameVersionId1.data)) {
                    continue;
                }

                // allow approved, unverified, and pending mod versions only
                if (modVersion.status !== Status.Verified && modVersion.status !== Status.Unverified && modVersion.status !== Status.Pending) {
                    continue;
                }

                // check to see if there is already an instacne of this mod in the process lsit, and remove it if this one is newer
                let existingModVersionToProcess = modVersionsToProcess.find((mv) => mv.modId === modVersion.modId);
                if (!existingModVersionToProcess || compare(modVersion.modVersion, existingModVersionToProcess.modVersion) === 1) {
                    modVersionsToProcess = modVersionsToProcess.filter((mv) => mv.id !== modVersion.id);
                }

                modVersionsToProcess.push(modVersion);
            }

            let results = {
                editIds: [] as number[],
                errorIds: [] as number[],
                editPreformedIds: [] as number[],
            };

            for (let toProcess of modVersionsToProcess) {
                let outObj = await toProcess.addGameVersionId(gameVersionId2.data, session.user).catch((err) => {
                    Logger.error(`Error adding game version ${gameVersionId2.data} to mod version ${toProcess.id}: ${err}`);
                    return null;
                });
                if (outObj) {
                    if (outObj instanceof EditQueue) {
                        results.editIds.push(outObj.id);
                    } else {
                        results.editPreformedIds.push(outObj.id);
                    }
                } else {
                    results.errorIds.push(toProcess.id);
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
                        results.errorIds.push(edit.id);
                        continue;
                    }
            
                    let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId } });
                    if (!mod) {
                        results.errorIds.push(edit.id);
                        continue;
                    }

                    if (!session.user.roles.perGame[mod.gameName]?.includes(UserRoles.Approver) && !session.user.roles.perGame[mod.gameName]?.includes(UserRoles.AllPermissions)) {
                        return res.status(403).send({ message: `You do not have permission to approve this edit.` });
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