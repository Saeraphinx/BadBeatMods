import { Router } from 'express';
import { DatabaseHelper, Status, ProjectAPIPublicResponse, GameVersion, VersionAPIPublicResponse } from '../../shared/Database.ts';
import { Validator } from '../../shared/Validator.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Logger } from '../../shared/Logger.ts';
import { SemVer } from 'semver';

export class GetModRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/mods`, async (req, res) => {
            // #swagger.tags = ['Mods']
            // #swagger.summary = 'Get all mods for a specified version.'
            // #swagger.description = 'Get all mods.<br><br>If gameName is not provided, it will default to Beat Saber.<br>If gameVersion is not provided, it will default to whatever is set as the lastest version for the selected game.'
            // #swagger.responses[200] = {'description':'Returns all mods.','schema':{'mods':[{'mod':{'$ref':'#/components/schemas/ProjectAPIPublicResponse'},'latest':{'$ref':'#/components/schemas/VersionAPIPublicResponse'}}]}}
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
                
            let mods: {project: ProjectAPIPublicResponse, version: VersionAPIPublicResponse | null}[] = [];
            let preLength = undefined;
            if (gameVersion === null) {
                let modDb = DatabaseHelper.cache.projects.filter((mod) => mod.gameName == reqQuery.data.gameName && statuses.includes(mod.status));

                for (let mod of modDb) {
                    let modVersions = DatabaseHelper.cache.versions.filter((modVersion) => modVersion.projectId === mod.id && statuses.includes(modVersion.status));

                    modVersions = modVersions.sort((a, b) => {
                        return b.modVersion.compare(a.modVersion);
                    });

                    let latest = modVersions[0];

                    if (latest) {
                        let latestVer = await latest.toAPIResponse(latest.supportedGameVersionIds[0], statuses);
                        if (latestVer) {
                            mods.push({ project: mod.toAPIResponse(), version: latestVer });
                        }
                    }
                }
            } else {
                let modsFromDB = await gameVersion.getSupportedMods(reqQuery.data.platform, statuses);
                preLength = modsFromDB.length;

                for (let retMod of modsFromDB) {
                    let mod = retMod.mod.toAPIResponse();
                    let latest = await retMod.latest.toAPIResponse(gameVersion.id, statuses);
                    mods.push({ project: mod, version: latest });
                }

                mods = mods.filter((mod) => {
                    if (!mod?.version) {
                        return false;
                    }

                    if (!mod?.version?.dependencies) {
                        return false;
                    }

                    for (let dependency of mod.version.dependencies) {
                        if (!mods.find((mod) => mod?.version?.id === dependency)) {
                            return false;
                        }
                    }

                    return true;
                });

                if (mods.length !== preLength) {
                    Logger.debugWarn(`Some mods were removed due to missing dependencies. (${mods.length} out of ${preLength} sent)`, `getMod`);
                }
            }

            return res.status(200).send({ mods: mods, preLength: preLength });
        });

        this.router.get(`/mods/:projectIdParam`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Get a specific mod by ID.'
            // #swagger.description = 'Get a specific mod by ID. This will also return every version of the mod.'
            // #swagger.responses[200] = { description: 'Returns the mod.' }
            // #swagger.responses[400] = { description: 'Invalid mod id.' }
            // #swagger.responses[404] = { description: 'Mod not found.' }
            // #swagger.parameters['modIdParam'] = { in: 'path', description: 'The mod ID.', type: 'number', required: true }
            // #swagger.parameters['raw'] = { description: 'Return the raw mod info.', type: 'boolean' }
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
                return res.status(404).send({ message: `Mod not found.` });
            }

            // if the mod isn't verified or unverified (with the unverified flag present), don't show it unless the user is an admin or approver or the mod author
            if (project.isAllowedToView(session.user) == false) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            let versions = DatabaseHelper.cache.versions.filter((modVersion) => modVersion.projectId === project.id);
            let returnVal: any[] = [];

            for (let version of (versions)) {
                let allowedToSeeItems = await version.isAllowedToView(session.user, project);
                if (allowedToSeeItems == false) {
                    continue;
                }
                // if raw is true, return the raw mod version info instead of attempting to resolve the dependencies & other fields
                if (raw) {
                    returnVal.push(version.toRawAPIResponse());
                } else {
                    // resort to default behavior, which does return no matter what iirc.
                    let acceptableStatuses = await version.isAllowedToEdit(session.user, project) ?
                        [Status.Verified, Status.Unverified, Status.Pending, Status.Removed, Status.Private] :
                        [Status.Verified, Status.Unverified, Status.Pending];

                    let resolvedVersion = await version.toAPIResponse(undefined, acceptableStatuses);
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

            return res.status(200).send({ project: raw ? project : project.toAPIResponse(), versions: returnVal });
        });

        this.router.get(`/modversions/:modVersionIdParam`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Get a specific mod version by ID.'
            // #swagger.description = 'Get a specific mod version by ID.'
            // #swagger.responses[200] = { description: 'Returns the mod version.' }
            // #swagger.responses[400] = { description: 'Invalid mod version id.' }
            // #swagger.responses[404] = { description: 'Mod version not found.' }
            // #swagger.parameters['modVersionIdParam'] = { in: 'path', description: 'The mod version ID.', type: 'number', required: true }
            // #swagger.parameters['raw'] = { description: 'Return the raw mod depedendcies without attempting to resolve them.', type: 'boolean' }
            let session = await validateSession(req, res, false, null, false);
            let modVersionId = Validator.zDBID.safeParse(req.params.modVersionIdParam);
            let raw = req.query.raw;
            if (!modVersionId.success) {
                return res.status(400).send({ message: `Invalid mod version id.` });
            }

            let modVersion = DatabaseHelper.mapCache.versions.get(modVersionId.data);
            if (!modVersion) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            let mod = DatabaseHelper.mapCache.projects.get(modVersion.projectId);
            
            if (!await modVersion.isAllowedToView(session.user, mod)) {
                return res.status(404).send({ message: `Mod version not found.` });
            }

            if (raw === `true`) {
                return res.status(200).send({ project: mod ? mod.toAPIResponse() : undefined, version: modVersion.toRawAPIResponse() });
            } else {
                return res.status(200).send({ project: mod ? mod.toAPIResponse() : undefined, version: await modVersion.toAPIResponse(modVersion.supportedGameVersionIds[0], [Status.Verified, Status.Unverified]) });
            }
        });

        this.router.get(`/multi/modversions`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Get multiple mod versions by ID.'
            // #swagger.description = 'Get multiple mod versions by ID.'
            // #swagger.responses[200] = { description: 'Returns the mod version.' }
            // #swagger.responses[400] = { description: 'Invalid mod version id.' }
            // #swagger.responses[404] = { description: 'Mod version not found.' }
            // #swagger.parameters['id'] = { in: 'query', description: 'The mod version IDs.', type: 'array', required: true }
            // #swagger.parameters['raw'] = { description: 'Return the raw mod depedendcies without attempting to resolve them.', type: 'boolean' }
            let session = await validateSession(req, res, false, null, false);
            let modVersionIds = Validator.zDBIDArray.safeParse(req.query.id);
            let raw = req.query.raw;
            if (!modVersionIds.success) {
                return res.status(400).send({ message: `Invalid mod version id.` });
            }

            let dedupedIds = Array.from(new Set(modVersionIds.data));

            let retVal: {project: ProjectAPIPublicResponse, version: any}[] = [];
            for (const id of dedupedIds) {
                let modVersion = DatabaseHelper.mapCache.versions.get(id);
                if (!modVersion) {
                    return res.status(404).send({ message: `Mod version not found.` });
                }

                let mod = DatabaseHelper.mapCache.projects.get(modVersion.projectId);
                if (!mod) {
                    return res.status(404).send({ message: `Mod ID ${modVersion.projectId} not found.` });
                }
                
                if (!await modVersion.isAllowedToView(session.user, mod)) {
                    return res.status(404).send({ message: `Mod version not found.` });
                }

                if (raw === `true`) {
                    retVal.push({ project: mod.toAPIResponse(), version: modVersion.toRawAPIResponse() });
                } else {
                    retVal.push({ project: mod.toAPIResponse(), version: await modVersion.toAPIResponse(modVersion.supportedGameVersionIds[0], [Status.Verified, Status.Unverified, Status.Pending, Status.Removed]) });
                }
            }

            return res.status(200).send(retVal);
        });

        // #region Hashes
        this.router.get(`/hashlookup`, async (req, res) => {
            // #swagger.tags = ['Mods']
            // #swagger.summary = 'Get a specific mod version that has a file with the specified hash.'
            // #swagger.description = 'Get a specific mod version that has a file with the specified hash. This is useful for finding the mod that a file belongs to.'
            // #swagger.responses[200] = { description: 'Returns the mod version.' }
            // #swagger.responses[400] = { description: 'Missing hash.' }
            // #swagger.responses[404] = { description: 'Hash not found.' }
            // #swagger.parameters['hash'] = { description: 'The hash to look up.', type: 'string', required: true }
            // #swagger.parameters['raw'] = { description: 'Return the raw mod depedendcies without attempting to resolve them.', type: 'boolean' }
            // #swagger.parameters['status'] = { description: 'Only show mods with these statuses.', type: 'string' }
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
                        retVal.push(version.toAPIResponse(version.supportedGameVersionIds[0], [Status.Verified, Status.Unverified]));
                    }
                }
                for (const fileHash of version.contentHashes) {
                    if (hashArr.includes(fileHash.hash)) {
                        if (raw) {
                            retVal.push(Promise.resolve(version.toRawAPIResponse()));
                        } else {
                            retVal.push(version.toAPIResponse(version.supportedGameVersionIds[0], [Status.Verified, Status.Unverified]));
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
            // #swagger.tags = ['Mods']
            // #swagger.summary = 'Get a specific mod version that has a file with the specified hash.'
            // #swagger.description = 'Look up multiple hashes at once, and sort the results by hash. Developed for PinkModManager.'
            // #swagger.responses[200] = { description: 'Returns the mod version.' }
            // #swagger.responses[400] = { description: 'Missing hash.' }
            // #swagger.responses[404] = { description: 'Hash not found.' }
            // #swagger.parameters['hash'] = { description: 'The hash to look up.', type: 'string', required: true }
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
    }
}