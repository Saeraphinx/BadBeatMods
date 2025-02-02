import * as fs from 'fs';
import * as path from 'path';
import { HTTPTools } from './HTTPTools';

// This is a simple config loader that reads from a JSON file and maps the values to a static class. It's a little excessive but this way the config is clearly communicated, and is available without a refrence to the file itself.
// To add a config option, add it to the DEFAULT_CONFIG object, and add a property to the Config class with the same name. The Config class will automatically load the config from the file and map it to the static properties.
const CONFIG_PATH = path.resolve(`./storage/config.json`);
const DEFAULT_CONFIG = {
    auth: {
        discord: {
            clientId: `DISCORD_CLIENT_ID`,
            clientSecret: `DISCORD_CLIENT_SECRET`
        },
        github: {
            clientId: `GITHUB_CLIENT_ID`,
            clientSecret: `GITHUB_CLIENT_SECRET`
        },
        permittedRedirectDomains: [`http://localhost:5173`, `http://localhost:4173`, `http://localhost:5001`, `http://localhost:3000`] // urls that are allowed to redirect to after auth
    },
    database: {
        dialect: `sqlite`, // sqlite or postgres
        url: `./storage/database.sqlite`, // path to sqlite database, or host of the postgres database
        port: 5432, // only used for postgres
        username: `user`,
        password: `password`,
        alter: false // alters the database schema on startup. i dont think this works with postgres. is not recommended for production.
    },
    storage: {
        modsDir: `./storage/uploads`,
        iconsDir: `./storage/icons`,
        sessions: `./storage/sessions.sqlite` // only used if storeSessions is true
    },
    devmode: false, // enables devmode features + increased logging
    authBypass: false, // bypasses auth for all routes. uses ServerAdmin user.
    server: {
        port: 5001, // port to run the server on
        url: `http://localhost:5001`, // base url of the api wihtout the trailing slash or /api part. used for internal testing & swagger docs
        storeSessions: false, // stores sessions in a database. untested.
        sessionSecret: `supersecret`, // secret for the session cookie
        iHateSecurity: false, //sets cookies to insecure & allows cors auth from all origins listed in corsOrigins (cannot be a wildcard)
        corsOrigins: `*`, // can be a string or an array of strings. this is the setting for all endpoints
        apiRoute: `/api`, // the base route for the api. no trailing slash
        cdnRoute: `/cdn` // the base route for the cdn. no trailing slash
        fileUploadLimitMB: 150, // the file size limit for mod uploads
        fileWarningSizeMB: 50 // a recommended file size to warn if a mod is over
    },
    webhooks: {
        // If you don't want to use the webhook, just leave it blank. if a urls is under 8 characters, it will be ignored.
        enableWebhooks: false, // acts as a sort of master switch for all webhooks. useful for dev when you dont want to deal with webhooks.
        loggingUrl: ``, // url for logging - sensitive data might be sent here
        modLogUrl: ``, // url for mod logging - new, approvals, and rejections
        modLog2Url: ``, // same as above
        publicUrl: `` // url for public webhook - approved mods only... might have a delay? hasn't been done yet.
    },
    bot: {
        enabled: false,
        clientId: `BOT_CLIENT_ID`,
        token: `BOT_TOKEN`
    },
    flags: {
        enableBeatModsDownloads: true, // enables downloading mods from BeatMods
        enableBeatModsCompatibility: true, // enables all of the endpoints structured to be compatible with BeatMods
        enableBeatModsRouteCompatibility: true, // enables the BeatMods route compatibility (e.g. force hosts /api/v1/mods, /versions.json, and /aliases.json). enableBeatModsCompatibility must be enabled for this to work.
        logRawSQL: false, // logs raw SQL queries to the console
        enableFavicon: false, // enables the favicon route /favicon.ico
        enableBanner: false, // enables the banner route /banner.png
        enableSwagger: true, // enables the swagger docs at /api/docs
        enableDBHealthCheck: false, // enables the database health check
    }
};


