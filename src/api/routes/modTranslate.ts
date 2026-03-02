import { Router } from "express";
import { validateSession } from "../../shared/AuthHelper.ts";
import { DatabaseHelper, UserRoles } from "../../shared/Database.ts";
import { ModTranslate } from "../../shared/database/models/ModTranslate.ts";
import { Validator } from "../../shared/Validator.ts";

export class ModTranslateRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/translates/all`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            const items = await DatabaseHelper.database.ModTranslates.findAll();
            return res.status(200).send(items.map(t => t.toAPIPublicResponse()));
        });
        this.router.get(`/translates/mod/:modId`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['modId'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }

            let modId = Validator.zDBID.safeParse(req.params.modId);
            if (!modId.success) {
                return res.status(400).send({message: `Invalid mod id`});
            }
            const items = await DatabaseHelper.database.ModTranslates.findAll({
                where: {
                    modId: modId.data
                }
            });
            return res.status(200).send(items.map(t => t.toAPIPublicResponse()));
        });
        this.router.get(`/translates/lang/:langCode`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['langCode'] = { in: 'path', description: 'The lang code.', type: 'string', required: true }
            let langCode = Validator.zLanguage.safeParse(req.params.langCode);
            if (!langCode.success) {
                return res.status(400).send({message: `Invalid lang code`});
            }
            const items = await DatabaseHelper.database.ModTranslates.findAll({
                where: {
                    langCode: langCode.data
                }
            });
            return res.status(200).send(items.map(t => t.toAPIPublicResponse()));
        });
        this.router.get(`/translates/modlang/:modId/:langCode`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['modId'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }
            // #swagger.parameters['langCode'] = { in: 'path', description: 'The lang code.', type: 'string', required: true }

            let modId = Validator.zDBID.safeParse(req.params.modId);
            let langCode = Validator.zLanguage.safeParse(req.params.langCode);
            if (!modId.success) {
                return res.status(400).send({message: `Invalid mod id`});
            }
            if (!langCode.success) {
                return res.status(400).send({message: `Invalid lang code`});
            }
            const items = await DatabaseHelper.database.ModTranslates.findAll({
                where: {
                    modId: modId.data,
                    langCode: langCode.data
                }
            });
            return res.status(200).send(items.map(t => t.toAPIPublicResponse()));
        });
        this.router.post(`/translates/suggest/:modId/:translateType/:langCode`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['modId'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }
            // #swagger.parameters['translateType'] = { in: 'path', description: 'The translate type.', type: 'string', required: true }
            // #swagger.parameters['langCode'] = { in: 'path', description: 'The lang code.', type: 'string', required: true }
            /* #swagger.requestBody = {
                    description: 'suggest content',
                    required: true,
                    schema: {
                        type: 'object',
                        properties: {
                            content: 'string',
                            forceUpdate: {
                                type: 'boolean',
                                description: 'False by default',
                                example: false,
                            },
                            coAuthor: {
                                type: 'boolean',
                                description: 'False by default. If true, append your account to the translate author list instead of reset the list.',
                                example: false
                            }
                        }
                  }
            }
            */

            let session = await validateSession(req, res);
            let body = Validator.zTranslateSuggest.safeParse(req.body);

            let userId = session.user?.id;
            if (!userId) {
                return res.status(400).send({ error: `Login required`});
            }

            if (!body.success) {
                return res.status(400).send({ error: `Invalid request body`});
            }

            let modId = Validator.zDBID.safeParse(req.params.modId);
            let translateType = Validator.zTranslateType.safeParse(req.params.translateType);
            let langCode = Validator.zLanguage.safeParse(req.params.langCode);

            if (!modId.success || !translateType.success || !langCode.success) {
                return res.status(400).send({ message: `Invalid parameters`, errors: modId.error?.issues || translateType.error?.issues || langCode.error?.issues});
            }

            let mod = DatabaseHelper.mapCache.mods.get(modId.data);

            if (mod == null) {
                return res.status(404).send({ message: `Mod not found` });
            }

            let dbItem = await DatabaseHelper.database.ModTranslates.findOne({
                where: {
                    modId: modId.data,
                    translateType: translateType.data,
                    langCode: langCode.data
                }
            });
            if (dbItem == null) {
                dbItem = DatabaseHelper.database.ModTranslates.build({
                    modId: modId.data,
                    translateType: translateType.data,
                    langCode: langCode.data,

                    translate: null,
                    translateRef: null,
                    suggest: null,
                    suggestRef: null,
                    translatorUserIds: [],
                    suggesterUserIds: [],
                });
            }

            let newRef = ModTranslate.toReferenceString(dbItem.getStr(mod));

            if (!(body.data.forceUpdate) && dbItem.suggest == body.data.content && dbItem.suggestRef == newRef) {
                return res.status(208).send({ message: `Already have same content` });
            }

            dbItem.suggest = body.data.content;
            dbItem.suggestRef = newRef;
            if (body.data.coAuthor) {
                if (dbItem.suggesterUserIds.indexOf(userId) == -1) {
                    dbItem.suggesterUserIds.push(userId);
                }
            } else {
                dbItem.suggesterUserIds = [userId];
            }
            try {
                await dbItem.save();
            } catch (e) {
                return res.status(400).send({ message: `Internal Error` });
            }
            return res.status(200).send({ message: `suggest updated` });
        });

        this.router.post(`/translates/accept/:modId/:translateType/:langCode`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['modId'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }
            // #swagger.parameters['translateType'] = { in: 'path', description: 'The translate type.', type: 'string', required: true }
            // #swagger.parameters['langCode'] = { in: 'path', description: 'The lang code.', type: 'string', required: true }
            let session = await validateSession(req, res, UserRoles.Translator);

            let userId = session.user?.id;
            if (!userId) {
                return res.status(400).send({ error: `User permission required`});
            }

            let modId = Validator.zDBID.safeParse(req.params.modId);
            let translateType = Validator.zTranslateType.safeParse(req.params.translateType);
            let langCode = Validator.zLanguage.safeParse(req.params.langCode);

            if (!modId.success || !translateType.success || !langCode.success) {
                return res.status(400).send({ message: `Invalid parameters`, errors: modId.error?.issues || translateType.error?.issues || langCode.error?.issues});
            }

            let mod = DatabaseHelper.mapCache.mods.get(modId.data);

            if (mod == null) {
                return res.status(404).send({ message: `Mod not found` });
            }

            let dbItem = await DatabaseHelper.database.ModTranslates.findOne({
                where: {
                    modId: modId.data,
                    translateType: translateType.data,
                    langCode: langCode.data
                }
            });
            if (dbItem == null) {
                return res.status(404).send({ message: `translate not found` });
            }

            dbItem.translate = dbItem.suggest;
            dbItem.translateRef = dbItem.suggestRef;
            dbItem.translatorUserIds = dbItem.suggesterUserIds;
            dbItem.translatorModifiedUserId = userId;
            try {
                await dbItem.save();
            } catch (e) {
                return res.status(400).send({ message: `Internal Error` });
            }

            DatabaseHelper.refreshCache(`modTranslates`);

            return res.status(200).send({ message: `translate updated`, value: dbItem.translate});
        });
        
        this.router.patch(`/translates/edit/author/:modId/:translateType/:langCode`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['modId'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }
            // #swagger.parameters['translateType'] = { in: 'path', description: 'The translate type.', type: 'string', required: true }
            // #swagger.parameters['langCode'] = { in: 'path', description: 'The lang code.', type: 'string', required: true }
            /* #swagger.requestBody = {
                    description: 'author list to override',
                    required: true,
                    schema: {
                        type: 'array',
                    }
            }
            */

            let session = await validateSession(req, res, UserRoles.Translator);
            let authors = Validator.zDBIDArray.safeParse(req.body);

            let userId = session.user?.id;
            if (!userId) {
                return res.status(400).send({ error: `User permission required`});
            }

            if (!authors.success) {
                return res.status(400).send({ error: `Invalid request body`});
            }

            let modId = Validator.zDBID.safeParse(req.params.modId);
            let translateType = Validator.zTranslateType.safeParse(req.params.translateType);
            let langCode = Validator.zLanguage.safeParse(req.params.langCode);

            if (!modId.success || !translateType.success || !langCode.success) {
                return res.status(400).send({ message: `Invalid parameters`, errors: modId.error?.issues || translateType.error?.issues || langCode.error?.issues});
            }

            let mod = DatabaseHelper.mapCache.mods.get(modId.data);

            if (mod == null) {
                return res.status(404).send({ message: `Mod not found` });
            }

            let dbItem = await DatabaseHelper.database.ModTranslates.findOne({
                where: {
                    modId: modId.data,
                    translateType: translateType.data,
                    langCode: langCode.data
                }
            });
            if (dbItem == null) {
                return res.status(404).send({ message: `translate not found` });
            }

            let authors_arr:number[] = [];

            if (authors.data.length > 100) {
                return res.status(403).send({ message: `too many users` });
            }

            for (let author of authors.data) {
                let user = await DatabaseHelper.database.Users.findByPk(author);
                if (!user) {
                    continue;
                }
                authors_arr.push(author);
            }
            dbItem.translatorUserIds = authors_arr;

            try {
                await dbItem.save();
            } catch (e) {
                return res.status(400).send({ message: `Internal Error` });
            }

            DatabaseHelper.refreshCache(`modTranslates`);
            
            return res.status(200).send({ message: `translate author updated`, value: dbItem.translatorUserIds});
        });

        this.router.delete(`/translates/delete/:modId/:translateType/:langCode`, async (req, res) => {
            // #swagger.tags = ['ModTranslate']
            // #swagger.parameters['modId'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }
            // #swagger.parameters['translateType'] = { in: 'path', description: 'The translate type.', type: 'string', required: true }
            // #swagger.parameters['langCode'] = { in: 'path', description: 'The lang code.', type: 'string', required: true }
            /* #swagger.requestBody = {
                    description: 'Delete a mod translate or a suggest',
                    required: true,
                    schema: {
                        type: 'object',
                        properties: {
                            deleteTranslate: {
                                type: 'boolean',
                                description: 'False by default.',
                                example: false,
                            },
                            deleteSuggest: {
                                type: 'boolean',
                                description: 'False by default.',
                                example: false
                            }
                        }
                  }
            }
            */

            let session = await validateSession(req, res, UserRoles.Translator);
            let body = Validator.zTranslateDelete.safeParse(req.body);

            let userId = session.user?.id;
            if (!userId) {
                return res.status(400).send({ error: `User permission required`});
            }

            if (!body.success) {
                return res.status(400).send({ error: `Invalid request body`});
            }

            let modId = Validator.zDBID.safeParse(req.params.modId);
            let translateType = Validator.zTranslateType.safeParse(req.params.translateType);
            let langCode = Validator.zLanguage.safeParse(req.params.langCode);

            if (!modId.success || !translateType.success || !langCode.success) {
                return res.status(400).send({ message: `Invalid parameters`, errors: modId.error?.issues || translateType.error?.issues || langCode.error?.issues});
            }

            let mod = DatabaseHelper.mapCache.mods.get(modId.data);

            if (mod == null) {
                return res.status(404).send({ message: `Mod not found` });
            }

            let dbItem = await DatabaseHelper.database.ModTranslates.findOne({
                where: {
                    modId: modId.data,
                    translateType: translateType.data,
                    langCode: langCode.data
                }
            });
            if (dbItem == null) {
                return res.status(404).send({ message: `translate not found` });
            }

            let needUpdateCache = false;

            if (body.data.deleteTranslate) {
                if (dbItem.translate != null) {
                    needUpdateCache = true;
                }
                dbItem.translate = null;
                dbItem.translateRef = null;
                dbItem.translatorUserIds = [];
                dbItem.translatorModifiedUserId = userId;
            }
            if (body.data.deleteSuggest) {
                dbItem.suggest = null;
                dbItem.suggestRef = null;
                dbItem.suggesterUserIds = [];
            }

            try {
                await dbItem.save();
            } catch (e) {
                return res.status(400).send({ message: `Internal Error` });
            }

            if (needUpdateCache) {
                DatabaseHelper.refreshCache(`modTranslates`);
            }

            return res.status(200).send({ message: `translate updated`, latestTranslate: dbItem.translate, latestSuggest: dbItem.suggest});
        });
    }
}