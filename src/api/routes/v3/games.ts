import { Router } from 'express';
import { DatabaseHelper, UserRoles } from '../../../shared/Database.ts';
import { validateSession } from '../../../shared/AuthHelper.ts';
import { Logger } from '../../../shared/Logger.ts';
import { Validator } from '../../../shared/Validator.ts';
import { Utils } from '../../../shared/Utils.ts';

export class VersionsRoutes {
    private router: Router;

    constructor(app: Router) {
        this.router = app;
        this.loadRoutes();
    }

    private async loadRoutes() {
        // #region Get Games
        this.router.get(`/games`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Get all games & their versions.'
            #swagger.description = 'Returns a list of all games and their versions.'
            #swagger.parameters['shouldShowVersions'] = {
                description: 'Whether to include versions in the response.',
                type: 'boolean',
                required: false,
                in: 'query',
                default: true
            }
            #swagger.responses[200] = {
                description: 'Returns a list of games with their versions.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/GameAPIPublicResponse'
                            }
                        }
                    }
                }
            }
            */
            let shouldShowVersions = req.query.shouldShowVersions === `true`;
            const games = DatabaseHelper.cache.games.map(game => game.toAPIResponse(shouldShowVersions));
            return res.status(200).send(games);
        });

        this.router.get(`/games/:gameName`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Get game by name.'
            #swagger.description = 'Returns a specific game and its versions by name.'
            #swagger.parameters['gameName'] = { $ref: '#/components/parameters/gameName' }
            }
            #swagger.responses[200] = {
                $ref: '#/components/responses/GameAPIPublicResponse'
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            if (!gameName.success) {
                return res.status(400).send({ message: `Invalid gameName` });
            }
            let game = DatabaseHelper.cache.games.find(g => g.name === gameName.data);
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            return res.status(200).send(game.toAPIResponse());
        });
        // #endregion

        this.router.post(`/games/:gameName/versions`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Add a version to a game.'
            #swagger.description = 'Adds a new version to the specified game.'
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.requestBody = {
                description: 'The version to add to the game.',
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                version: {
                                    type: 'string',
                                    description: 'The version to add.'
                                }
                            },
                            required: ['version']
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                description: 'Returns the created version.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/GameVersionAPIPublicResponse'
                        }
                    }
                }
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let version = Validator.z.string().safeParse(req.body.version);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!version.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(version.error, `Invalid version`) });
            }
            let session = await validateSession(req, res, UserRoles.GameManager, gameName.data);
            if (!session.user) {
                return;
            }
            
            let versions = await DatabaseHelper.database.GameVersions.findAll({ where: { version: version.data, gameName: gameName.data} });
            if (versions.length > 0) {
                return res.status(409).send({ message: `Version already exists.` });
            }
        
            DatabaseHelper.database.GameVersions.create({
                gameName: gameName.data,
                version: version.data,
                defaultVersion: false,
            }).then((version) => {
                Logger.log(`Version ${version.gameName} ${version.version} added by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`gameVersions`);
                return res.status(200).send(version.toAPIResponse(`v3`));
            }).catch((error) => {
                Logger.error(`Error creating version: ${Utils.parseErrorMessage(error)}`);
                return res.status(500).send({ message: `Error creating version: ${Utils.parseErrorMessage(error)}` });
            });
        });
        // #region Linking Versions
        this.router.post(`/games/:gameName/versions/link`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Link two versions together.'
            #swagger.description = 'Links two game versions together. This is used to indicate that two versions are identical and mods can be used interchangeably between them. Game versions that are linked together will cause any version to add the other version if it is not already in the supported game version array.'
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.requestBody = {
                description: 'The versions to link together.',
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                versionAId: { type: 'number', description: 'The ID of the first version.' },
                                versionBId: { type: 'number', description: 'The ID of the second version.' }
                            },
                            required: ['versionAId', 'versionBId']
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                description: 'Returns the linked versions.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                versionA: { $ref: '#/components/schemas/GameVersionAPIPublicResponse' },
                                versionB: { $ref: '#/components/schemas/GameVersionAPIPublicResponse' }
                            }
                        }
                    }
                }
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let linkVersions = Validator.z.object({
                versionAId: Validator.zDBID,
                versionBId: Validator.zDBID
            }).safeParse(req.body);

            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!linkVersions.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(linkVersions.error, `Invalid version IDs`) });
            }
            let session = await validateSession(req, res, UserRoles.Approver, gameName.data);
            if (!session.user) {
                return;
            }

            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            let versionA = await DatabaseHelper.database.GameVersions.findOne({ where: { id: linkVersions.data.versionAId, gameName: gameName.data } });
            let versionB = await DatabaseHelper.database.GameVersions.findOne({ where: { id: linkVersions.data.versionBId, gameName: gameName.data } });

            if (!versionA || !versionB) {
                return res.status(404).send({ message: `One or both versions not found` });
            }
            if (versionA.id === versionB.id) {
                return res.status(400).send({ message: `Cannot link a version to itself.` });
            }
            if (versionA.gameName !== gameName.data || versionB.gameName !== gameName.data) {
                return res.status(400).send({ message: `Cannot link versions from different games.` });
            }

            versionA.addLinkToGameVersion(versionB).then(() => {
                Logger.log(`Linked versions ${versionA.id} and ${versionB.id} for game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`gameVersions`);
                return res.status(200).send({
                    versionA: versionA.toAPIResponse(`v3`),
                    versionB: versionB.toAPIResponse(`v3`)
                });
            }).catch((error) => {
                Logger.error(`Error linking versions: ${Utils.parseErrorMessage(error)}`);
                return res.status(500).send({ message: `Error linking versions: ${Utils.parseErrorMessage(error)}` });
            });
        });

        this.router.post(`/games/:gameName/versions/unlink`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Unlink two versions.'
            #swagger.description = 'Unlinks two game versions that were previously linked together.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.requestBody = {
                description: 'The versions to unlink.',
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                versionAId: { type: 'number', description: 'The ID of the first version.' },
                                versionBId: { type: 'number', description: 'The ID of the second version.' }
                            },
                            required: ['versionAId', 'versionBId']
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                description: 'Returns the unlinked versions.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                versionA: { $ref: '#/components/schemas/GameVersionAPIPublicResponse' },
                                versionB: { $ref: '#/components/schemas/GameVersionAPIPublicResponse' }
                            }
                        }
                    }
                }
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let unlinkVersions = Validator.z.object({
                versionAId: Validator.zDBID,
                versionBId: Validator.zDBID
            }).safeParse(req.body);

            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!unlinkVersions.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(unlinkVersions.error, `Invalid version IDs`) });
            }

            let session = await validateSession(req, res, UserRoles.Approver, gameName.data);
            if (!session.user) {
                return;
            }

            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            let versionA = await DatabaseHelper.database.GameVersions.findOne({ where: { id: unlinkVersions.data.versionAId, gameName: gameName.data } });
            let versionB = await DatabaseHelper.database.GameVersions.findOne({ where: { id: unlinkVersions.data.versionBId, gameName: gameName.data } });
            if (!versionA || !versionB) {
                return res.status(404).send({ message: `One or both versions not found` });
            }

            if (versionA.id === versionB.id) {
                return res.status(400).send({ message: `Cannot unlink a version from itself.` });
            }
            versionA.removeLinkToGameVersion(versionB).then(() => {
                Logger.log(`Unlinked versions ${versionA.id} and ${versionB.id} for game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`gameVersions`);
                return res.status(200).send({
                    versionA: versionA.toAPIResponse(`v3`),
                    versionB: versionB.toAPIResponse(`v3`)
                });
            }).catch((error) => {
                Logger.error(`Error unlinking versions: ${Utils.parseErrorMessage(error)}`);
                return res.status(500).send({ message: `Error unlinking versions: ${Utils.parseErrorMessage(error)}` });
            });
        });
        // #endregion
        // #region get categories
        this.router.post(`/games/:gameName/categories`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Add a category to a game.'
            #swagger.description = 'Adds a new category to the specified game. The `Core`, `Essentials`, and `Other` categories cannot be added, removed, or have their position changed.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.requestBody = { $ref: '#/components/requestBodies/GameCategoryBody' }
            #swagger.responses[200] = { $ref: '#/components/responses/GameAPIPublicResponse' }
            #swagger.responses[400]
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let newCategory = Validator.zCategory.safeParse(req.body.category);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!newCategory.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(newCategory.error, `Invalid category`) });
            }
            let session = await validateSession(req, res, UserRoles.GameManager, gameName.data);
            if (!session.user) {
                return;
            }
            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            game.addCategory(newCategory.data).then((updatedGame) => {
                if (!updatedGame) {
                    return res.status(400).send({ message: `Category already exists` });
                }
                Logger.log(`Category ${newCategory.data} added to game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`games`);
                return res.status(200).send(updatedGame.toAPIResponse());
            }).catch((error) => {
                Logger.error(`Error adding category: ${error}`);
                return res.status(500).send({ message: `Error adding category: ${Utils.parseErrorMessage(error)}` });
            });
        });

        this.router.put(`/games/:gameName/categories`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Remove a category from a game.'
            #swagger.description = 'Removes a category from the specified game. The `Core`, `Essentials`, and `Other` categories cannot be removed or have their position changed.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.requestBody = {
                description: `The category to add or remove from the game.`,
                content: {
                    [`application/json`]: {
                        schema: {
                            type: `array`,
                            items: {
                                type: `string`,
                                description: `The category to add or remove from the game.`
                            }
                        }
                    }
                }
            }
            #swagger.responses[200] = { $ref: '#/components/responses/GameAPIPublicResponse' }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let categoriesToAdd = Validator.zCategory.array().safeParse(req.body.categories);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!categoriesToAdd.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(categoriesToAdd.error, `Invalid categories`) });
            }

            let session = await validateSession(req, res, UserRoles.GameManager, gameName.data);
            if (!session.user) {
                return;
            }

            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            let setCategories = categoriesToAdd.data.filter(async (category) => {
                if (category === `Core` || category === `Essentials` || category === `Other`) {
                    return false; // these categories are reserved and cannot be removed or have their order changed
                } else {
                    return true;
                }
            });

            game.setCategories(setCategories).then((updatedGame) => {
                if (!updatedGame) {
                    return res.status(400).send({ message: `Categories already exist, are invalid, or another error occurred.` });
                }

                Logger.log(`Categories ${setCategories.join(`, `)} set for game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`games`);
                return res.status(200).send(updatedGame.toAPIResponse());
            }).catch((error) => {
                Logger.error(`Error setting categories: ${error}`);
                return res.status(500).send({ message: `Error setting categories: ${Utils.parseErrorMessage(error)}` });
            });
        });

        this.router.delete(`/games/:gameName/categories`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Remove a category from a game.'
            #swagger.description = 'Removes a category from the specified game. The `Core`, `Essentials`, and `Other` categories cannot be added, removed, or have their position changed.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.requestBody = { $ref: '#/components/requestBodies/GameCategoryBody' }
            #swagger.responses[200] = { $ref: '#/components/responses/GameAPIPublicResponse' }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let categoryToRemove = Validator.zCategory.safeParse(req.body.category);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!categoryToRemove.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(categoryToRemove.error, `Invalid category`) });
            }

            let session = await validateSession(req, res, UserRoles.GameManager, gameName.data);
            if (!session.user) {
                return;
            }

            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            game.removeCategory(categoryToRemove.data).then((updatedGame) => {
                if (!updatedGame) {
                    return res.status(400).send({ message: `Category does not exist or another error occurred.` });
                }

                Logger.log(`Category ${categoryToRemove.data} removed from game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`games`);
                return res.status(200).send(updatedGame.toAPIResponse());
            }).catch((error) => {
                Logger.error(`Error removing category: ${Utils.parseErrorMessage(error)}`);
                return res.status(500).send({ message: `Error removing category: ${Utils.parseErrorMessage(error)}` });
            });
        });
        // #endregion
        // #region Webhooks
        this.router.get(`/games/:gameName/webhooks`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Get webhooks for a game.'
            #swagger.description = 'Returns a list of webhooks for the specified game.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.responses[200] = {
                $ref: '#/components/responses/GameWebhookConfigResponse'
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            }
            let session = await validateSession(req, res, UserRoles.Admin, gameName.data);
            if (!session.user) {
                return;
            }
            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            return res.status(200).send(game.getAPIWebhooks());
        });

        this.router.post(`/games/:gameName/webhooks`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Add a webhook to a game.'
            #swagger.description = 'Adds a new webhook to the specified game.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.requestBody = {
                description: 'The webhook to add to the game.',
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                url: { type: 'string', description: 'The URL of the webhook.' },
                                types: { type: 'array', items: { type: 'string' }, description: 'The types of events the webhook should listen to.' }
                            },
                            required: ['url', 'types']
                        }
                    }
                }
            }
            #swagger.responses[200] = {
                $ref: '#/components/responses/GameWebhookConfigResponse'
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let webhookConfig = Validator.z.object({
                url: Validator.z.string().url(),
                types: Validator.zWebhookLogTypes
            }).safeParse(req.body);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!webhookConfig.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(webhookConfig.error, `Invalid webhookConfig`) });
            }

            let session = await validateSession(req, res, UserRoles.Admin, gameName.data);
            if (!session.user) {
                return;
            }

            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            game.addWebhook({
                url: webhookConfig.data.url,
                types: webhookConfig.data.types
            }).then((g) => {
                Logger.log(`Webhook ${g.webhook.id} added to game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`games`);
                return res.status(200).send(game.getAPIWebhooks());
            }).catch((error) => {
                Logger.error(`Error adding webhook: ${error}`);
                return res.status(500).send({ message: `Error adding webhook: ${Utils.parseErrorMessage(error)}` });
            });
        });

        this.router.put(`/games/:gameName/webhooks/:id`, async (req, res) => {
            /**
            #swagger.tags = ['Games']
            #swagger.summary = 'Update the types setup for a webhook config.'
            #swagger.description = 'Updates the types setup for a webhook config.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.parameters['id'] = {
                description: 'The ID of the webhook config to update.',
                in: 'path',
                required: true,
                schema: {
                    type: 'string',
                }
            }
            #swagger.requestBody = {
                $ref: '#/components/requestBodies/WebhookTypeConfigBody'
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let webhookId = Validator.z.string().safeParse(req.params.id);
            let webhookTypes = Validator.zWebhookLogTypes.safeParse(req.body.types);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!webhookId.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(webhookId.error, `Invalid webhookId`) });
            } else if (!webhookTypes.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(webhookTypes.error, `Invalid webhook types`) });
            }

            let session = await validateSession(req, res, UserRoles.Admin, gameName.data);
            if (!session.user) {
                return;
            }

            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }

            let webhook = game.webhookConfig.find(w => w.id === webhookId.data);
            if (!webhook) {
                return res.status(404).send({ message: `Webhook not found` });
            }

            game.webhookConfig.splice(game.webhookConfig.indexOf(webhook), 1);
            webhook.types = webhookTypes.data;
            game.webhookConfig.push(webhook);
            game.save().then((g) => {
                Logger.log(`Webhook ${webhook.id} updated for game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`games`);
                return res.status(200).send(g.getAPIWebhooks());
            }).catch((error) => {
                Logger.error(`Error updating webhook: ${error}`);
                return res.status(500).send({ message: `Error updating webhook: ${Utils.parseErrorMessage(error)}` });
            });
        });

        this.router.delete(`/games/:gameName/webhooks/:id`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Remove a webhook from a game.'
            #swagger.description = 'Removes a webhook from the specified game.'
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.parameters['$ref'] = ['#/components/parameters/gameName']
            #swagger.parameters['id'] = {
                description: 'The ID of the webhook to remove.',
                in: 'path',
                required: true,
                schema: {
                    type: 'string',
                }
            }
            #swagger.responses[200] = {
                description: 'Returns the updated list of webhooks for the game.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: '#/components/responses/GameWebhookConfigResponse'
                            }
                        }
                    }
                }
            }
            */
            let gameName = Validator.zGameName.safeParse(req.params.gameName);
            let webhookId = Validator.z.string().safeParse(req.params.id);
            if (!gameName.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(gameName.error, `Invalid gameName`) });
            } else if (!webhookId.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(webhookId.error, `Invalid webhookId`) });
            }

            let session = await validateSession(req, res, UserRoles.Admin, gameName.data);
            if (!session.user) {
                return;
            }
            let game = await DatabaseHelper.database.Games.findOne({ where: { name: gameName.data } });
            if (!game) {
                return res.status(404).send({ message: `Game not found` });
            }
            game.removeWebhook(webhookId.data).then((updatedGame) => {
                Logger.log(`Webhook ${webhookId.data} removed from game ${gameName.data} by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`games`);
                return res.status(200).send(updatedGame.getAPIWebhooks());
            }).catch((error) => {
                Logger.error(`Error removing webhook: ${Utils.parseErrorMessage(error)}`);
                return res.status(500).send({ message: `Error removing webhook: ${Utils.parseErrorMessage(error)}` });
            });
        });
        // #endregion
    }
}