export class Config {
    // #region Private Static Properties
    private static _auth: {
        discord: AuthServiceConfig;
        github: AuthServiceConfig;
        permittedRedirectDomains: string[];
    };
    private static _database: {
        dialect: string;
        url: string;
        port: number;
        username: string;
        password: string;
        alter: boolean;
    };
    private static _storage: {
        modsDir: string;
        iconsDir: string;
        sessions: string;
    };
    private static _server: {
        port: number;
        url: string;
        storeSessions: boolean;
        sessionSecret: string;
        iHateSecurity: boolean;
        corsOrigins: string | string[];
        apiRoute: string;
        cdnRoute: string;
        fileUploadLimitMB: number;
        fileWarningSizeMB: number;
    };
    private static _devmode: boolean = DEFAULT_CONFIG.devmode;
    private static _authBypass: boolean = DEFAULT_CONFIG.authBypass;
    private static _webhooks: {
        enableWebhooks: boolean;
        loggingUrl: string;
        modLogUrl: string;
        modLog2Url: string;
        publicUrl: string;
    };
    private static _bot: {
        enabled: boolean;
        clientId: string;
        token: string;
    };
    private static _flags: {
        enableBeatModsDownloads: boolean;
        enableBeatModsCompatibility: boolean;
        enableBeatModsRouteCompatibility: boolean;
        logRawSQL: boolean;
        enableFavicon: boolean;
        enableBanner: boolean;
        enableSwagger: boolean;
        enableDBHealthCheck: boolean;
    };
    // #endregion
    // #region Public Static Properties
    public static get auth() {
        return this._auth;
    }
    public static get database() {
        return this._database;
    }
    public static get storage() {
        return this._storage;
    }
    public static get server() {
        return this._server;
    }
    public static get devmode() {
        return this._devmode;
    }
    public static get authBypass() {
        return this._authBypass;
    }
    public static get webhooks() {
        return this._webhooks;
    }
    public static get bot() {
        return this._bot;
    }
    public static get flags() {
        return this._flags;
    }
    // #endregion
    constructor() {
        if (process.env.IS_DOCKER !== `true` && fs.existsSync(CONFIG_PATH)) {
            console.log(`Loading config using config file.`);
            let success = Config.loadConfigFromFile(CONFIG_PATH);
            if (success.length > 0) {
                console.error(`Config file is invalid at keys ${success.join(`, `)}.`);
                if (!fs.existsSync(path.resolve(`./storage`))) {
                    fs.mkdirSync(path.resolve(`./storage`));
                }
    
                if (fs.existsSync(path.resolve(`./storage/config.json`))) {
                    console.log(`Backing up existing config file...`);
                    let generateedId = new Date().getTime();
                    if (fs.existsSync(path.resolve(`./storage/config.json-${generateedId}.bak`))) {
                        fs.unlinkSync(path.resolve(`./storage/config.json-${generateedId}.bak`));
                    }
                    fs.renameSync(path.resolve(`./storage/config.json`), path.resolve(`./storage/config.json-${generateedId}.bak`));
                    console.warn(`Config file was invalid. A merge will be attempted. The old config has been backed up.`);
                    let mergeResults = Config.mergeConfig(path.resolve(`./storage/config.json-${generateedId}.bak`));
                    if (!mergeResults) {
                        console.error(`Errors occurred while merging the config file. Please check the config file and try again.`);
                        process.exit(1);
                    }
                } else {
                    console.warn(`Config file not found. A new one has been created.`);
                    fs.writeFileSync(path.resolve(`./storage/config.json`), JSON.stringify(DEFAULT_CONFIG, null, 2));
                }
    
                let successpart2 = Config.loadConfigFromFile(CONFIG_PATH);
                if (successpart2.length > 0) {
                    console.error(`Config file is invalid at keys ${success.join(`, `)}. Please check the config file and try again.`);
                    process.exit(1);
                }
            }
        } else {
            console.log(`Loading config using environment variables.`);
            let disableDefaults = process.env.DISABLE_DEFAULTS === `true`;
            let success = Config.loadConfigFromEnv();
            if (success.length > 0) {
                if (success.includes(`all`)) {
                    console.error(`Error loading config from environment variables. Please check the environment variables and try again.`);
                    process.exit(1);
                }

                console.warn(`Config is invalid or missing at keys ${success.join(`, `)}.`);
                if (disableDefaults) {
                    console.error(`Defaults are disabled, and the config file was invalid. Please check the config file and try again.`);
                    process.exit(1);
                }
            }
        }
        

        if (!fs.existsSync(path.resolve(Config.storage.modsDir))) {
            console.log(`Creating mods directory at ${path.resolve(Config.storage.modsDir)}`);
            fs.mkdirSync(path.resolve(Config.storage.modsDir));
        }

        if (!fs.existsSync(path.resolve(Config.storage.iconsDir))) {
            console.log(`Creating icons directory at ${path.resolve(Config.storage.iconsDir)}`);
            fs.mkdirSync(path.resolve(Config.storage.iconsDir));
        }
    }

