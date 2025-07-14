/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import express, { Request } from 'express';
import session, { SessionOptions } from 'express-session';
import MemoryStore from 'memorystore';
import connectSqlite3 from 'connect-sqlite3';
import fileUpload from 'express-fileupload';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { ActivityType } from 'discord.js';
import passport from 'passport';
import { Strategy as BearerStrategy } from 'passport-http-bearer';
import { Octokit } from '@octokit/rest';

import { DatabaseHelper, DatabaseManager } from './shared/Database.ts';
import { Logger } from './shared/Logger.ts';
import { Config } from './shared/Config.ts';
import { Luma } from './discord/classes/Luma.ts';

import { CreateModRoutes } from './api/routes/v3/createMod.ts';
import { GetModRoutes } from './api/routes/v3/getMod.ts';
import { UpdateProjectRoutes } from './api/routes/v3/updateMod.ts';
import { AuthRoutes } from './api/routes/allversions/auth.ts';
import { VersionsRoutes } from './api/routes/v3/games.ts';
import { AdminRoutes } from './api/routes/allversions/admin.ts';
import { ApprovalRoutes } from './api/routes/v3/approval.ts';
import { BeatModsRoutes } from './api/routes/v1/beatmods.ts';
import { CDNRoutes } from './api/routes/allversions/cdn.ts';
import { MOTDRoutes } from './api/routes/v3/motd.ts';
import { UserRoutes } from './api/routes/v3/users.ts';
import { StatusRoutes } from './api/routes/allversions/apistatus.ts';
import { BulkActionsRoutes } from './api/routes/v3/bulkActions.ts';

