import { Router } from 'express';
import path from 'node:path';
import { DatabaseHelper, ContentHash, Status, UserRoles } from '../../shared/Database.ts';
import JSZip from 'jszip';
import crypto from 'crypto';
import { validateAdditionalGamePermissions, validateSession } from '../../shared/AuthHelper.ts';
import { Config } from '../../shared/Config.ts';
import { Logger } from '../../shared/Logger.ts';
import { SemVer } from 'semver';
import { Validator } from '../../shared/Validator.ts';
import { UploadedFile } from 'express-fileupload';
import { sendProjectLog, sendVersionLog, WebhookLogType } from '../../shared/ModWebhooks.ts';
import { Utils } from '../../shared/Utils.ts';

export class CreateModRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.post([`/mods/create`, `/projects/create`], async (req, res) => {
            /*
            #swagger.start
            #swagger.path = '/projects/create'
            #swagger.method = 'post'
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Create a project.'
            #swagger.description = 'Create a project.'
            #swagger.requestBody = {
                content: {
                    'application/json': {
                        schema: {
                            $ref: '#/definitions/zCreateProject'
                        }
                    }
                }
            }
            #swagger.parameters['icon'] = {
                in: 'formData',
                type: 'file',
                description: 'Project icon.',
                required: false
            }
            #swagger.end
            */
            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }

            let reqBody = Validator.zCreateProject.safeParse(req.body);
            let icon = req.files?.icon;
            let iconIsValid = false;

            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`), errors: reqBody.error.issues });
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

            DatabaseHelper.database.Projects.create({
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
            }).then(async (project) => {
                DatabaseHelper.refreshCache(`projects`);
                if (iconIsValid) {
                    (icon as UploadedFile).mv(filePath);
                }
                Logger.log(`Project ${project.name} created by ${session.user.username}.`);
                sendProjectLog(project, session.user, WebhookLogType.Text_Created);
                return res.status(200).send({ project: project });
            }).catch((error) => {
                let message = `Error creating project.`;
                message = Utils.parseErrorMessage(error);
                Logger.error(`Error creating project: ${error} - ${message}`);
                return res.status(500).send({ message: message });
            });
        });

        this.router.post([`/mods/:projectIdParam/create`, `/mods/:projectIdParam/upload`, `/projects/:projectIdParam/create`, `/projects/:projectIdParam/upload`,], async (req, res) => {
            /*
            #swagger.start
            #swagger.path = '/projects/{projectIdParam}/create'
            #swagger.method = 'post'
            #swagger.tags = ['Mods']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            #swagger.summary = 'Upload a version.'
            #swagger.description = 'Upload a new version to a project.'
            #swagger.parameters['projectIdParam'] = { description: 'Project ID.', type: 'number' }
            #swagger.requestBody = {
                schema: {
                    $ref: '#/definitions/zUpdateVersion'
                }
            }
            #swagger.parameters['file'] = {
                in: 'formData',
                type: 'file',
                description: 'Version zip file.',
                required: true
            }
            #swagger.responses[200] = {
                $ref: '#/components/responses/ProjectVersionPairResponse'
            }
            #swagger.responses[400]
            #swagger.responses[401]
            #swagger.responses[404]
            #swagger.responses[413]
            #swagger.responses[500]
            */

            let session = await validateSession(req, res, true);
            if (!session.user) {
                return;
            }
            
            let projectId = Validator.zDBID.safeParse(req.params.projectIdParam);
            let reqBody = Validator.zCreateVersion.safeParse(req.body);
            let file = req.files?.file;

            if (!projectId.success) {
                return res.status(400).send({ message: `Invalid project ID.` });
            }

            if (!reqBody.success) {
                return res.status(400).send({ message: Utils.parseErrorMessage(reqBody.error, `Invalid parameters.`), errors: reqBody.error.issues });
            }

            let project = await DatabaseHelper.database.Projects.findOne({ where: { id: projectId.data } });
            if (!project) {
                return res.status(404).send({ message: `Project not found.` });
            }

            if (!project.authorIds.includes(session.user.id)) {
                return res.status(401).send({ message: `You cannot upload to this project.` });
            }

            if (project.status === Status.Removed) {
                return res.status(401).send({ message: `This project has been denied and removed` });
            }

            if ((await Validator.validateIDArray(reqBody.data.supportedGameVersionIds, `gameVersions`, false, false)) == false) {
                return res.status(400).send({ message: `Invalid game version.` });
            }

            if ((await Validator.validateIDArray(reqBody.data.dependencies?.map(d => d.parentId), `projects`, true, true)) == false) {
                return res.status(400).send({ message: `Invalid dependencies.` });
            }

            if (!file || Array.isArray(file)) {
                return res.status(400).send({ message: `File missing.` });
            }

            if (file.truncated || file.size > Config.server.fileUploadLimitMB * 1024 * 1024) {
                if (validateAdditionalGamePermissions(session, project.gameName, UserRoles.LargeFiles)) {
                    Logger.warn(`User ${session.user.username} (${session.user.id}) uploaded a file larger than ${Config.server.fileUploadLimitMB}MB for project ${project.name} (${project.id}).`);
                    // let it slide. truncated will catch anything above the limit
                } else {
                    return res.status(413).send({ message: `File too large. Max size is ${Config.server.fileUploadLimitMB}MB.` });
                }
            }

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

            DatabaseHelper.database.Versions.create({
                projectId: projectId.data,
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
            }).then(async (version) => {
                DatabaseHelper.refreshCache(`versions`);
                let retVal = await version.toRawAPIResponse();
                sendVersionLog(version, session.user, WebhookLogType.Text_Created, project);
                return res.status(200).send({ project: project, version: retVal });
            }).catch((error) => {
                let message = `Error creating version.`;
                message = Utils.parseErrorMessage(error);
                Logger.error(`Error creating version: ${error} - ${message}`);
                return res.status(500).send({ message: message });
            });
        });
    }
}