    private static loadConfigFromFile(configPath: string = CONFIG_PATH): string[] {
        console.log(`Loading config file from ${configPath}`);
        if (fs.existsSync(configPath)) {
            let file = fs.readFileSync(configPath, `utf8`);
            let cf = JSON.parse(file);
            let failedToLoad: string[] = [];
            try {
                if (`flags` in cf) {
                    if (!doObjKeysMatch(cf.flags, DEFAULT_CONFIG.flags)) {
                        failedToLoad.push(`flags`);
                    } else {
                        Config._flags = cf.flags;
                    }
                } else {
                    failedToLoad.push(`auth`);
                }

                if (`auth` in cf) {
                    if (!doObjKeysMatch(cf.auth, DEFAULT_CONFIG.auth)) {
                        failedToLoad.push(`auth`);
                    } else {
                        Config._auth = cf.auth;
                    }
                } else {
                    failedToLoad.push(`auth`);
                }

                if (`database` in cf) {
                    if (!doObjKeysMatch(cf.database, DEFAULT_CONFIG.database)) {
                        failedToLoad.push(`database`);
                    } else {
                        Config._database = cf.database;
                    }
                } else {
                    failedToLoad.push(`database`);
                }

                if (`storage` in cf) {
                    if (!doObjKeysMatch(cf.storage, DEFAULT_CONFIG.storage)) {
                        failedToLoad.push(`storage`);
                    } else {
                        Config._storage = cf.storage;
                    }
                } else {
                    failedToLoad.push(`storage`);
                }

                if (`server` in cf) {
                    if (!doObjKeysMatch(cf.server, DEFAULT_CONFIG.server)) {
                        failedToLoad.push(`server`);
                    } else {
                        Config._server = cf.server;
                    }
                } else {
                    failedToLoad.push(`server`);
                }

                //is a boolean
                if (`devmode` in cf) {
                    Config._devmode = cf.devmode;
                } else {
                    failedToLoad.push(`devmode`);
                }

                //is a boolean
                if (`authBypass` in cf) {
                    Config._authBypass = cf.authBypass;
                } else {
                    failedToLoad.push(`authBypass`);
                }

                if (`webhooks` in cf) {
                    if (!doObjKeysMatch(cf.webhooks, DEFAULT_CONFIG.webhooks)) {
                        failedToLoad.push(`webhooks`);
                    } else {
                        Config._webhooks = cf.webhooks;
                    }
                } else {
                    failedToLoad.push(`webhooks`);
                }

                if (`bot` in cf) {
                    if (!doObjKeysMatch(cf.bot, DEFAULT_CONFIG.bot)) {
                        failedToLoad.push(`bot`);
                    } else {
                        Config._bot = cf.bot;
                    }
                } else {
                    failedToLoad.push(`bot`);
                }
                return failedToLoad;
            } catch (e) {
                console.error(`Error parsing config file: ${e}`);
                return [`all`];
            }
        } else {
            console.warn(`Config file not found.`);
            return [`all`];
        }
    }

