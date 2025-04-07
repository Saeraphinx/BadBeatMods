/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import express from 'express';
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

import { CreateModRoutes } from './api/routes/createMod.ts';
import { GetModRoutes } from './api/routes/getMod.ts';
import { UpdateModRoutes } from './api/routes/updateMod.ts';
import { AuthRoutes } from './api/routes/auth.ts';
import { VersionsRoutes } from './api/routes/versions.ts';
import { ImportRoutes } from './api/routes/import.ts';
import { AdminRoutes } from './api/routes/admin.ts';
import { ApprovalRoutes } from './api/routes/approval.ts';
import { BeatModsRoutes } from './api/routes/beatmods.ts';
import { CDNRoutes } from './api/routes/cdn.ts';
import { MOTDRoutes } from './api/routes/motd.ts';
import { UserRoutes } from './api/routes/users.ts';
import { StatusRoutes } from './api/routes/apistatus.ts';
import { BulkActionsRoutes } from './api/routes/bulkActions.ts';

// eslint-disable-next-line quotes
import fullApi from './api/swagger_full.json' with { type: "json" };
// eslint-disable-next-line quotes
import publicApi from './api/swagger_public.json' with { type: "json" };
import { Server } from 'node:http';
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
        max: 200,
        statusCode: 429,
        message: {message: `Rate limit exceeded.`},
        skipSuccessfulRequests: false,
        validate: {trustProxy: false},
    }));

    const cdnRateLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 200,
        statusCode: 429,
        message: `Rate limit exceeded.`,
        skipSuccessfulRequests: false,
        validate: {trustProxy: false},
    });

    cdnRouter.use(cdnRateLimiter);

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
            next();
        } else {
            passport.authenticate(`bearer`, { session: false }, (err:any, user:any) => {
                if (err) {
                    return res.status(401).send({ message: `Unauthorized` });
                }
                if (user && user.id) {
                    req.session.userId = user.id;
                    req.session.goodMorning47YourTargetIsThisSession = true;
                }
                next();
            })(req, res, next);
        }
    });

    app.use((req, res, next) => {
        if (Config.devmode) {
            if (Config.authBypass) {
                req.session.userId = 1;
                req.session.goodMorning47YourTargetIsThisSession = true;
            }
            if (!req.url.includes(`hashlookup`)) {
                Logger.winston.log(`http`, `${req.method} ${req.url}`);
            }
        }
        next();
    });

    //app.use(`/api`, Validator.runValidator);
    if (Config.flags.enableBeatModsCompatibility) {
        new BeatModsRoutes(app, apiRouter);
    }
    new CreateModRoutes(apiRouter);
    new GetModRoutes(apiRouter);
    new UpdateModRoutes(apiRouter);
    new ApprovalRoutes(apiRouter);
    new AuthRoutes(apiRouter);
    new ImportRoutes(apiRouter);
    new AdminRoutes(apiRouter);
    new VersionsRoutes(apiRouter);
    new MOTDRoutes(apiRouter);
    new UserRoutes(apiRouter);
    new StatusRoutes(apiRouter);
    new BulkActionsRoutes(apiRouter);

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

        apiRouter.use(`/docs`, swaggerUi.serve, swaggerUi.setup(undefined, {
            explorer: true,
            swaggerOptions: {
                docExpansion: `list`,
                defaultModelExpandDepth: 2,
                defaultModelsExpandDepth: 2,
                urls: [
                    {
                        url: `${Config.server.url}${Config.server.apiRoute}/swagger/full.json`,
                        name: `Full API`
                    },
                    {
                        url: `${Config.server.url}${Config.server.apiRoute}/swagger/public.json`,
                        name: `Public API`,
                    }
                ]
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

    new CDNRoutes(cdnRouter);

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

    // destroy the auth session if its marked to be destoryed
    app.use((req, res, next) => {
        if (req.session.goodMorning47YourTargetIsThisSession) {
            req.session.destroy((err) => {
                if (err) {
                    Logger.error(`Error destroying session: ${err}`);
                }
            });
        }
        next();
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