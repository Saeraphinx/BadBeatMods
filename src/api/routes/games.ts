import { Router } from 'express';
import { DatabaseHelper, GameVersion, UserRoles } from '../../shared/Database.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Logger } from '../../shared/Logger.ts';
import { Validator } from '../../shared/Validator.ts';
import { coerce } from 'semver';
import { Utils } from '../../shared/Utils.ts';

export class VersionsRoutes {
    private router: Router;

    constructor(app: Router) {
        this.router = app;
        this.loadRoutes();
    }

    private async loadRoutes() {
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
            #swagger.parameters['gameName'] = {
                description: 'The name of the game to get versions for.',
                type: 'string',
                required: true
            }
            #swagger.responses[200] = {
                description: 'Returns the game versions for the specified game.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/GameAPIPublicResponse'
                        }
                    }
                }
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

        this.router.post(`/games/:gameName/version`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Add a version to a game.'
            #swagger.description = 'Adds a new version to the specified game.'
            #swagger.parameters['gameName'] = {
                description: 'The name of the game to add a version to.',
                type: 'string',
                required: true
            }
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
                description: 'Version added successfully.',
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/components/schemas/GameAPIPublicResponse'
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
                return res.status(200).send(version);
            }).catch((error) => {
                Logger.error(`Error creating version: ${error}`);
                return res.status(500).send({ message: `Error creating version: ${error}` });
            });
        });
            
        this.router.post(`/games/:gameName/category`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Add a category to a game.'
            #swagger.description = 'Adds a new category to the specified game. The `Core`, `Essentials`, and `Other` categories cannot be added, removed, or have their position changed.'
            #swagger.parameters['$ref'] = ['#/components/requestBodies/gameName']
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

        this.router.put(`/games/:gameName/category`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Remove a category from a game.'
            #swagger.description = 'Removes a category from the specified game. The `Core`, `Essentials`, and `Other` categories cannot be removed or have their position changed.'
            #swagger.parameters['$ref'] = ['#/components/requestBodies/gameName']
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

        this.router.delete(`/games/:gameName/category`, async (req, res) => {
            /*
            #swagger.tags = ['Games']
            #swagger.summary = 'Remove a category from a game.'
            #swagger.description = 'Removes a category from the specified game. The `Core`, `Essentials`, and `Other` categories cannot be added, removed, or have their position changed.'
            #swagger.parameters['$ref'] = ['#/components/requestBodies/gameName']
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


        });

        //#region Deprecated routes, kept since they still work.
        this.router.get(`/versions`, async (req, res) => {
            // #swagger.tags = ['Versions']
            // #swagger.deprecated = true
            let gameName = Validator.zGameName.safeParse(req.query.gameName).data;
            
            let versions;
            if (gameName) {
                versions = DatabaseHelper.cache.gameVersions.filter(v => v.gameName === gameName);
            } else {
                versions = DatabaseHelper.cache.gameVersions;
            }

            versions.sort((a, b) => {
                let verA = coerce(a.version, { loose: true });
                let verB = coerce(b.version, { loose: true });
                if (verA && verB) {
                    return verB.compare(verA); // this is reversed so that the latest version is first in the array
                } else {
                    return b.version.localeCompare(a.version);
                }
            });

            return res.status(200).send({versions});
        });

        this.router.post(`/versions`, async (req, res) => {
            // #swagger.tags = ['Versions']
            // #swagger.deprecated = true
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            /* #swagger.requestBody = {
                description: 'The gameName and version to create',
                required: true,
                type: 'object',
                schema: {
                    "gameName": "BeatSaber",
                    "version": "1.0.0"
                }
            }
            */
            let reqBody = Validator.zCreateGameVersion.safeParse(req.body);
            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }
        
            let session = await validateSession(req, res, UserRoles.GameManager, reqBody.data.gameName);
            if (!session.user) {
                return;
            }
        
            let versions = await DatabaseHelper.database.GameVersions.findAll({ where: { version: reqBody.data.version, gameName: reqBody.data.gameName } });
            if (versions.length > 0) {
                return res.status(409).send({ message: `Version already exists.` });
            }
        
            DatabaseHelper.database.GameVersions.create({
                gameName: reqBody.data.gameName,
                version: reqBody.data.version,
                defaultVersion: false,
            }).then((version) => {
                Logger.log(`Version ${version.gameName} ${version.version} added by ${session.user.username}.`);
                DatabaseHelper.refreshCache(`gameVersions`);
                return res.status(200).send({version});
            }).catch((error) => {
                Logger.error(`Error creating version: ${error}`);
                return res.status(500).send({ message: `Error creating version: ${error}` });
            });
        });

        this.router.get(`/versions/default`, async (req, res) => {
            // #swagger.tags = ['Versions']
            // #swagger.deprecated = true
            let gameName = Validator.zGameName.default(`BeatSaber`).safeParse(req.query.gameName);
            if (!gameName.success) {
                return res.status(400).send({ message: `Invalid gameName` });
            }
            
            let defaultVersion = await GameVersion.getDefaultVersionObject(gameName.data);

            return res.status(200).send({defaultVersion});
        });

        this.router.post(`/versions/default`, async (req, res) => {
            // #swagger.tags = ['Versions']
            // #swagger.deprecated = true
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            /* #swagger.requestBody = {
                description: 'The ID of the version to set as default',
                required: true,
                type: 'object',
                schema: {
                    gameVersionId: 1
                }
            }
            */
            let gameVersionId = Validator.zDBID.safeParse(req.body.gameVersionId);
            if (!gameVersionId.success) {
                return res.status(400).send({ message: `Invalid gameVersionId` });
            }

            let gameVersion = await DatabaseHelper.database.GameVersions.findOne({ where: { id: gameVersionId.data } });
            if (!gameVersion) {
                return res.status(404).send({ message: `GameVersion not found` });
            }

            let session = validateSession(req, res, UserRoles.GameManager, gameVersion.gameName);
            if (!session) {
                return;
            }

            let previousDefault = await GameVersion.getDefaultVersionObject(gameVersion.gameName);

            if (previousDefault) {
                if (previousDefault.id === gameVersion.id) {
                    return res.status(400).send({ message: `Version is already default` });
                }
    
                if (previousDefault.gameName !== gameVersion.gameName) {
                    return res.status(400).send({ message: `Version is for a different game` });
                }

                previousDefault.defaultVersion = false;
                await previousDefault.save();
            }
            gameVersion.defaultVersion = true;
            await gameVersion.save();
            DatabaseHelper.refreshCache(`gameVersions`);
            return res.status(200).send({ message: `Default version set`, gameVersion, previousDefault });
        });
        //#endregion
    }
}