    private static loadConfigFromEnv(): string[] {
        let failedToLoad: string[] = [];

        for (let key of Object.keys(DEFAULT_CONFIG)) {
            // @ts-expect-error 7046
            Config[`_${key}`] = DEFAULT_CONFIG[key];
        }

        Config._server.sessionSecret = HTTPTools.createRandomString(64);

        try {
            // #region Auth
            if (process.env.AUTH_DISCORD_CLIENT_ID && process.env.AUTH_DISCORD_CLIENT_SECRET) {
                Config._auth.discord = {
                    clientId: process.env.AUTH_DISCORD_CLIENT_ID,
                    clientSecret: process.env.AUTH_DISCORD_CLIENT_SECRET
                };
            } else {
                failedToLoad.push(`auth.discord`);
            }

            if (process.env.AUTH_GITHUB_CLIENT_ID && process.env.AUTH_GITHUB_CLIENT_SECRET) {
                Config._auth.github = {
                    clientId: process.env.AUTH_GITHUB_CLIENT_ID,
                    clientSecret: process.env.AUTH_GITHUB_CLIENT_SECRET
                };
            } else {
                failedToLoad.push(`auth.github`);
            }

            if (process.env.AUTH_PERMITTEDREDIRECTDOMAINS) {
                Config._auth.permittedRedirectDomains = process.env.AUTH_PERMITTEDREDIRECTDOMAINS.split(`,`);
            } else {
                failedToLoad.push(`auth.permittedRedirectDomains`);
            }
            // #endregion
            // #region Database
            if (process.env.DATABASE_DIALECT) {
                Config._database.dialect = process.env.DATABASE_DIALECT;
            } else {
                failedToLoad.push(`database.dialect`);
            }

            if (process.env.DATABASE_URL) {
                Config._database.url = process.env.DATABASE_URL;
            } else {
                failedToLoad.push(`database.url`);
            }

            if (process.env.DATABASE_PORT) {
                Config._database.port = parseInt(process.env.DATABASE_PORT);
            } else {
                failedToLoad.push(`database.port`);
            }

            if (process.env.DATABASE_USERNAME) {
                Config._database.username = process.env.DATABASE_USERNAME;
            } else {
                failedToLoad.push(`database.username`);
            }

            if (process.env.DATABASE_PASSWORD) {
                Config._database.password = process.env.DATABASE_PASSWORD;
            } else {
                failedToLoad.push(`database.password`);
            }

            if (process.env.DATABASE_ALTER) {
                Config._database.alter = process.env.DATABASE_ALTER === `true`;
            } else {
                failedToLoad.push(`database.alter`);
            }
            // #endregion
            // #region Storage
            if (process.env.STORAGE_MODSDIR) {
                Config._storage.modsDir = process.env.STORAGE_MODSDIR;
            } else {
                failedToLoad.push(`storage.modsDir`);
            }

            if (process.env.STORAGE_ICONSDIR) {
                Config._storage.iconsDir = process.env.STORAGE_ICONSDIR;
            } else {
                failedToLoad.push(`storage.iconsDir`);
            }

            if (process.env.STORAGE_SESSIONS) {
                Config._storage.sessions = process.env.STORAGE_SESSIONS;
            } else {
                failedToLoad.push(`storage.sessions`);
            }
            // #endregion
            // #region Server & Devmode & authBypass
            if (process.env.DEVMODE) {
                Config._devmode = process.env.DEVMODE === `true`;
            } else {
                failedToLoad.push(`devmode`);
            }

            if (process.env.AUTH_BYPASS) {
                Config._authBypass = process.env.AUTH_BYPASS === `true`;
            } else {
                failedToLoad.push(`authBypass`);
            }

            if (process.env.SERVER_PORT) {
                Config._server.port = parseInt(process.env.SERVER_PORT, 10);
            } else {
                failedToLoad.push(`server.port`);
            }

            if (process.env.SERVER_URL) {
                Config._server.url = process.env.SERVER_URL;
            } else {
                failedToLoad.push(`server.url`);
            }

            if (process.env.SERVER_STORESESSIONS) {
                Config._server.storeSessions = process.env.SERVER_STORESESSIONS === `true`;
            } else {
                failedToLoad.push(`server.storeSessions`);
            }

            if (process.env.SERVER_SESSION_SECRET) {
                Config._server.sessionSecret = process.env.SERVER_SESSION_SECRET;
            } else {
                failedToLoad.push(`server.sessionSecret`);
            }

            if (process.env.SERVER_IHATESECURITY) {
                Config._server.iHateSecurity = process.env.SERVER_IHATESECURITY === `true`;
            } else {
                failedToLoad.push(`server.iHateSecurity`);
            }

            if (process.env.SERVER_CORSORIGINS) {
                Config._server.corsOrigins = process.env.SERVER_CORSORIGINS.split(`,`);
            } else {
                failedToLoad.push(`server.corsOrigins`);
            }

            if (process.env.SERVER_APIROUTE) {
                Config._server.apiRoute = process.env.SERVER_APIROUTE;
            } else {
                failedToLoad.push(`server.apiRoute`);
            }

            if (process.env.SERVER_CDNROUTE) {
                Config._server.cdnRoute = process.env.SERVER_CDNROUTE;
            } else {
                failedToLoad.push(`server.cdnRoute`);
            }

            if (process.env.SERVER_FILE_UPLOAD_LIMIT_MB) {
                Config.server.fileUploadLimitMB= parseInt(process.env.SERVER_FILE_UPLOAD_LIMIT_MB);
            } else {
                failedToLoad.push(`fileUploadLimitMB`);
            }

            if (process.env.SERVER_FILE_WARNING_SIZE_MB) {
                Config.server.fileWarningSizeMB= parseInt(process.env.SERVER_FILE_WARNING_SIZE_MB);
            } else {
                failedToLoad.push(`fileWarningSizeMB`);
            }
            // #endregion
            // #region Webhooks
            if (process.env.WEBHOOKS_ENABLEWEBHOOKS) {
                Config._webhooks.enableWebhooks = process.env.WEBHOOKS_ENABLEWEBHOOKS === `true`;
            } else {
                failedToLoad.push(`webhooks.enableWebhooks`);
            }

            if (process.env.WEBHOOKS_LOGGINGURL) {
                Config._webhooks.loggingUrl = process.env.WEBHOOKS_LOGGINGURL;
            } else {
                failedToLoad.push(`webhooks.loggingUrl`);
            }

            if (process.env.WEBHOOKS_MODLOGURL) {
                Config._webhooks.modLogUrl = process.env.WEBHOOKS_MODLOGURL;
            } else {
                failedToLoad.push(`webhooks.modLogUrl`);
            }

            if (process.env.WEBHOOKS_MODLOG2URL) {
                Config._webhooks.modLog2Url = process.env.WEBHOOKS_MODLOG2URL;
            } else {
                failedToLoad.push(`webhooks.modLog2Url`);
            }

            if (process.env.WEBHOOKS_PUBLICURL) {
                Config._webhooks.publicUrl = process.env.WEBHOOKS_PUBLICURL;
            } else {
                failedToLoad.push(`webhooks.publicUrl`);
            }
            // #endregion
            // #region Bot
            if (process.env.BOT_ENABLED) {
                Config._bot.enabled = process.env.BOT_ENABLED === `true`;
            } else {
                failedToLoad.push(`bot.enabled`);
            }

            if (process.env.BOT_CLIENT_ID) {
                Config._bot.clientId = process.env.BOT_CLIENT_ID;
            } else {
                failedToLoad.push(`bot.clientId`);
            }

            if (process.env.BOT_TOKEN) {
                Config._bot.token = process.env.BOT_TOKEN;
            } else {
                failedToLoad.push(`bot.token`);
            }
            // #endregion
            // #region Flags
            if (process.env.FLAGS_ENABLEBEATMODSDOWNLOADS) {
                Config._flags.enableBeatModsDownloads = process.env.FLAGS_ENABLEBEATMODSDOWNLOADS === `true`;
            } else {
                failedToLoad.push(`flags.enableBeatModsDownloads`);
            }

            if (process.env.FLAGS_ENABLEBEATMODSCOMPATIBILITY) {
                Config._flags.enableBeatModsCompatibility = process.env.FLAGS_ENABLEBEATMODSCOMPATIBILITY === `true`;
            } else {
                failedToLoad.push(`flags.enableBeatModsCompatibility`);
            }

            if (process.env.FLAGS_ENABLEBEATMODSROUTECOMPATIBILITY) {
                Config._flags.enableBeatModsCompatibility = process.env.FLAGS_ENABLEBEATMODSROUTECOMPATIBILITY === `true`;
            } else {
                failedToLoad.push(`flags.enableBeatModsCompatibility`);
            }

            if (process.env.FLAGS_LOGRAWSQL) {
                Config._flags.logRawSQL = process.env.FLAGS_LOGRAWSQL === `true`;
            } else {
                failedToLoad.push(`flags.logRawSQL`);
            }

            if (process.env.FLAGS_ENABLEFAVICON) {
                Config._flags.enableFavicon = process.env.FLAGS_ENABLEFAVICON === `true`;
            } else {
                failedToLoad.push(`flags.enableFavicon`);
            }

            if (process.env.FLAGS_ENABLEBANNER) {
                Config._flags.enableBanner = process.env.FLAGS_ENABLEBANNER === `true`;
            } else {
                failedToLoad.push(`flags.enableBanner`);
            }

            if (process.env.FLAGS_ENABLESWAGGER) {
                Config._flags.enableSwagger = process.env.FLAGS_ENABLESWAGGER === `true`;
            } else {
                failedToLoad.push(`flags.enableSwagger`);
            }

            if (process.env.FLAGS_ENABLEDBHEALTHCHECK) {
                Config._flags.enableDBHealthCheck = process.env.FLAGS_ENABLEDBHEALTHCHECK === `true`;
            } else {
                failedToLoad.push(`flags.enableDBHealthCheck`);
            }
            // #endregion

            return failedToLoad;
        } catch (e) {
            console.error(`Error parsing environment variables: ${e}`);
            return [... failedToLoad, `all`];
        }
    }

