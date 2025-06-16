import { Router } from 'express';
import { DatabaseHelper, Status, ProjectAPIPublicResponse, GameVersion, VersionAPIPublicResponse } from '../../shared/Database.ts';
import { Validator } from '../../shared/Validator.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Logger } from '../../shared/Logger.ts';
import { SemVer, satisfies } from 'semver';
import { Utils } from '../../shared/Utils.ts';

export class GetModRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/projects`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.summary = 'Get all mods for a specified version.'
            #swagger.description = 'Get all mods.<br><br>If gameName is not provided, it will default to Beat Saber.<br>If gameVersion is not provided, it will default to whatever is set as the lastest version for the selected game.'
            #swagger.parameters['gameName'] = { description: 'The game name.', type: 'string' }
            #swagger.parameters['gameVersion'] = { description: 'The game version (ex. \'1.29.1\', \'1.40.0\'). This parameter is required if you want to make sure all dependencies refrenced are present in the response.', type: 'string' }
            #swagger.parameters['status'] = { description: 'The mod status. (ex. \'all\', \'verified\', \'unverified\', \'pending\')', type: 'string' }
            #swagger.parameters['platform'] = { description: 'The platform. (ex. \'pc\', \'oculus\')', type: 'string' }
            #swagger.responses[200] = {
                description: 'Returns the mods.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                mods: {
                                    type: 'array',
                                    items: {
                                        $ref: '#/components/schemas/ProjectAPIPublicResponse'
                                    }
                                },
                                total: {
                                    type: 'number',
                                    description: 'The total number of mods before checking dependencies.',
                                },
                                invalidCount: {
                                    type: 'number',
                                    description: 'The number of mods that were removed due to missing dependencies.',
                                },
                                invalidIds: {
                                    type: 'array',
                                    items: {
                                        type: 'number',
                                        description: 'The IDs of the versions that were removed due to missing dependencies.',
                                    },
                                },
                            },
                        }
                    }
                }
            }
            */
            let reqQuery = Validator.zGetMods.safeParse(req.query);
            if (!reqQuery.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqQuery.error, `Invalid parameters.`), errors: reqQuery.error.issues });
            }

            let gameVersion = reqQuery.data.gameVersion ? DatabaseHelper.cache.gameVersions.find((gameVersion) => gameVersion.version === reqQuery.data.gameVersion && gameVersion.gameName === reqQuery.data.gameName) : null;

            if (gameVersion === undefined) {
                return res.status(400).send({ message: `Invalid game version.` });
            }

            let statuses: Status[] = [Status.Verified];
            switch (reqQuery.data.status) {
                case `all`:
                    statuses = [Status.Verified, Status.Unverified, Status.Pending];
                    break;
                case Status.Pending:
                    statuses = [Status.Verified, Status.Pending];
                    break;
                case Status.Unverified:
                    statuses = [Status.Verified, Status.Unverified];
                    break;
                case Status.Verified:
                default:
                    statuses = [Status.Verified];
                    break;
            }
                
            let mods: ProjectAPIPublicResponse[] = [];
            let preLength = undefined;
            let invalidIds: number[] = [];
            if (gameVersion === null) { // just get all the mods
                let projectDb = DatabaseHelper.cache.projects.filter((p) => p.gameName == reqQuery.data.gameName && statuses.includes(p.status));

                for (let project of projectDb) {
                    let versions = DatabaseHelper.cache.versions.filter((v) => v.projectId === project.id && statuses.includes(v.status));

                    versions = versions.sort((a, b) => {
                        return b.modVersion.compare(a.modVersion);
                    });

                    let latest = versions[0];

                    if (latest) {
                        mods.push(await project.toAPIResponse(latest));
                    }
                }
            } else {
                let modsFromDB = await gameVersion.getSupportedMods(reqQuery.data.platform, statuses);
                preLength = modsFromDB.length;

                for (let retMod of modsFromDB) {
                    mods.push(await retMod.project.toAPIResponse(retMod.version));
                }
                
                mods = mods.filter((mod) => {
                    if (!mod.versions[0] || !mod?.versions[0]?.dependencies) {
                        invalidIds.push(mod.id);
                        return false;
                    }

                    for (let dependency of mod.versions[0].dependencies) {
                        if (!mods.find((m) => {
                            if (!m.versions[0] || !m?.versions[0]?.modVersion) {
                                return false;
                            }
                            return m.id === dependency.parentId && satisfies(m.versions[0].modVersion, dependency.sv);
                        })) {
                            invalidIds.push(mod.id);
                            return false;
                        }
                    }
                    return true;
                });

                if (mods.length !== preLength) {
                    Logger.debugWarn(`Some mods were removed due to missing dependencies. (${mods.length} out of ${preLength} sent)`, `getMod`);
                }
            }

            return res.status(200).send({
                mods: mods,
                total: mods.length,
                invalidConut: preLength ? preLength - mods.length : null,
                invalidIds: invalidIds,
            });
        });

        this.router.get([`/mods/:projectIdParam`, `/projects/:projectIdParam`], async (req, res) => {
            /*
            #swagger.start
            #swagger.path = '/projects/{projectIdParam}'
            #swagger.method = 'get'
            #swagger.tags = ['Mods']
            #swagger.security = [{},{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Get a specific project by ID.'
            #swagger.description = 'Get a specific project by ID. This will also return every version associated with the project.'
            #swagger.parameters['projectIdParam'] = { in: 'path', description: 'The project ID.', type: 'number', required: true }
            #swagger.parameters['raw'] = { $ref: '#/components/parameters/raw' }
            #swagger.responses[200] = { $ref: '#/components/responses/ProjectAPIPublicResponse' }
            #swagger.responses[400]
            #swagger.responses[404]
            #swagger.end
            */
            let session = await validateSession(req, res, false, null, false);
            let projectId = Validator.zDBID.safeParse(req.params.projectIdParam);
            if (!projectId.success) {
                return res.status(400).send({ message: `Invalid project id.` });
            }
            let raw = Validator.zBool.default(false).safeParse(req.query.raw).data;
            if (!raw) {
                raw = false;
            }

            let project = DatabaseHelper.mapCache.projects.get(projectId.data);
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            // if the Project isn't verified or unverified (with the unverified flag present), don't show it unless the user is an admin or approver or the Project author
            if (project.isAllowedToView(session.user) == false) {
                return res.status(404).send({ message: `Project not found.` });
            }

            let versions = DatabaseHelper.cache.versions.filter((version) => version.projectId === project.id);
            let returnVal: any[] = [];

            for (let version of (versions)) {
                let allowedToSeeItems = await version.isAllowedToView(session.user, project);
                if (allowedToSeeItems == false) {
                    continue;
                }
                // if raw is true, return the raw project version info instead of attempting to resolve the dependencies & other fields
                if (raw) {
                    returnVal.push(version.toRawAPIResponse());
                } else {
                    // resort to default behavior, which does return no matter what iirc.
                    let resolvedVersion = await version.toAPIResponse();
                    if (resolvedVersion) {
                        returnVal.push(resolvedVersion);
                    } else {
                        Logger.debug(`Failed to get version ${version.id} for project ${project.id}`);
                    }
                }
            }

            returnVal.sort((a, b) => {
                if (a?.modVersion && b?.modVersion) {
                    return new SemVer(b?.modVersion).compare(a?.modVersion);
                } else {
                    return 0;
                }
            });

            return res.status(200).send(raw ? project : project.toAPIResponse(returnVal));
        });

        this.router.get([`/modversions/:versionIdParam`, `/versions/:versionIdParam`], async (req, res) => {
            /*
            #swagger.start
            #swagger.path = '/versions/{versionIdParam}'
            #swagger.method = 'get'
            #swagger.tags = ['Mods']
            #swagger.security = [{},{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Get a specific version by ID.'
            #swagger.description = 'Get a specific version by ID.'
            #swagger.responses[200] = { $ref: '#/components/responses/ProjectAPIPublicResponse' }
            #swagger.responses[400]
            #swagger.responses[404]
            #swagger.parameters['versionIdParam'] = { in: 'path', description: 'The version ID.', type: 'number', required: true }
            #swagger.parameters['raw'] = { $ref: '#/components/parameters/raw' }
            #swagger.end
            */
            let session = await validateSession(req, res, false, null, false);
            let versionId = Validator.zDBID.safeParse(req.params.versionIdParam);
            let raw = req.query.raw;
            if (!versionId.success) {
                return res.status(400).send({ message: `Invalid version id.` });
            }

            let version = DatabaseHelper.mapCache.versions.get(versionId.data);
            if (!version) {
                return res.status(404).send({ message: `Version not found.` });
            }

            let project = DatabaseHelper.mapCache.projects.get(version.projectId);
            
            if (!await version.isAllowedToView(session.user, project)) {
                return res.status(404).send({ message: `Version not found.` });
            }

            if (raw === `true`) {
                return res.status(200).send(version.toRawAPIResponse());
            } else {
                return res.status(200).send(await project?.toAPIResponse(version));
            }
        });

        this.router.get(`/multi/versions`, async (req, res) => {
            /*
            #swagger.start
            #swagger.path = '/multi/versions'
            #swagger.method = 'get'
            #swagger.tags = ['Mods']
            #swagger.security = [{},{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Get multiple versions by ID.'
            #swagger.description = 'Get multiple versions by ID.'
            #swagger.parameters['id'] = { in: 'query', description: 'The version IDs. Can be specified multiple times.', type: 'number', required: true }
            #swagger.parameters['raw'] = { $ref: '#/components/parameters/raw' }
            #swagger.responses[200] = {
                description: 'Returns the version and the parent project.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/ProjectAPIPublicResponse'
                            }
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[404]
            #swagger.end
            */
            let session = await validateSession(req, res, false, null, false);
            let versionIds = Validator.zDBIDArray.safeParse(req.query.id);
            let raw = req.query.raw;
            if (!versionIds.success) {
                return res.status(400).send({ message: `Invalid version id.` });
            }

            let dedupedIds = Array.from(new Set(versionIds.data));

            let retVal: ProjectAPIPublicResponse|any[] = [];
            for (const id of dedupedIds) {
                let version = DatabaseHelper.mapCache.versions.get(id);
                if (!version) {
                    return res.status(404).send({ message: `Version not found.` });
                }

                let project = DatabaseHelper.mapCache.projects.get(version.projectId);
                if (!project) {
                    return res.status(404).send({ message: `Project ID ${version.projectId} not found.` });
                }
                
                if (!await version.isAllowedToView(session.user, project)) {
                    return res.status(404).send({ message: `Version not found.` });
                }

                if (raw === `true`) {
                    retVal.push(version.toRawAPIResponse());
                } else {
                    retVal.push(await project.toAPIResponse(version));
                }
            }

            return res.status(200).send(retVal);
        });

        // #region Hashes
        this.router.get(`/hashlookup`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.summary = 'Get a specific mod version that has a file with the specified hash.'
            #swagger.description = 'Get a specific mod version that has a file with the specified hash. This is useful for finding the mod that a file belongs to.'
            #swagger.responses[200] = { description: 'Returns the mod version.',
                content: {
                    'application/json': {
                        schema: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/VersionAPIPublicResponse'
                            }
                        }
                    }
                }
            }
            #swagger.responses[400]
            #swagger.responses[404]
            #swagger.parameters['hash'] = { description: 'The hash to look up.', type: 'string', required: true }
            #swagger.parameters['raw'] = { $ref: '#/components/parameters/raw' }
            #swagger.parameters['status'] = { description: 'Only show versions with these statuses.', type: 'string' }
            */
            const hash = Validator.zHashStringOrArray.safeParse(req.query.hash).data;
            const raw = Validator.zBool.safeParse(req.query.raw).data;
            const status = Validator.zStatus.safeParse(req.query.status).data;

            if (!hash) {
                return res.status(400).send({ message: `Missing hash.` });
            }

            // i'm dont have a type for the raw mod version
            let retVal: Promise<any>[] = [];
            let hashArr = Array.isArray(hash) ? hash : [hash];

            for (const version of DatabaseHelper.cache.versions) {
                if (status !== undefined && status !== version.status) {
                    continue;
                }

                if (hashArr.includes(version.zipHash)) {
                    if (raw) {
                        retVal.push(Promise.resolve(version.toRawAPIResponse()));
                    } else {
                        retVal.push(version.toAPIResponse());
                    }
                }
                for (const fileHash of version.contentHashes) {
                    if (hashArr.includes(fileHash.hash)) {
                        if (raw) {
                            retVal.push(Promise.resolve(version.toRawAPIResponse()));
                        } else {
                            retVal.push(version.toAPIResponse());
                        }
                    }
                }
            }

            if (retVal.length > 0) {
                Promise.all(retVal).then((retVal) => {
                    return res.status(200).send(retVal);
                });
            } else {
                return res.status(404).send({ message: `Hash not found.` });
            }
        });

        this.router.get(`/multi/hashlookup`, async (req, res) => {
            /*
            #swagger.tags = ['Mods']
            #swagger.summary = 'Get a specific mod version that has a file with the specified hash.'
            #swagger.description = 'Look up multiple hashes at once, and sort the results by hash. Developed for PinkModManager.'
            #swagger.parameters['hash'] = { description: 'The hash to look up. Can be repeated', type: 'string', required: true }
            #swagger.parameters['status'] = { description: 'Only show versions with these statuses.', type: 'string' }
            #swagger.responses[200] = { description: 'Returns the mod version.' }
            #swagger.responses[400] = { description: 'Missing hash.' }
            #swagger.responses[404] = { description: 'Hash not found.' }
            */
            const hash = Validator.zHashStringOrArray.safeParse(req.query.hash).data;
            const status = Validator.zStatus.safeParse(req.query.status).data;

            if (!hash) {
                return res.status(400).send({ message: `Missing hash.` });
            }

            // i'm dont have a type for the raw mod version
            let retVal: Map<string, any[]> = new Map();
            let hashArr = Array.isArray(hash) ? hash : [hash];

            for (const version of DatabaseHelper.cache.versions) {
                if (status !== undefined && status !== version.status) {
                    continue;
                }
                if (hashArr.includes(version.zipHash)) {
                    let existing = retVal.get(version.zipHash);
                    if (existing) {
                        existing.push(version.toRawAPIResponse());
                    } else {
                        retVal.set(version.zipHash, [version.toRawAPIResponse()]);
                    }
                }
                for (const fileHash of version.contentHashes) {
                    if (hashArr.includes(fileHash.hash)) {
                        let existing = retVal.get(fileHash.hash);
                        if (existing) {
                            existing.push(version.toRawAPIResponse());
                        } else {
                            retVal.set(fileHash.hash, [version.toRawAPIResponse()]);
                        }
                    }
                }
            }

            if (retVal.size > 0) {
                let retObj: any = {};
                retVal.forEach((value, key) => {
                    // so it does an automatic this shit
                    retObj[key] = value;
                });

                return res.status(200).send(retObj);
            } else {
                return res.status(404).send({ message: `Hash not found.` });
            }
        });
        // #endregion
        // #region Deprecated
        this.router.get(`/mods`, async (req, res) => {
            // #swagger.tags = ['Mods']
            // #swagger.deprecated = true
            // #swagger.summary = 'Get all mods for a specified version.'
            // #swagger.description = 'Get all mods.<br><br>If gameName is not provided, it will default to Beat Saber.<br>If gameVersion is not provided, it will default to whatever is set as the lastest version for the selected game.'
            // #swagger.responses[200] =
            // #swagger.responses[400] = { description: 'Invalid gameVersion.' }
            // #swagger.parameters['gameName'] = { description: 'The game name.', type: 'string' }
            // #swagger.parameters['gameVersion'] = { description: 'The game version (ex. \'1.29.1\', \'1.40.0\'). IF YOU DO NOT SPECIFY A VERSION, DEPENDENCIES ARE NOT GARUNTEED TO BE 100% ACCURATE.', type: 'string' }
            // #swagger.parameters['status'] = { description: 'The status of the mod. Available status are: \'verified\'. Typing anything other than that will show you unverified mods too.', type: 'string' }
            // #swagger.parameters['platform'] = { description: 'The platform of the mod. Available platforms are: \'oculuspc\', \'universalpc\', \'steampc\'', type: 'string' }
            let reqQuery = Validator.zGetMods.safeParse(req.query);
            if (!reqQuery.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqQuery.error.issues });
            }

            // set the default gameversion if it's not provided
            if (reqQuery.data.gameVersion === undefined || reqQuery.data.gameVersion === null) {
                await GameVersion.getDefaultVersion(reqQuery.data.gameName).then((gameVersion) => {
                    if (gameVersion) {
                        reqQuery.data.gameVersion = undefined;
                    } else {
                        return res.status(400).send({ message: `Invalid game version.` });
                    }
                });
            }

            let gameVersion = reqQuery.data.gameVersion ? DatabaseHelper.cache.gameVersions.find((gameVersion) => gameVersion.version === reqQuery.data.gameVersion && gameVersion.gameName === reqQuery.data.gameName) : null;

            if (gameVersion === undefined) {
                return res.status(400).send({ message: `Invalid game version.` });
            }

            let statuses: Status[] = [Status.Verified];
            switch (reqQuery.data.status) {
                case `all`:
                    statuses = [Status.Verified, Status.Unverified, Status.Pending];
                    break;
                case Status.Pending:
                    statuses = [Status.Verified, Status.Pending];
                    break;
                case Status.Unverified:
                    statuses = [Status.Verified, Status.Unverified];
                    break;
                case Status.Verified:
                default:
                    statuses = [Status.Verified];
                    break;
            }
                
            let mods: {mod: any, latest: any | null}[] = [];
            if (gameVersion === null) {
                let modDb = DatabaseHelper.cache.projects.filter((mod) => mod.gameName == reqQuery.data.gameName && statuses.includes(mod.status));

                for (let mod of modDb) {
                    let modVersions = DatabaseHelper.cache.versions.filter((modVersion) => modVersion.projectId === mod.id && statuses.includes(modVersion.status));

                    modVersions = modVersions.sort((a, b) => {
                        return b.modVersion.compare(a.modVersion);
                    });

                    let latest = modVersions[0];

                    if (latest) {
                        let latestVer = await latest.toAPIResponse();
                        let project = await mod.toAPIResponse(null);
                        if (latestVer) {
                            mods.push({ mod: {
                                ...project,
                                versions: undefined, // remove the versions from the response
                            }, latest: {
                                ...latestVer,
                                projectId: undefined, // remove the projectId from the response
                                modId: mod.id, // add the modId to the response
                            } });
                        }
                    }
                }
            } else {
                let modsFromDB = await gameVersion.getSupportedMods(reqQuery.data.platform, statuses);
                let preLength = modsFromDB.length;

                for (let retMod of modsFromDB) {
                    let mod = await retMod.project.toAPIResponse(null);
                    let latest = await retMod.version.toAPIResponse();
                    mods.push({ mod : {
                        ...mod,
                        versions: undefined, // remove the versions from the response
                    }, latest: {
                        ...latest,
                        projectId: undefined, // remove the projectId from the response
                        modId: mod.id, // add the modId to the response
                    } });
                }

                mods = mods.filter((mod) => {
                    if (!mod.latest || !mod?.latest?.dependencies) {
                        return false;
                    }

                    for (let dependency of mod.latest.dependencies) {
                        if (!mods.find((m) => {
                            if (!m.latest || !m?.latest?.modVersion) {
                                return false;
                            }
                            return m.mod.id === dependency.parentId && satisfies(m.latest.modVersion, dependency.sv);
                        })) {
                            return false;
                        }
                    }
                    return true;
                });

                if (mods.length !== preLength) {
                    Logger.debugWarn(`Some mods were removed due to missing dependencies. (${mods.length} out of ${preLength} sent)`, `getMod`);
                }
            }
            mods = mods.map((mod) => {
                let dependencyIds: number[] = [];
                if (mod.latest && mod.latest.dependencies) {
                    for (let dependency of mod.latest.dependencies) {
                        let dep = mods.find((m) => {
                            if (!m.latest || !m?.latest?.modVersion) {
                                return false;
                            }
                            if (m.mod.id === dependency.parentId && satisfies(m.latest.modVersion, dependency.sv)) {
                                return true;
                            }
                            return false;
                        });
                        if (dep) {
                            dependencyIds.push(dep.latest.id);
                        }
                    }
                }

                return {
                    mod: mod.mod,
                    latest: {
                        ...mod.latest,
                        dependencies: dependencyIds,
                    }
                };
            });
            return res.status(200).send({ mods });
        });
    }
}