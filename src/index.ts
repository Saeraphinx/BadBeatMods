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

import { DatabaseHelper, DatabaseManager } from './shared/Database';
import { Logger } from './shared/Logger';
import { Config } from './shared/Config';
import { Luma } from './discord/classes/Luma';

import { CreateModRoutes } from './api/routes/createMod';
import { GetModRoutes } from './api/routes/getMod';
import { UpdateModRoutes } from './api/routes/updateMod';
import { AuthRoutes } from './api/routes/auth';
import { VersionsRoutes } from './api/routes/versions';
import { ImportRoutes } from './api/routes/import';
import { AdminRoutes } from './api/routes/admin';
import { ApprovalRoutes } from './api/routes/approval';
import { BeatModsRoutes } from './api/routes/beatmods';
import { CDNRoutes } from './api/routes/cdn';
import { MOTDRoutes } from './api/routes/motd';
import { UserRoutes } from './api/routes/users';
import { StatusRoutes } from './api/routes/status';
import { BulkActionsRoutes } from './api/routes/bulkActions';

import swaggerDocument from './api/swagger.json';

console.log(`Starting setup...`);
new Config();
const app = express();
const memstore = MemoryStore(session);
const port = Config.server.port;
let database = new DatabaseManager();

// handle parsing request bodies
app.use(express.json({ limit: 100000 }));
app.use(express.urlencoded({limit : 10000, parameterLimit: 10, extended: false }));
app.use(cors({
    origin: Config.server.corsOrigins,
    credentials: Config.server.iHateSecurity ? true : false,
}));
app.use(fileUpload({
    limits: {            // allow 3x limit for users with LargeFiles role. (File size is checked again later at the limit)
        fileSize: Config.server.fileUploadLimitMB * 3 * 1024 * 1024, // here you go kaitlyn
        files: 1
    },
    abortOnLimit: true,
}));

const sessionConfigData: SessionOptions = {
    secret: Config.server.sessionSecret,
    name: `bbm_session`,
    resave: false,
    saveUninitialized: false,
    unset: `destroy`,
    cookie: {
        maxAge: 86400000,
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

app.use(session(sessionConfigData));

app.set(`trust proxy`, true);

app.use((req, res, next) => {
    if (Config.devmode) {
        if (Config.authBypass) {
            req.session.userId = 1;
        }
        if (!req.url.includes(`hashlookup`)) {
            console.log(req.url);
        }
    }
    next();
});

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
    swaggerDocument.servers = [{url: `${Config.server.url}${Config.server.apiRoute}`}];
    apiRouter.use(`/docs`, swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
        swaggerOptions: {
            docExpansion: `list`,
            defaultModelExpandDepth: 2,
            defaultModelsExpandDepth: 2,
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
    console.error(err.stack);
    return res.status(500).send({message: `Server error`});
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
cdnRouter.use((err:any, req:any, res:any, next:any) => {
    console.error(err.stack);
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
        Logger.error(`Unhandled promise rejection:${reason.name}\n${reason.message}\n${reason.stack}`, `node.js`);
    } else {
        Logger.error(`Unhandled promise rejection:${reason}\n`, `node.js`);
    }
    process.exit(1);
});

console.log(`Setup complete.`);

async function startServer() {
    await database.init();
    console.log(`Starting server.`);
    app.listen(port, () => {
        console.log(`Server listening on port ${port} - Expected to be available at ${Config.server.url}`);
        Config.devmode ? Logger.warn(`Development mode is enabled!`) : null;
        Config.authBypass ? Logger.warn(`Authentication bypass is enabled!`) : null;
        Config.devmode ? console.log(`API docs @ http://localhost:${port}/api/docs`) : null;
    });
    
    if (Config.bot.enabled) {
        const luma = new Luma({
            intents: [],
            presence: {activities: [{name: `with your mods`, type: ActivityType.Playing}], status: `online`}});
        luma.login(Config.bot.token);
    }
}
startServer();