    private static mergeConfig(configPath: string = `./storage/config.json`): boolean {
        let cf = JSON.parse(fs.readFileSync(path.resolve(configPath), `utf8`)) as any;
        try {
            for (let defaultKey of Object.keys(DEFAULT_CONFIG)) {
                // @ts-expect-error 7053
                let subObj = DEFAULT_CONFIG[defaultKey];
                if (typeof subObj === `object` && Array.isArray(subObj) === false) {
                    for (let subkey of Object.keys(subObj)) {
                        if (typeof subObj[subkey] === `object` && Array.isArray(subObj[subkey]) === false) {
                            for (let subkey2 of Object.keys(subObj[subkey])) {
                                if (cf[defaultKey][subkey][subkey2] === undefined || cf[defaultKey][subkey][subkey2] === null) {
                                    cf[defaultKey][subkey][subkey2] = subObj[subkey][subkey2];
                                }
                            }
                        } else {
                            if (cf[defaultKey][subkey] === undefined) {
                                cf[defaultKey][subkey] = subObj[subkey];
                            }
                        }
                    }
                } else {
                    if (cf[defaultKey] === undefined) {
                        cf[defaultKey] = subObj;
                    }
                }
            }
        } catch (e) {
            console.error(`Error merging config file: ${e}`);
            return false;
        }

        try {
            fs.writeFileSync(path.resolve(`./storage/config.json`), JSON.stringify(cf, null, 2));
        } catch (e) {
            console.error(`Error writing config file: ${e}`);
            return false;
        }

        return true;
    }
}

function doObjKeysMatch(obj1: any, obj2: any): boolean {
    for (let key of Object.keys(obj1)) {
        if (typeof obj1[key] === `object` && Array.isArray(obj1[key]) === false) {
            let subkeys = doObjKeysMatch(obj1[key], obj2[key]);
            if (!subkeys) {
                return false;
            }
        } else {
            if (!Object.keys(obj2).includes(key)) {
                return false;
            }
        }
    }

    for (let key of Object.keys(obj2)) {
        if (typeof obj2[key] === `object` && Array.isArray(obj1[key]) === false) {
            let subkeys = doObjKeysMatch(obj2[key], obj1[key]);
            if (!subkeys) {
                return false;
            }
        } else {
            if (!Object.keys(obj1).includes(key)) {
                return false;
            }
        }
    }
    return true;
}

interface AuthServiceConfig {
    clientId: string;
    clientSecret: string;
}