/* eslint-disable @typescript-eslint/no-unused-vars */ // disabled for the whole file because the functions almost all have unused parameters
import { Config } from "../shared/Config.ts";
import * as Winston from "winston";
import { DiscordTransport } from "winston-transport-discord";

export class Logger {
    public static winston: Winston.Logger;

    constructor() {
        Logger.init();
    }

    public static init() {
        let transports: Winston.transport[] = [];
        if (Config.webhooks.enableWebhooks && Config.webhooks.loggingUrl.length > 8) {
            transports.push(new DiscordTransport({
                level: `info`,
                silent: process.env.NODE_ENV == `test`,
                discord: {
                    webhook: {
                        url: Config.webhooks.loggingUrl,
                    },
                },
            }));
        }

        transports.push(new Winston.transports.Console({
            forceConsole: true,
            level: Config.devmode ? `http` : `consoleInfo`,
            silent: process.env.NODE_ENV == `test`,
            consoleWarnLevels: [`consoleWarn`, `warn`, `error`, `debugWarn`],
            format: Winston.format.combine(
                Winston.format.timestamp({ format: `MM/DD/YY HH:mm:ss` }),
                Winston.format.printf(({ timestamp, level, message }) => {
                    return `[BBM ${level.toUpperCase()}] ${timestamp} > ${message}`;
                })
            )
        }));
        transports.push(new Winston.transports.File({
            filename: `storage/logs/bbm.log`,
            //filename: `storage/logs/${new Date(Date.now()).toLocaleDateString(`en-US`, { year: `numeric`, month: `numeric`, day: `numeric`}).replaceAll(`/`, `-`)}.log`,
            zippedArchive: true,
            maxsize: 20 * 1024 * 1024,
            silent: process.env.NODE_ENV == `test`,
            maxFiles: Config.flags.enableUnlimitedLogs ? undefined : 14,
            level: Config.devmode ? `debug` : `info`,
            format: Winston.format.combine(
                Winston.format.timestamp(),
                Winston.format.json()
            )
        }));

        this.winston = Winston.createLogger({
            level: `info`,
            levels: {
                error: 0,
                warn: 1,
                info: 2,
                consoleWarn: 3,
                consoleInfo: 4,
                debugWarn: 5,
                debug: 6,
                http: 7,
            },
            transports: transports,
        });

        Logger.log(`Logger initialized.`);
    }

    public static debug(message: any, category:string = ``) {
        Logger.winston.log(`debug`, message);
    }

    public static debugWarn(message: any, category:string = ``) {
        Logger.winston.log(`debugWarn`, message);
    }

    public static log(message: any, category:string = ``, consoleOnly: boolean = false) {
        Logger.winston.log(consoleOnly ? `consoleInfo` : `info`, message);
    }

    public static warn(message: any, category:string = ``, consoleOnly: boolean = false) {
        Logger.winston.log(consoleOnly ? `consoleWarn` : `warn`, message);
    }

    public static error(message: any, category:string = ``) {
        Logger.winston.log(`error`, message);
    }

    //compatibility
    public static info(message: any, category:string = ``, consoleOnly: boolean = false) {
        Logger.log(message, category, consoleOnly);
    }

    public info(message: any, category:string = ``, consoleOnly: boolean = false) {
        Logger.info(message, category, consoleOnly);
    }

    public log(message: any, category:string = ``, consoleOnly: boolean = false) {
        Logger.log(message, category, consoleOnly);
    }

    public warn(message: any, category:string = ``, consoleOnly: boolean = false) {
        Logger.warn(message, category, consoleOnly);
    }

    public error(message: any, category:string = ``) {
        Logger.error(message, category);
    }

    public debug(message: any, category:string = ``) {
        Logger.debug(message, category);
    }

    public debugWarn(message: any, category:string = ``) {
        Logger.debugWarn(message, category);
    }
}