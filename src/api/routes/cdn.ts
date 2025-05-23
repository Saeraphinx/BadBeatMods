import { Router } from 'express';
import express from 'express';
import path from 'path';
import { Config } from '../../shared/Config.ts';
import { DatabaseHelper } from '../../shared/Database.ts';
import { Logger } from '../../shared/Logger.ts';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

export class CDNRoutes {
    private router: Router;
    private ratelimiter: RateLimitRequestHandler;

    constructor(router: Router, ratelimiter: RateLimitRequestHandler) {
        this.router = router;
        this.ratelimiter = ratelimiter;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.use(`/icon`, this.ratelimiter, express.static(path.resolve(Config.storage.iconsDir), {
            extensions: [`png`],
            dotfiles: `ignore`,
            immutable: true,
            index: false,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            fallthrough: true,
        }));
        
        this.router.use(`/mod`, this.ratelimiter, express.static(path.resolve(Config.storage.modsDir), {
            extensions: [`zip`],
            dotfiles: `ignore`,
            immutable: true,
            index: false,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            setHeaders: (res, file) => {
                res.set(`Content-Type`, `application/zip`);
                if (res.req.headers[`cf-worker`]) {
                    return;
                }
                let hash = path.basename(file).replace(path.extname(file), ``);
                let modVersion = DatabaseHelper.cache.modVersions.find((version) => version.zipHash === hash);
                if (modVersion) {
                    let mod = DatabaseHelper.mapCache.mods.get(modVersion.modId);
                    if (mod) {
                        res.set(`Content-Disposition`, `attachment; filename="${mod.name} v${modVersion.modVersion}.zip"`);
                    } else {
                        res.set(`Content-Disposition`, `attachment;`);
                    }
                    modVersion.increment(`downloadCount`, { silent: true }).catch((err) => {
                        Logger.error(`Failed to increment download count for mod version ${modVersion.id}: ${err}`);
                    });
                } else {
                    res.set(`Content-Disposition`, `attachment;`);
                }
            },
            fallthrough: true,
        }));

        this.router.get(`/inc/mod/:hash`, rateLimit({
            windowMs: 1000 * 30,
            max: 200,
            statusCode: 429,
            message: {message: `Too many requests`}
        }), async (req, res) => {
            // #swagger.ignore = true
            if (!Config.server.cfwSecret || Config.server.cfwSecret === ``) {
                return res.status(400).json({
                    message: `Endpoint not available`,
                });
            }
            if (!req.headers[`cf-worker`]) {
                return res.status(403).json({
                    message: `Forbidden request`,
                });
            }
            if (req.headers[`x-cfw-secret`] !== Config.server.cfwSecret) {
                return res.status(403).json({
                    message: `Forbidden request`,
                });
            }
            let hash = req.params.hash;
            let fileName = `${hash}.zip`;
            let modVersion = DatabaseHelper.cache.modVersions.find((version) => version.zipHash === hash);
            if (modVersion) {
                let mod = DatabaseHelper.mapCache.mods.get(modVersion.modId);
                if (mod) {
                    fileName = `${mod.name} v${modVersion.modVersion}.zip`;
                }
                modVersion.increment(`downloadCount`, { silent: true }).catch((err) => {
                    Logger.error(`Failed to increment download count for mod version ${modVersion.id}: ${err}`);
                });
            }

            res.status(200).json({
                fileName: fileName,
            });
        });
    }
}