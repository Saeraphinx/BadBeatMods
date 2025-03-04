import { Router } from 'express';
import express from 'express';
import path from 'path';
import { Config } from '../../shared/Config.ts';
import { DatabaseHelper } from '../../shared/Database.ts';
import { Logger } from '../../shared/Logger.ts';

export class CDNRoutes {
    private router: Router;

    constructor(router: Router) {
        this.router = router;
        this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.use(`/icon`, express.static(path.resolve(Config.storage.iconsDir), {
            extensions: [`png`],
            dotfiles: `ignore`,
            immutable: true,
            index: false,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            fallthrough: true,
        }));
        
        this.router.use(`/mod`, express.static(path.resolve(Config.storage.modsDir), {
            extensions: [`zip`],
            dotfiles: `ignore`,
            immutable: true,
            index: false,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            setHeaders: (res, file) => {
                res.set(`Content-Type`, `application/zip`);
                let hash = path.basename(file).replace(path.extname(file), ``);
                let modVersion = DatabaseHelper.cache.modVersions.find((version) => version.zipHash === hash);
                if (modVersion) {
                    let mod = DatabaseHelper.cache.mods.find((mod) => mod.id === modVersion.modId);
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
    }
}