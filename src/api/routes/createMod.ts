import e, { Router } from 'express';
import path from 'node:path';
import { DatabaseHelper, ContentHash, Status, UserRoles } from '../../shared/Database';
import JSZip from 'jszip';
import crypto from 'crypto';
import { validateAdditionalGamePermissions, validateSession } from '../../shared/AuthHelper';
import { Config } from '../../shared/Config';
import { Logger } from '../../shared/Logger';
import { SemVer } from 'semver';
import { Validator } from '../../shared/Validator';
import { UploadedFile } from 'express-fileupload';

export class CreateModRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.post(`/mods/create`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Create a mod.'
            // #swagger.description = 'Create a mod.'
            /* #swagger.requestBody = {
                schema: {
                    $ref: '#/definitions/CreateMod'
                }
            }
            #swagger.parameters['icon'] = {
                in: 'formData',
                type: 'file',
                description: 'Mod icon.',
                required: false
            } */
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let reqBody = Validator.zCreateMod.safeParse(req.body);
            let icon = req.files?.icon;
            let iconIsValid = false;

            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }

            // validate icon if it exists
            if (icon !== undefined) {
                if (Array.isArray(icon) || icon.size > 8 * 1024 * 1024) {
                    return res.status(413).send({ error: `Invalid file (Might be too large, 8MB max.)` });
                } else {
                    let isAcceptableImage = (icon.mimetype === `image/png` && icon.name.endsWith(`.png`)) || (icon.mimetype === `image/jpeg` && (icon.name.endsWith(`.jpeg`) || icon.name.endsWith(`.jpg`)) || (icon.mimetype === `image/webp` && icon.name.endsWith(`.webp`)));

                    if (!isAcceptableImage) {
                        return res.status(400).send({ error: `Invalid file type.` });
                    } else {
                        iconIsValid = true;
                    }
                }
            }

            // if the icon is invalid, we don't need to do anything since it was delt with above
            let filePath = ``;
            if (iconIsValid) {
                // this is jsut so that the following code doesn't have to cast icon as UploadedFile every time
                if (!icon || Array.isArray(icon)) {
                    iconIsValid = false;
                } else {
                    // move the icon to the correct location
                    filePath = `${path.resolve(Config.storage.iconsDir)}/${icon.md5}${path.extname(icon.name)}`;
                    if (filePath.startsWith(`${path.resolve(Config.storage.iconsDir)}`) == false) {
                        iconIsValid = false;
                    }
                }
            }

            DatabaseHelper.database.Mods.create({
                name: reqBody.data.name,
                summary: reqBody.data.summary,
                description: reqBody.data.description,
                authorIds: [session.user.id],
                gitUrl: reqBody.data.gitUrl,
                category: reqBody.data.category,
                gameName: reqBody.data.gameName,
                // this is fine because we've already validated the icon to be a single file assuming icon
                iconFileName: iconIsValid ? `${(icon as UploadedFile).md5}${path.extname((icon as UploadedFile).name)}` : `default.png`,
                lastUpdatedById: session.user.id,
                status: Status.Private,
            }).then(async (mod) => {
                DatabaseHelper.refreshCache(`mods`);
                if (iconIsValid) {
                    (icon as UploadedFile).mv(filePath);
                }
                Logger.log(`Mod ${mod.name} created by ${session.user.username}.`);
                return res.status(200).send({ mod });
            }).catch((error) => {
                return res.status(500).send({ message: `Error creating mod: ${error} ${error?.name}` });
            });
        });

        this.router.post(`/mods/:modIdParam/upload`, async (req, res) => {
            // #swagger.tags = ['Mods']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Upload a mod version.'
            // #swagger.description = 'Upload a mod version.'
            // #swagger.parameters['modIdParam'] = { description: 'Mod ID.', type: 'number' }
            /* #swagger.requestBody = {
                schema: {
                    $ref: '#/definitions/CreateEditModVersion'
                }
            }
            #swagger.parameters['file'] = {
                in: 'formData',
                type: 'file',
                description: 'Mod zip file.',
                required: true
            } */

            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }
            
            let modId = Validator.zDBID.safeParse(req.params.modIdParam);
            let reqBody = Validator.zUploadModVersion.safeParse(req.body);
            let file = req.files?.file;

            //#region Request Validation
            if (!modId.success) {
                return res.status(400).send({ message: `Invalid modId.` });
            }

            if (!reqBody.success) {
                return res.status(400).send({ message: `Invalid parameters.`, errors: reqBody.error.issues });
            }

            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: modId.data } });
            if (!mod) {
                return res.status(404).send({ message: `Mod not found.` });
            }

            if (!mod.authorIds.includes(session.user.id)) {
                return res.status(401).send({ message: `You cannot upload to this mod.` });
            }

            if (mod.status === Status.Removed) {
                return res.status(401).send({ message: `This mod has been denied and removed` });
            }

            if ((await Validator.validateIDArray(reqBody.data.supportedGameVersionIds, `gameVersions`, false, false)) == false) {
                return res.status(400).send({ message: `Invalid game version.` });
            }

            if ((await Validator.validateIDArray(reqBody.data.dependencies, `modVersions`, true, true)) == false) {
                return res.status(400).send({ message: `Invalid dependency.` });
            }

            if (!file || Array.isArray(file)) {
                return res.status(400).send({ message: `File missing.` });
            }

            if (file.truncated || file.size > Config.server.fileUploadLimitMB * 1024 * 1024) {
                if (validateAdditionalGamePermissions(session, mod.gameName, UserRoles.LargeFiles)) {
                    Logger.warn(`User ${session.user.username} (${session.user.id}) uploaded a file larger than ${Config.server.fileUploadLimitMB}MB for mod ${mod.name} (${mod.id}).`);
                    // let it slide. truncated will catch anything above the limit
                } else {
                    return res.status(413).send({ message: `File too large. Max size is ${Config.server.fileUploadLimitMB}MB.` });
                }
            }
            //#endregion
            let isZip = (file.mimetype === `application/zip` || file.mimetype === `application/x-zip-compressed`) && file.name.endsWith(`.zip`);
            let hashs: ContentHash[] = [];
            if (isZip) {
                await JSZip.loadAsync(file.data).then(async (zip) => {
                    let files = zip.files;
                    for (let file in files) {
                        if (file.endsWith(`/`)) {
                            continue;
                        }

                        let fileData = await files[file].async(`nodebuffer`);
                        const md5 = crypto.createHash(`md5`);
                        let result = md5.update(fileData).digest(`hex`);
                        hashs.push({ path: file, hash: result });
                    }
                }).catch((error) => {
                    Logger.error(`Error reading zip file: ${error}`);
                    return res.status(500).send({ message: `Error reading zip file.` });
                });
            } else {
                return res.status(400).send({ message: `File must be a zip archive.` });
            }

            let filePath = `${path.resolve(Config.storage.modsDir)}/${file.md5}${path.extname(file.name)}`;
            if (filePath.startsWith(`${path.resolve(Config.storage.modsDir)}`) == false) {
                return res.status(400).send({ message: `Invalid zip file.` });
            } else {
                file.mv(filePath);
            }

            DatabaseHelper.database.ModVersions.create({
                modId: modId.data,
                authorId: session.user.id,
                status: Status.Private,
                supportedGameVersionIds: reqBody.data.supportedGameVersionIds,
                modVersion: new SemVer(reqBody.data.modVersion),
                dependencies: reqBody.data.dependencies ? reqBody.data.dependencies : [],
                platform: reqBody.data.platform,
                contentHashes: hashs,
                zipHash: file.md5,
                lastUpdatedById: session.user.id,
                fileSize: file.size
            }).then(async (modVersion) => {
                DatabaseHelper.refreshCache(`modVersions`);
                let retVal = await modVersion.toRawAPIResonse();
                return res.status(200).send({ modVersion: retVal });
            }).catch((error) => {
                let message = `Error creating mod version.`;
                if (Array.isArray(error?.errors) && error?.errors?.length > 0) {
                    message = error.errors.map((e: any) => e.message).join(`, `);
                }
                return res.status(500).send({ message: `Error creating mod version: ${error} ${message} ${error?.name}` });
            });
        });
    }
}