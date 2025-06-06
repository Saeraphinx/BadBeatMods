import { Router } from 'express';
import { DatabaseHelper, ProjectAPIPublicResponse, Status, User } from '../../shared/Database.ts';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Validator } from '../../shared/Validator.ts';

export class UserRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.get(`/user`, async (req, res) => {
            // #swagger.tags = ['Users']
            /* #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Get logged in user information.'
            // #swagger.description = 'Get user information.'
            // #swagger.responses[200] = { description: 'Returns user information.', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserAPIPublicResponse' } } } }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[500] = { description: 'Internal server error.' }
            let session = await validateSession(req, res, false);
            if (!session.user) {
                return;
            }
            return res.status(200).send({ user: session.user.toAPIResponse() });
        });

        this.router.get(`/user/:id`, async (req, res) => {
            // #swagger.tags = ['Users']
            // #swagger.summary = 'Get user information.'
            // #swagger.description = 'Get user information.'
            // #swagger.parameters['id'] = { description: 'User ID.', type: 'number' }
            // #swagger.responses[200] = { $ref: '#/components/responses/UserResponse' }
            // #swagger.responses[404] = { description: 'User not found.' }
            // #swagger.responses[400] = { description: 'Invalid parameters.' }
            let id = Validator.zDBID.safeParse(req.params.id);
            if (!id.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let user = DatabaseHelper.cache.users.find((u) => u.id === id.data);
            if (user) {
                return res.status(200).send({ user: user.toAPIResponse() });
            } else {
                return res.status(404).send({ message: `User not found.` });
            }
        });

        this.router.get(`/user/:id/mods`, async (req, res) => {
            // #swagger.tags = ['Users']
            /* #swagger.security = [{},{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Get user information.'
            // #swagger.description = 'Get user information.'
            // #swagger.parameters['id'] = { description: 'User ID.', type: 'number' }
            // #swagger.parameters['status'] = { description: 'Only show this status.', type: 'string' }
            // #swagger.responses[200] = { description: 'Returns mods.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ProjectVersionPair' } } } } }
            // #swagger.responses[404] = { description: 'User not found.' }
            // #swagger.responses[400] = { description: 'Invalid parameters.' }
            let session: { user: User | null } = { user: null };
            let id = Validator.zDBID.safeParse(req.params.id);
            let status = Validator.zStatus.default(Status.Verified).safeParse(req.query.status);
            if (!id.success || !status.success) {
                return res.status(400).send({ message: `Invalid parameters.` });
            }

            let user = DatabaseHelper.cache.users.find((u) => u.id === id.data);
            if (user) {
                let mods: {project: ProjectAPIPublicResponse, version: any }[] = [];
                if (status.data !== Status.Verified && status.data !== Status.Unverified) {
                    session = await validateSession(req, res, false, null, true);
                    if (!session.user) {
                        return;
                    }
                }

                for (let project of DatabaseHelper.cache.projects) {
                    if (project.status !== status.data) {
                        continue;
                    }
                    if (!project.authorIds.includes(id.data)) {
                        continue;
                    }

                    if (status.data !== Status.Verified && status.data !== Status.Unverified) {
                        if (!project.isAllowedToView(session.user)) {
                            continue;
                        }
                    }

                    let latest = await project.getLatestVersion(undefined, undefined, [status.data]);
                    if (latest) {
                        mods.push({project: project.toAPIResponse(), version: latest.toAPIResponse(undefined, [status.data])});
                    } else {
                        mods.push({project: project.toAPIResponse(), version: null});
                    }
                }
                return res.status(200).send(mods);
            } else {
                return res.status(404).send({ message: `User not found.` });
            }
        });

        this.router.get(`/users`, async (req, res) => {
            // #swagger.tags = ['Users']
            /* #swagger.security = [{},{
                "bearerAuth": [],
                "cookieAuth": []
            }] */
            // #swagger.summary = 'Get all users.'
            // #swagger.description = 'Get all users.'
            // #swagger.parameters['username'] = { description: 'Username to search for.', type: 'string' }
            // #swagger.responses[200] = { description: 'Returns all users.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/UserAPIPublicResponse' } } } } }
            // #swagger.responses[500] = { description: 'Internal server error.' }
            let session = await validateSession(req, res, false, null, false);

            let users = DatabaseHelper.cache.users;

            let unSearchString = Validator.z.string().min(3).max(32).safeParse(req.query.username);
            if (unSearchString.success) {
                users = users.filter((user) => user.username.toLowerCase().includes(unSearchString.data.toLowerCase()));
            }

            if (users.length == DatabaseHelper.cache.users.length) {
                if (!session.user) {
                    return res.status(401).send({ message: `Unauthorized.` });
                }
            }

            return res.status(200).send(users.map((user) => user.toAPIResponse()));
        });

        /*
        this.app.patch(`/user/:id/`, async (req, res) => {
            // #swagger.tags = ['User']
            #swagger.security = [{
                "bearerAuth": [],
                "cookieAuth": []
            }]
            // #swagger.summary = 'Get user information.'
            // #swagger.description = 'Get user information.'
            // #swagger.responses[200] = { description: 'Returns user information.' }
            // #swagger.responses[401] = { description: 'Unauthorized.' }
            // #swagger.responses[500] = { description: 'Internal server error.' }
            let displayName = req.body.displayName;
            let sponsorUrl = req.body.sponsorUrl;
            let bio = req.body.bio;
            const session = await validateSession(req, res, true);
            if (!session) {
                return;
            }

            if (!HTTPTools.validateNumberParameter(req.params.id)) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            let id = HTTPTools.parseNumberParameter(req.params.id);
            let user = await editUser(id, displayName, sponsorUrl, bio);
            if (user === `usererror`) {
                return res.status(400).send({ error: `Invalid parameters.` });
            }
            return res.status(200).send({ user: user.toAPIResponse() });
        });
        */
    }
}

async function editUser(userId: number, displayName: any, sponsorUrl:any, bio:any): Promise<User|`usererror`> {
    if (userId === undefined || (displayName === undefined && sponsorUrl === undefined && bio === undefined)) {
        return `usererror`;
    }

    let user = await DatabaseHelper.database.Users.findByPk(userId);

    if (!user) {
        return `usererror`;
    }

    if (displayName) {
        user.displayName = displayName;
    }

    if (sponsorUrl) {
        user.sponsorUrl = sponsorUrl;
    }

    if (bio) {
        user.bio = bio;
    }

    await user.save();
    return user;
}