// eslint-disable-next-line quotes
import fullApi from './api/swagger_full.json' with { type: "json" };
// eslint-disable-next-line quotes
import publicApi from './api/swagger_public.json' with { type: "json" };
import { Server } from 'node:http';
import { OpenAPIV3_1 } from 'openapi-types';
function init() {
    console.log(`Starting setup...`);
    if (process.env.NODE_ENV === `test`) {
        console.log(`Running in test mode.`);
    } else {
        new Config();
    }
    new Logger();
    const app = express();
    const memstore = MemoryStore(session);
    const port = Config.server.port;
    let database = new DatabaseManager();
    let server: Server | undefined = undefined;
    let bot: Luma | undefined = undefined;

    // handle parsing request bodies
    app.use(express.json({ limit: 100000 }));
    app.use(express.urlencoded({limit : 10000, parameterLimit: 10, extended: false }));
    app.use(cors({
        origin: Config.server.corsOrigins,
        credentials: Config.server.iHateSecurity ? true : false,
    }));
    app.use(fileUpload({
        limits: {
            fileSize: Math.floor(Config.server.fileUploadLimitMB * Config.server.fileUploadMultiplierMB * 1024 * 1024), // here you go kaitlyn
            files: 1
        },
        abortOnLimit: true,
        limitHandler: (req, res, next) => {
            return res.status(413).send({ message: `File size limit has been reached.` });
        },
    }));

    const sessionConfigData: SessionOptions = {
        secret: Config.server.sessionSecret,
        name: `bbm_session`,
        resave: false,
        saveUninitialized: false,
        unset: `destroy`,
        rolling: true,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
            secure: `auto`,
            httpOnly: true,
            sameSite: Config.server.iHateSecurity ? `none` : `strict`,
        }
    };

    if (Config.server.storeSessions) {
        const sqlite3sessions = connectSqlite3(session);
        let dbpath = Config.storage.sessions.split(`/`);
        let name = dbpath.pop();
        if (name === undefined) {
            throw new Error(`Invalid session storage path.`);
        }
        name = name.split(`.`)[0];
        sessionConfigData.store = new (sqlite3sessions as any)({
            db: name,
            dir: path.resolve(dbpath.join(`/`)),
            table: `sessions`
        });
    } else {
        sessionConfigData.store = new memstore({
            checkPeriod: 86400000,
        });
    }

    app.set(`trust proxy`, Config.server.trustProxy);

    let apiRouter = express.Router({
        caseSensitive: false,
        mergeParams: false,
        strict: false,
    });

    let cdnRouter = express.Router({
        caseSensitive: false,
        mergeParams: false,
        strict: false,
    });

    apiRouter.use(rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        statusCode: 429,
        message: {message: `Rate limit exceeded.`},
        skipSuccessfulRequests: false,
        validate: {trustProxy: false},
    }));

    const cdnRateLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        statusCode: 429,
        message: `Rate limit exceeded.`,
        skipSuccessfulRequests: false,
        validate: {trustProxy: false},
    });

    //cdnRouter.use(cdnRateLimiter);

    app.use(session(sessionConfigData));
    passport.use(`bearer`, new BearerStrategy(
        function(token, done) {
            const octokit = new Octokit({ auth: token });
            if (invalidAttempts.filter((t) => token === t).length > 2) {
                return done(null, false);
            }
            // Compare: https://docs.github.com/en/rest/reference/users#get-the-authenticated-user
            octokit.rest.users.getAuthenticated().then((response) => {
                if (response.status !== 200 || response.data === undefined) {
                    invalidAttempts.push(token ? token : `unknown`);
                    return done(null, false);
                }
                let profile = response.data;
                DatabaseHelper.database.Users.findOne({ where: { githubId: profile.id.toString() } }).then((user) => {
                    if (!user) {
                        return done(null, false);
                    } else {
                        return done(null, user);
                    }
                }).catch((err) => {
                    Logger.error(`Error finding user: ${err}`);
                    return done(err, null);
                });
            }).catch((err) => {
                if (err.status === 401) {
                    invalidAttempts.push(token ? token : `unknown`);
                    return done(null, false);
                }
                Logger.warn(`Error getting user: ${err}`);
                return done(err, null);
            });
        }
    ));

    let invalidAttempts: string[] = [];
    apiRouter.use(async (req, res, next) => {
        if (req.session.userId || Config.flags.enableGithubPAT == false) {
            req.bbmAuth = {
                userId: req.session.userId,
                isApiAuth: false,
            };
            next();
        } else {
            passport.authenticate(`bearer`, { session: false }, (err:any, user:any) => {
                if (err) {
                    return res.status(401).send({ message: `Unauthorized` });
                }
                if (user && user.id) {
                    req.bbmAuth = {
                        userId: user.id,
                        isApiAuth: true,
                    };
                    //req.session.userId = user.id;
                    //req.session.goodMorning47YourTargetIsThisSession = true;
                }
                next();
            })(req, res, next);
        }
    });

    app.use((req, res, next) => {
        if (Config.devmode) {
            if (!req.url.includes(`hashlookup`)) {
                Logger.winston.log(`http`, `${req.method} ${req.url}`);
            }
        }
        
        next();
    });

    //app.use(`/api`, Validator.runValidator);
    let v1Router = express.Router({
        caseSensitive: false,
        mergeParams: false,
        strict: false,
    });

    let v2Router = express.Router({
        caseSensitive: false,
        mergeParams: false,
        strict: false,
    });

    let v3Router = express.Router({
        caseSensitive: false,
        mergeParams: false,
        strict: false,
    });

    if (Config.flags.enableBeatModsCompatibility) {
        new BeatModsRoutes(app, v1Router);
    }

    new CreateModRoutes(v3Router);
    new GetModRoutes(v3Router);
    new UpdateProjectRoutes(v3Router);
    new ApprovalRoutes(v3Router);
    new VersionsRoutes(v3Router);
    new MOTDRoutes(v3Router);
    new UserRoutes(v3Router);
    new BulkActionsRoutes(v3Router);

    new AdminRoutes(apiRouter);
    new AuthRoutes([apiRouter, v2Router, v3Router]);
    new StatusRoutes([apiRouter, v2Router, v3Router]);

    v1Router.use((req, res, next) => {
        res.setHeader(`Deprecated`, `true`);
        next();
    });

    v2Router.use((req, res, next) => {
        res.setHeader(`Deprecated`, `true`);
        next();
    });

    apiRouter.use(`/v1`, v1Router);
    apiRouter.use(`/v2`, v2Router);
    apiRouter.use(`/v3`, v3Router);
    apiRouter.use(`/`, v2Router);

    if (Config.flags.enableSwagger) {
        publicApi.servers = [{url: `${Config.server.url}${Config.server.apiRoute}`}];
        fullApi.servers = [{url: `${Config.server.url}${Config.server.apiRoute}`}];
        if (!Config.flags.enableGithubPAT) {
        // @ts-expect-error it complains about it not being undefineable. this just in! i dont care.
            publicApi.components.securitySchemes.bearerAuth = undefined;
            // @ts-expect-error it complains about it not being undefineable.
            fullApi.components.securitySchemes.bearerAuth = undefined;
        }
        apiRouter.get(`/swagger/full.json`, (req, res) => {
            res.setHeader(`Cache-Control`, `public, max-age=3600`);
            res.json(fullApi);
        });
        apiRouter.get(`/swagger/public.json`, (req, res) => {
            res.setHeader(`Cache-Control`, `public, max-age=3600`);
            res.json(publicApi);
        });

        type HTTPMethod = OpenAPIV3_1.HttpMethods;
        apiRouter.use(`/docs`, swaggerUi.serve, swaggerUi.setup(undefined, {
            explorer: true,
            swaggerOptions: {
                /*operationsSorter: (a: any, b: typeof a) => {
                    //console.log(a);
                    let methodOrder = { 'get': 0, 'post': 1, 'put': 2, 'delete': 4, 'patch': 3, 'head': 5, 'options': 6, 'trace': 7 };
                    let method = methodOrder[a.get(`method`) as HTTPMethod] - methodOrder[b.get(`method`) as HTTPMethod];
                    if (method !== 0) {
                        return method;
                    }
                    let path = a.get(`path`).localeCompare(b.get(`path`));
                    if (path !== 0) {
                        return path;
                    }
                    return 0;
                },*/
                docExpansion: `list`,
                urls: [
                    {
                        url: `${Config.server.url}${Config.server.apiRoute}/swagger/full.json`,
                        name: `Full API`
                    },
                    {
                        url: `${Config.server.url}${Config.server.apiRoute}/swagger/public.json`,
                        name: `Public API`,
                    }
                ],
            }
        }));
    }

    if (Config.flags.enableFavicon) {
        app.get(`/favicon.ico`, cdnRateLimiter, (req, res) => {
        // #swagger.ignore = true;
            res.sendFile(path.resolve(`./assets/favicon.png`), {
                maxAge: 1000 * 60 * 60 * 24 * 1,
                //immutable: true,
                lastModified: true,
            });
        });
    }
        
    if (Config.flags.enableBanner) {
    // #swagger.ignore = true;
        app.get(`/banner.png`, cdnRateLimiter, (req, res) => {
            res.sendFile(path.resolve(`./assets/banner.png`), {
                maxAge: 1000 * 60 * 60 * 24 * 1,
                //immutable: true,
                lastModified: true,
            });
        });
    }

    if (Config.devmode && fs.existsSync(path.resolve(`./storage/frontend`))) {
        app.use(`/`, cdnRateLimiter, express.static(path.resolve(`./storage/frontend`), {
            dotfiles: `ignore`,
            immutable: false,
            index: true,
            maxAge: 1000 * 60 * 60 * 1,
            fallthrough: true,
        }));
    }

    new CDNRoutes(cdnRouter, cdnRateLimiter);

    app.use(Config.server.apiRoute, apiRouter);
    app.use(Config.server.cdnRoute, cdnRouter);

    app.disable(`x-powered-by`);
    // catch all unknown routes and return a 404
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    apiRouter.use((req, res, next) => {
        return res.status(404).send({message: `Unknown route.`});
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cdnRouter.use((req, res, next) => {
        return res.status(404).send({message: `Unknown route.`});
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    apiRouter.use((err:any, req:any, res:any, next:any) => {
        Logger.error(err.stack);
        return res.status(500).send({message: `Server error`});
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cdnRouter.use((err:any, req:any, res:any, next:any) => {
        Logger.error(err.stack);
        return res.status(500).send({message: `Server error`});
    });


    process.on(`exit`, (code) => {
        Logger.log(`Process exiting with code ${code}`);
    });

    process.on(`SIGTERM`, () => {
        Logger.log(`Received SIGTERM, exiting.`);
        DatabaseHelper.database.sequelize.close();
        process.exit(0);
    });

    process.on(`SIGINT`, () => {
        Logger.log(`Received SIGINT, exiting.`);
        DatabaseHelper.database.sequelize.close();
        process.exit(0);
    });

    process.on(`SIGQUIT`, () => {
        Logger.log(`Received SIGQUIT, exiting.`);
        DatabaseHelper.database.sequelize.close();
        process.exit(0);
    });

    
    process.on(`unhandledRejection`, (reason: Error | any, promise: Promise<any>) => {
        if (reason instanceof Error) {
            Logger.error(`Unhandled promise rejection:${reason.name}\n${reason.message}\n${reason.stack}`);
        } else {
            Logger.error(`Unhandled promise rejection:${reason}\n`);
        }
        if (process.env.NODE_ENV == `test`) {
            throw reason;
        } else {
            process.exit(1);
        }
    });


    Logger.debug(`Setup complete.`);
    return {app, database, port};
}

export async function startServer() {
    const {app, database, port} = init();
    if (process.env.NODE_ENV === `test`) {
        Logger.debug(`Running in test mode.`);
    }
    await database.init();
    Logger.debug(`Starting server.`);
    const server = app.listen(port, () => {
        Logger.log(`Server listening on port ${port} - Expected to be available at ${Config.server.url}`, ``, true);
        Config.devmode ? Logger.warn(`Development mode is enabled!`) : null;
        Config.authBypass ? Logger.warn(`Authentication bypass is enabled!`) : null;
        Logger.debug(`API docs @ http://localhost:${port}/api/docs`);
        Logger.log(`Server started.`);
    });
    
    let luma = undefined;
    if (Config.bot.enabled) {
        luma = new Luma({
            intents: [],
            presence: {activities: [{name: `with your mods`, type: ActivityType.Playing}], status: `online`}});
        luma.login(Config.bot.token);
    }

    let stopServer = async (doExit = true, code = 0) => {
        let promises = [];
        promises.push(database.sequelize.close());
        server?.closeAllConnections();
        server?.close();
        promises.push(luma?.destroy());

        await Promise.all(promises).then(() => {
            doExit ? process.exit(code) : undefined;
        });
    };

    return {app, server, database, stopServer};
}

if (process.env.NODE_ENV !== `test`) {
    startServer();
}