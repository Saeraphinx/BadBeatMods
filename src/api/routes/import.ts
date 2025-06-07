// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck i do not gaf about this file anymore since beatmods is dead
/* eslint-disable no-console */ // see above

/*
import { Router } from 'express';
import { validateSession } from '../../shared/AuthHelper.ts';
import { Categories, ContentHash, DatabaseHelper, Project, Version, Platform, SupportedGames, UserRoles, Status } from '../../shared/Database.ts';
import { Logger } from '../../shared/Logger.ts';
import { BeatModsMod } from './beatmods.ts';
import { coerce, satisfies } from 'semver';
import crypto from 'crypto';
import { Config } from '../../shared/Config.ts';
import path from 'path';
import fs from 'fs';
import { exit } from 'process';

export class ImportRoutes {
    private router: Router;
    private readonly ENABLE_DOWNLOADS = Config.flags.enableBeatModsDownloads;

    constructor(router: Router) {
        this.router = router;
        //this.loadRoutes();
    }

    private async loadRoutes() {
        this.router.post(`/beatmods/importAll`, async (req, res) => {
            // #swagger.tags = ['Admin']
            let session = await validateSession(req, res, UserRoles.Admin, null);
            if (!session.user) {
                return;
            }
            
            // oh god oh fuck oh shit
            Logger.log(`Ere Jim, 'ave a seat an' I'll tell you a tale that'll cause your blood to run cold`, `Import`);

            const BeatModsVersions = await fetch(`https://versions.beatmods.com/versions.json`);

            if (BeatModsVersions.status !== 200) {
                return res.status(500).send({ message: `beatmods is dead.`});
            }
            Logger.log(`It was a dark and stormy night, three weeks out of Ilfracombe, Bound for the isle of Lundy`, `Import`);
            const BeatModsVersionData: string[] = await BeatModsVersions.json() as string[];

            if (!BeatModsVersionData || !Array.isArray(BeatModsVersionData)) {
                res.status(500).send({ message: `beatmods is borked`});
            }
            
            Logger.log(`Just east of Devil's Slide, late in the middle watch there was a call from the fore-topsail yard`, `Import`);

            let AllBeatModsMods: BeatModsMod[] = [];
            for (let version of BeatModsVersionData) {
                console.log(`Fetching mods for version ${version}`);
                const BeatModsResponse = await fetch(`https://beatmods.com/api/v1/mod?gameVersion=${encodeURIComponent(version)}`);

                if (BeatModsResponse.status !== 200) {
                    return res.status(500).send({ message: `beatmods is dead.`});
                }

                const BeatModsAPIData: BeatModsMod[] = await BeatModsResponse.json() as BeatModsMod[];

                if (!BeatModsAPIData || !Array.isArray(BeatModsAPIData)) {
                    return res.status(500).send({ message: `beatmods is borked`});
                }

                // turns out you can just do this to reverse the order of the array so that oldest versions are first
                AllBeatModsMods = [...BeatModsAPIData, ...AllBeatModsMods, ];
            }

            Logger.log(`Through the mist and fog, a dark shape emerged, a ghostly figure standing in its helm\nCourse set, intent clear, it bore down upon us`, `Import`);

            let importAuthor = await DatabaseHelper.database.Users.findOne({ where: { username: `BeatMods Import`, githubId: null } }); // this probably won't work

            if (!importAuthor) {
                importAuthor = await DatabaseHelper.database.Users.create({
                    username: `BeatMods Import`,
                    displayName: `BeatMods Import`,
                    bio: `Mods imported from BeatMods`,
                    sponsorUrl: `https://www.patreon.com/c/beatsabermods`,
                    githubId: null,
                    roles: {
                        sitewide: [],
                        perGame: {},
                    }
                });
            } else {
                Logger.warn(`Import author already exists, this is probably bad`, `Import`);
                return res.status(500).send({ message: `Import author already exists, this is probably bad`});
            }
            res.status(200).send({ message: `On the wind, a refrain to strike fear into the heart of any man`});

            Logger.log(`On the wind, a refrain to strike fear into the heart of any man`, `Import`);

            let count = 0;
            let dependancyRecord: { dependancy: BeatModsMod | string, modVersionId: number}[] = [];
            for (const mod of AllBeatModsMods) {
                count++;
                
                if (mod.status == `declined`) {
                    continue;
                }

                let existingMod = await DatabaseHelper.database.Projects.findOne({ where: { name: mod.name } });
                let status = mod.status == `approved` || mod.status == `inactive` ? Status.Verified : Status.Unverified;

                if (!existingMod) {
                    let category = Categories.Other;

                    switch (mod.category) {
                        case `Core`:
                            category = mod.required ? Categories.Core : Categories.Essential;
                            break;
                        case `Cosmetic`:
                            category = Categories.Cosmetic;
                            break;
                        case `Gameplay`:
                            category = Categories.Gameplay;
                            break;
                        case `Practice / Training`:
                            category = Categories.PracticeTraining;
                            break;
                        case `Stream Tools`:
                            category = Categories.StreamTools;
                            break;
                        case `Libraries`:
                            category = Categories.Library;
                            break;
                        case `UI Enhancements`:
                            category = Categories.UIEnhancements;
                            break;
                        case `Tweaks / Tools`:
                            category = Categories.TweaksTools;
                            break;
                        case `Lighting`:
                            category = Categories.Lighting;
                            break;
                        case `Multiplayer`:
                            category = Categories.Multiplayer;
                            break;
                        case `Text Changes`:
                            category = Categories.TextChanges;
                            break;
                        default:
                            category = Categories.Other;
                            break;
                    }

                    existingMod = await DatabaseHelper.database.Projects.create({
                        name: mod.name,
                        summary: mod.description.length > 100 ? mod.description.substring(0, 95) + `...` : mod.description,
                        description: `${mod.description}<br><br>This mod was imported from BeatMods, and was originally uploaded by ${mod.author.username} at ${mod.uploadDate}.`,
                        authorIds: [importAuthor.id],
                        category: category,
                        status: status,
                        iconFileName: `default.png`,
                        gitUrl: mod.link,
                        gameName: SupportedGames.BeatSaber,
                        lastApprovedById: status == Status.Verified ? importAuthor.id : null,
                        lastUpdatedById: importAuthor.id,
                        createdAt: new Date(mod.uploadDate),
                    });
                }

                if (count % 100 == 0) {
                    Logger.log(`${AllBeatModsMods.length - count} mods on the endpoint left`, `Import`);
                } else {
                    Config.devmode ? console.log(`${AllBeatModsMods.length - count} mods on the endpoint left`) : null;
                }

                let dependancies = await this.downloadBeatModsDownloads(existingMod, importAuthor.id, mod);
                dependancyRecord.push(...dependancies);
            }
            Logger.log(`Send them to the depths`, `Import`);

            let count2 = 0;
            for (const record of dependancyRecord) {
                if (typeof record.dependancy === `string`) {
                    Logger.warn(`Dependancy ${record.dependancy} not found for mod ${record.modVersionId}`, `Import`);
                    continue;
                }
                count2 % 1000 == 0 ? console.log(`Resolving dependancy #${count2} of ${dependancyRecord.length}`) : null;
                count2++;
                // get the mod that is being depended on
                let mod = await DatabaseHelper.database.Projects.findOne({ where: { name: record.dependancy.name } });
                if (!mod) {
                    Logger.warn(`Dependancy ${record.dependancy.name} not found for mod ${record.modVersionId}`, `Import`);
                    continue;
                }

                // get all the versions of the denpendancy mod
                let dependancyModVersions = await DatabaseHelper.database.Versions.findAll({ where: { projectId: mod.id } });
                if (!Array.isArray(dependancyModVersions)) {
                    Logger.warn(`Dependancy mod version ${record.dependancy.name} v${record.dependancy.version} not found - Mod obj missing.`, `Import`);
                    continue;
                }

                // get the mod that we need to add the dependancy to (the dependant)
                let modVersion = await DatabaseHelper.database.Versions.findOne({ where: { id: record.modVersionId } });
                if (!modVersion) {
                    Logger.warn(`Mod version ${record.modVersionId} not found`, `Import`);
                    continue;
                }
                
                //this is fucking stupid, why is typescript like this
                let versionToCompare = record.dependancy.version;
                // not particularly happy with this ig its fine
                let dependancyModVersion = dependancyModVersions.find((mV) => {
                    return satisfies(mV.modVersion, `^${versionToCompare}`) &&
                    mV.supportedGameVersionIds.includes(modVersion.supportedGameVersionIds.sort()[0]);
                });
                if (!dependancyModVersion) {
                    let mod = await DatabaseHelper.database.Projects.findOne({ where: { id: modVersion.projectId } });
                    Logger.warn(`No suitable version of dependancy ${record.dependancy.name} v${record.dependancy.version} found for ${mod.name} v${modVersion.modVersion} (ID${record.modVersionId})`, `Import`);
                    continue;
                }

                if (modVersion.dependencies.includes(dependancyModVersion.id)) {
                    Logger.warn(`Mod ${modVersion.id} already has dependancy ${dependancyModVersion.id}`, `Import`);
                    continue;
                }
                //you may think its stupid but they force you to do this. thanks sequelize
                modVersion.dependencies = [...modVersion.dependencies, dependancyModVersion.id];
                await modVersion.save();
            }

            Logger.log(`Just one more bottle of rum`, `Import`);

            await fetch(`https://alias.beatmods.com/aliases.json`).then(async (response) => {
                if (response.status !== 200) {
                    Logger.error(`Failed to fetch aliases`, `Import`);
                }
                const aliases = await response.json() as { [key: string]: string[] };

                for (const alias in aliases) {
                    let aliasVersions = aliases[alias];

                    if (aliasVersions.length == 0) {
                        continue;
                    }

                    let gameVersion1 = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName:SupportedGames.BeatSaber, version: alias } });
                    for (const aliasVersion of aliasVersions) {
                        Logger.log(`Checking aliases: ${alias} -> ${aliasVersion}`, `Import`);
                        if (!gameVersion1) {
                            Logger.warn(`Game version ${alias} not found`, `Import`);
                        }

                        let gameVersion2 = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName:SupportedGames.BeatSaber, version: aliasVersion } });
                        if (!gameVersion2) {
                            gameVersion2 = await DatabaseHelper.database.GameVersions.create({
                                version: aliasVersion,
                                gameName: SupportedGames.BeatSaber,
                            });
                        }

                        let modVersions = await DatabaseHelper.database.Versions.findAll(); // i think i have to do this to refresh any edits that get made.
                        for (let modVersion of modVersions) {
                            if (modVersion.supportedGameVersionIds.includes(gameVersion1.id) && !modVersion.supportedGameVersionIds.includes(gameVersion2.id)) {
                                modVersion.supportedGameVersionIds = [...modVersion.supportedGameVersionIds, gameVersion2.id];
                                modVersion.save();
                                continue;
                            }

                            if (modVersion.supportedGameVersionIds.includes(gameVersion2.id) && !modVersion.supportedGameVersionIds.includes(gameVersion1.id)) {
                                modVersion.supportedGameVersionIds = [...modVersion.supportedGameVersionIds, gameVersion1.id];
                                modVersion.save();
                                continue;
                            }
                        }
                    }

                }
            });

            Logger.log(`Ah-ha-ha-ha-ha-ha-ha-ha-ha-Oah, where's me rum`, `Import`);
            DatabaseHelper.refreshAllCaches();
        });
    }

    private async downloadBeatModsDownloads(modId:Project, authorId:number, mod: BeatModsMod) {
        let status = mod.status == `approved` || mod.status == `inactive` ? Status.Verified : Status.Unverified;

        let dependancyRecord: { dependancy: BeatModsMod | string, modVersionId: number}[] = [];

        for (const download of mod.downloads) {
            Config.devmode ? console.log(`Yo ho ho and a bottle of ${mod.name} v${mod.version} from ${download.url}`, `Import`) : null;
            let platform: Platform;
    
            if (download.type == `steam`) {
                platform = Platform.SteamPC;
            } else if (download.type == `oculus`) {
                platform = Platform.OculusPC;
            } else if (download.type == `universal`) {
                platform = Platform.UniversalPC;
            }
    
            // create game version if it doesn't exist
            let gameVersion = await DatabaseHelper.database.GameVersions.findOne({ where: { gameName: SupportedGames.BeatSaber, version: mod.gameVersion } });
            if (!gameVersion) {
                gameVersion = await DatabaseHelper.database.GameVersions.create({
                    createdAt: new Date(mod.uploadDate),
                    version: mod.gameVersion,
                    gameName: SupportedGames.BeatSaber,
                });
            }
    
            // validate semver
            if (!coerce(mod.version, { includePrerelease: true })) {
                Logger.error(`Failed to parse Semver ${mod.version}`, `Import`);
                continue;
            }

            // check if mod is verified, if so, set parent mod as verified
            if (status == Status.Verified && modId.status !== Status.Verified) {
                console.log(`Mod ${mod.name} v${mod.version} is marked as verified, setting parent mod as verified.`);
                modId.status = Status.Verified;
                await modId.save();
            }
    
            // check if mod version already exists, and if so, if it has the same hash. if all is true, mark the modversion as compatible with the game version and skip
            let existingVersion = await Version.checkForExistingVersion(modId.id, coerce(mod.version, { includePrerelease: true }), platform);
            if (existingVersion) {
                let doesHashMatch = download.hashMd5.every((hash) => existingVersion.contentHashes.some((contentHash) => contentHash.hash == hash.hash));
                if (status == Status.Verified && doesHashMatch) {
                    // hash and status match, mark as compatible and skip
                    Logger.log(`Mod ${mod.name} v${mod.version} already exists in the db, marking as compatible and skipping.`, `Import`);
                    if (existingVersion.supportedGameVersionIds.includes(gameVersion.id)) {
                        Logger.warn(`Mod ${mod.name} v${mod.version} attempted to add its gameversion twice.`, `Import`);
                        continue;
                    }
                    existingVersion.supportedGameVersionIds = [...existingVersion.supportedGameVersionIds, gameVersion.id];
                    // if the existing version is unverified & the incoming version is, mark as verified
                    if (existingVersion.status !== Status.Verified) {
                        Logger.log(`Mod ${mod.name} v${mod.version} already exists in the db, marking as verified.`, `Import`);
                        existingVersion.status = Status.Verified;
                    }
                    await existingVersion.save();
                    continue;
                } else {
                    if (doesHashMatch) {
                        // hash matches, but status is unapproved, mark as compatible and skip
                        Logger.warn(`Mod ${mod.name} v${mod.version} already exists in the db but has unapproved status. marked compatible. Status: ${mod.status}, gV: ${mod.gameVersion}`, `Import`);
                        if (existingVersion.supportedGameVersionIds.includes(gameVersion.id)) {
                            Logger.warn(`Mod ${mod.name} v${mod.version} attempted to add its gameversion twice.`, `Import`);
                            continue;
                        }
                        existingVersion.supportedGameVersionIds = [...existingVersion.supportedGameVersionIds, gameVersion.id];
                        await existingVersion.save();
                        continue;
                    }
                    // hash doesn't match, log and continue
                    Logger.warn(`Mod ${mod.name} v${mod.version} already exists in db but has different hashes. Status: ${mod.status}, gV: ${mod.gameVersion}`, `Import`);
                    continue;
                }
            }
    
            // download mod
            let result = `DOWNLOAD DISABLED`;
            if (this.ENABLE_DOWNLOADS) {
                let filefetch = await fetch(`https://beatmods.com${download.url}`);
                let file = await filefetch.blob();
                const md5 = crypto.createHash(`md5`);
                let arrayBuffer = await file.arrayBuffer();
                result = md5.update(new Uint8Array(arrayBuffer)).digest(`hex`);
                
                if (!fs.existsSync(`${path.resolve(Config.storage.modsDir)}/${result}.zip`)) {
                    fs.writeFileSync(`${path.resolve(Config.storage.modsDir)}/${result}.zip`, Buffer.from(arrayBuffer));
                }
            } else {
                result = JSON.stringify(download.hashMd5);
            }

            let existingHash = await DatabaseHelper.database.Versions.findOne({ where: { zipHash: result } });
            if (existingHash) {
                Logger.warn(`Hash ${result} already exists in the database, skipping.`, `Import`);
                continue;
            }
    
            // create mod version
            let newVersion = await DatabaseHelper.database.Versions.create({
                projectId: modId.id,
                modVersion: coerce(mod.version, {includePrerelease: true}),
                supportedGameVersionIds: [gameVersion.id],
                authorId: authorId,
                zipHash: result, //this will break
                status: status,
                contentHashes: download.hashMd5.map(hash => { return { path: hash.file, hash: hash.hash };}) as ContentHash[],
                platform: platform,
                dependencies: [],
                lastUpdatedById: authorId,
                lastApprovedById: status == Status.Verified ? authorId : null,
                createdAt: new Date(mod.uploadDate),
            }).catch((err) => {
                Logger.error(`Failed to create mod version ${mod.name} v${mod.version}`, `Import`);
                console.error(err);
                console.log(`its just one of those days`);
                exit(1);
            });

            if (mod.dependencies.length >= 1) {
                for (const dependancy of mod.dependencies) {
                    if (typeof dependancy === `object` && `version` in dependancy) {
                        dependancyRecord.push({ dependancy: dependancy, modVersionId: newVersion.id });
                    } else {

                        dependancyRecord.push({ dependancy: dependancy, modVersionId: newVersion.id });
                    }
                }
            }
        }
        return dependancyRecord;
    }
}
    */