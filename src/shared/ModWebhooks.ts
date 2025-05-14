import { APIEmbed, APIMessage, Colors, EmbedBuilder, JSONEncodable, MessagePayload, WebhookClient, WebhookMessageCreateOptions } from "discord.js";
import { DatabaseHelper, EditQueue, Project, ProjectEdit, ProjectInfer, Version, VersionEdit, VersionInfer, Status, User } from "./Database.ts";
import { Config } from "./Config.ts";
import { Logger } from "./Logger.ts";
import { SemVer } from "semver";

let webhookClient1: WebhookClient;
let webhookClient2: WebhookClient;

export enum WebhookLogType {
    SetToPending = `setToPending`, // submitted for approval
    Verified = `verified`, // approved
    RejectedUnverified = `unverified`, // rejected, set to unverified
    VerificationRevoked = `verificationRevoked`, // verified mod has status changed
    Removed = `removed`, // rejected, set to removed
    EditSubmitted = `editSubmitted`, // submitted for approval
    EditApproved = `editApproved`, // approved
    EditRejected = `editRejected`, // rejected

    Text_Created = `created`,
    Text_StatusChanged = `statusChanged`,
    Text_EditBypassed = `editBypassed`,
    Text_Updated = `updated`,
}

async function sendToWebhooks(content: string | MessagePayload | WebhookMessageCreateOptions, logType: WebhookLogType): Promise<APIMessage[]> {
    let retVal: Promise<APIMessage>[] = [];
    if (Config.webhooks.enableWebhooks) {
        if (!webhookClient1 && Config.webhooks.modLogUrl.length > 8) {
            webhookClient1 = new WebhookClient({ url: Config.webhooks.modLogUrl });
        }

        if (!webhookClient2 && Config.webhooks.modLog2Url.length > 8) {
            webhookClient2 = new WebhookClient({ url: Config.webhooks.modLog2Url });
        }
        if (webhookClient1) {
            if (Config.webhooks.modLogTags.includes(logType) || (Config.webhooks.modLogTags.length === 1 && Config.webhooks.modLogTags[0] === `all`)) {
                retVal.push(webhookClient1.send(content));
            }
        }

        if (webhookClient2) {
            if (Config.webhooks.modLog2Tags.includes(logType) || (Config.webhooks.modLog2Tags.length === 1 && Config.webhooks.modLog2Tags[0] === `all`)) {
                retVal.push(webhookClient2.send(content));
            }
        }
    }

    return Promise.all(retVal);
}

async function sendEmbedToWebhooks(embed: APIEmbed | JSONEncodable<APIEmbed>, logType: WebhookLogType) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    sendToWebhooks({
        username: `BadBeatMods`,
        avatarURL: faviconUrl,
        embeds: [embed]
    }, logType);
}

export async function sendModLog(mod: Project, userMakingChanges: User, logType: WebhookLogType, reason?: string) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let color = 0x00FF00;

    let embed;
    switch (logType) {
        case WebhookLogType.SetToPending:
            color = Colors.Purple;
            embed = await generateModEmbed(mod, userMakingChanges, color, { title: `Project Submitted for Approval - ${mod.name}`, minimal: false, reason: reason });
            break;
        case WebhookLogType.Verified:
            color = Colors.Green;
            embed = await generateModEmbed(mod, userMakingChanges, color, { title: `Project Approved - ${mod.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.RejectedUnverified:
            color = Colors.Yellow;
            embed = await generateModEmbed(mod, userMakingChanges, color, { title: `Project Marked Unverified - ${mod.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.VerificationRevoked:
            color = Colors.DarkRed;
            embed = await generateModEmbed(mod, userMakingChanges, color, { title: `Verification Revoked - ${mod.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Removed:
            color = Colors.Red;
            embed = await generateModEmbed(mod, userMakingChanges, color, { title: `Project Removed - ${mod.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Text_Updated:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name}](<${Config.server.url}/mods/${mod.id}>)** - Updated by ${userMakingChanges.username}`,
            }, logType);
            break;
        case WebhookLogType.Text_StatusChanged:
            color = Colors.Blue;
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name}](<${Config.server.url}/mods/${mod.id}>)** - Status changed to ${mod.status} by ${userMakingChanges.username}`,
            }, logType);
            break;
        case WebhookLogType.Text_Created:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name}](<${Config.server.url}/mods/${mod.id}>)** - Created by ${userMakingChanges.username}`,
            }, logType);
            break;
        default:
            return Logger.error(`Invalid log type ${logType} for Project Log`);
    }
     
    if (!embed) {
        return Logger.error(`Failed to generate embed for mod ${mod.name}`);
    }

    sendEmbedToWebhooks(embed, logType);
}

export async function sendModVersionLog(modVersion: Version, userMakingChanges: User, logType: WebhookLogType, modObj?: Project, reason?: string) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let mod = modObj ? modObj : await DatabaseHelper.database.Projects.findOne({ where: { id: modVersion.projectId } });
    let color = 0x00FF00;

    if (!mod) {
        return Logger.error(`Mod not found for mod version ${modVersion.id}`);
    }

    let embed;
    switch (logType) {
        case WebhookLogType.SetToPending:
            color = Colors.Purple;
            embed = await generateModVersionEmbed(mod, modVersion, userMakingChanges, color, { title: `Version Submitted for Approval - ${mod.name} v${modVersion.modVersion.raw}`, minimal: false, reason: reason });
            break;
        case WebhookLogType.Verified:
            color = Colors.Green;
            embed = await generateModVersionEmbed(mod, modVersion, userMakingChanges, color, { title: `Version Approved - ${mod.name} v${modVersion.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.RejectedUnverified:
            color = Colors.Yellow;
            embed = await generateModVersionEmbed(mod, modVersion, userMakingChanges, color, { title: `Version Marked Unverified - ${mod.name} v${modVersion.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.VerificationRevoked:
            color = Colors.DarkRed;
            embed = await generateModVersionEmbed(mod, modVersion, userMakingChanges, color, { title: `Verification Revoked - ${mod.name} v${modVersion.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Removed:
            color = Colors.Red;
            embed = await generateModVersionEmbed(mod, modVersion, userMakingChanges, color, { title: `Version Removed - ${mod.name} v${modVersion.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Text_Updated:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name} v${modVersion.modVersion.raw}](<${Config.server.url}/mods/${mod.id}#${modVersion.id}>)** - Updated by ${userMakingChanges.username}`,
            }, logType);
            break;
        case WebhookLogType.Text_StatusChanged:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name} v${modVersion.modVersion.raw}](<${Config.server.url}/mods/${mod.id}#${modVersion.id}>)** - Status changed to ${modVersion.status} by ${userMakingChanges.username}`,
            }, logType);
            break;
        case WebhookLogType.Text_Created:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name} v${modVersion.modVersion.raw}](<${Config.server.url}/mods/${mod.id}#${modVersion.id}>)** - Created by ${userMakingChanges.username}`,
            }, logType);
            break;
        default:
            return Logger.error(`Invalid log type ${logType} for Version Log`);
    }


    if (!embed) {
        return Logger.error(`Failed to generate embed for mod ${mod.name}`);
    }

    sendEmbedToWebhooks(embed, logType);
}

export async function sendEditLog(edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let color = 0x00FF00;

    let modId = edit.objectTableName === `mods` ? edit.objectId : null;
    let modVersion;
    if (!modId) {
        modVersion = DatabaseHelper.mapCache.versions.get(edit.objectId);
        if (!modVersion) {
            return Logger.error(`Mod version not found for edit ${edit.id}`);
        }
        modId = modVersion.projectId;
    }

    let mod = DatabaseHelper.mapCache.projects.get(modId);
    if (!mod) {
        return Logger.error(`Mod not found for edit ${edit.id}`);
    }

    let versionString = ``;
    if (edit.objectTableName === `modVersions`) {
        if (!modVersion) {
            return Logger.error(`Mod version not found for edit ${edit.id}`);
        }
        versionString = ` v${modVersion.modVersion.raw}`;
    }

    let embed;
    switch (logType) {
        case WebhookLogType.EditSubmitted:
            color = Colors.Purple;
            embed = await generateEditEmbed(edit, mod, userMakingChanges, color, originalObj, { title: `Edit Submitted for Approval - ${mod.name}${versionString}`, minimal: false });
            break;
        case WebhookLogType.EditApproved:
            color = Colors.Green;
            embed = await generateEditEmbed(edit, mod, userMakingChanges, color, originalObj, { title: `Edit Approved - ${mod.name}${versionString}`, minimal: false });
            break;
        case WebhookLogType.EditRejected:
            color = Colors.Red;
            embed = await generateEditEmbed(edit, mod, userMakingChanges, color, originalObj, { title: `Edit Rejected - ${mod.name}${versionString}`, minimal: false });
            break;
        case WebhookLogType.Text_Updated:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name}${versionString}](<${Config.server.url}/mods/${mod.id}>)** - Edit ${edit.id} updated by [${userMakingChanges.username}](<${Config.server.url}/user/${userMakingChanges.id}>).`,
            }, logType);
            break;
        case WebhookLogType.Text_EditBypassed:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${mod.name}${versionString}](<${Config.server.url}/mods/${mod.id}>)** - Edit ${edit.id} ${edit.approved ? `approved` : `rejected`} (bypassed by [${userMakingChanges.username}](<${Config.server.url}/user/${userMakingChanges.id}>)).`,
            }, logType);
            break;
        default:
            return Logger.error(`Invalid log type ${logType} for Edit Log`);
    }

    if (!embed) {
        return Logger.error(`Failed to generate embed for edit ${edit.id}`);
    }

    sendEmbedToWebhooks(embed, logType);
}

//#region Generate Embeds
async function generateModEmbed(mod: Project, userMakingChanges: User, color: number, options: {
    title?: string,
    useSummary?: boolean,
    minimal?: boolean,
    reason?: string,
} = {}): Promise<APIEmbed | void> {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;

    let authors: User[] = [];
    for (let author of mod.authorIds) {
        let authorDb = await DatabaseHelper.database.Users.findOne({ where: { id: author } });
        if (!authorDb) {
            continue;
        }
        authors.push(authorDb);
    }
    if (authors.length === 0) {
        return Logger.error(`No authors found for mod ${mod.name}`);
    }

    if (options?.minimal) {
        let fields = [];
        if (options?.reason) {
            fields.push({
                name: `Reason`,
                value: `${options.reason} `,
                inline: false,
            });
        }

        return {
            title: options.title ? options.title : `Mod: ${mod.name}`,
            url: `${Config.server.url}/mods/${mod.id}`,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            description: `${mod.summary} `,
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${mod.iconFileName}`,
            },
            fields: fields,
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Mod ID: ${mod.id}`,
                icon_url: faviconUrl,
            },
        };
    } else {
        let fields = [
            {
                name: `Authors`,
                value: `${authors.map(author => { return author.username; }).join(`, `)} `,
                inline: true,
            },
            {
                name: `Category`,
                value: `${mod.category} `,
                inline: true,
            },
            {
                name: `Git URL`,
                value: `${mod.gitUrl} `,
                inline: false,
            },
        ];
        if (options?.reason) {
            fields.push({
                name: `Reason`,
                value: `${options.reason} `,
                inline: false,
            });
        }

        return {
            title: options?.title ? options.title : `Mod: ${mod.name}`,
            url: `${Config.server.url}/mods/${mod.id}`,
            description: options?.useSummary ? `${mod.summary} ` : `${mod.description.length > 100 ? mod.description.substring(0, 100) : mod.description} `,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${mod.iconFileName}`,
            },
            fields: fields,
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Mod ID: ${mod.id}`,
                icon_url: faviconUrl,
            },
        };
    }
}

async function generateModVersionEmbed(mod: Project, modVersion: Version, userMakingChanges: User, color: number, options: {
    title?: string,
    minimal?: boolean,
    reason?: string,
} = {}): Promise<APIEmbed | void> {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let author = await DatabaseHelper.database.Users.findOne({ where: { id: modVersion.authorId } });
    let gameVersions = await modVersion.getSupportedGameVersions();
    let dependancies: string[] = [];
    let resolvedDependancies = await modVersion.getDependencyObjs(gameVersions[0].id, [Status.Verified, Status.Unverified]);

    if (!author) {
        return Logger.error(`Author not found for mod version ${modVersion.id}`);
    }

    if (!mod) {
        return Logger.error(`Mod not found for mod version ${modVersion.id}`);
    }

    if (!resolvedDependancies) {
        return Logger.error(`Dependancies not found for mod version ${modVersion.id}`);
    }

    for (let dependancy of resolvedDependancies) {
        let dependancyMod = await DatabaseHelper.database.Projects.findOne({ where: { id: dependancy.projectId } });
        if (!dependancyMod) {
            return Logger.warn(`Dependancy mod ${dependancy.projectId} not found for mod version ${modVersion.id}`);
        }
        dependancies.push(`${dependancyMod.name} v${dependancy.modVersion.raw}`);
    }

    if (options?.minimal) {
        let fields = [];
        if (options?.reason) {
            fields.push({
                name: `Reason`,
                value: `${options.reason} `,
                inline: false,
            });
        }

        return {
            title: options.title ? `${options.title} ` : `Mod Version: ${mod.name} v${modVersion.modVersion.raw}`,
            url: `${Config.server.url}/mods/${mod.id}#${modVersion.id}`,
            description: `${mod.summary} `,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${mod.iconFileName}`,
            },
            fields: fields,
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Mod ID: ${mod.id} | Mod Version ID: ${modVersion.id}`,
                icon_url: faviconUrl,
            },
        };
    } else {
        let fields = [
            {
                name: `Author`,
                value: `${author.username} `,
                inline: true,
            },
            {
                name: `Platform`,
                value: `${modVersion.platform} `,
                inline: true,
            },
            {
                name: `# of Files`,
                value: `${modVersion.contentHashes.length} `,
                inline: true,
            },
            {
                name: `Game Versions`,
                value: `${gameVersions.map((v) => v.version).join(`, `)} `,
                inline: true,
            },
            {
                name: `Dependencies`,
                value: `${dependancies.join(`, `)} `,
                inline: true,
            },
        ];
        if (options.reason) {
            fields.push({
                name: `Reason`,
                value: `${options.reason} `,
                inline: false,
            });
        }
        return {
            title: options.title ? `${options.title} ` : `Mod Version: ${mod.name} v${modVersion.modVersion.raw}`,
            url: `${Config.server.url}/mods/${mod.id}#${modVersion.id}`,
            description: `${mod.summary} `,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            fields: fields,
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${mod.iconFileName}`,
            },
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Mod ID: ${mod.id} | Mod Version ID: ${modVersion.id}`,
                icon_url: faviconUrl,
            },
        };
    }
}

async function generateEditEmbed(edit: EditQueue, mod:Project, userMakingChanges: User, color: number, originalObj?: ProjectInfer | VersionInfer, options: {
    title?: string,
    description?: string,
    minimal?: boolean,
} = {}): Promise<EmbedBuilder | void> {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    
    let embed = new EmbedBuilder();
    embed.setColor(color);
    embed.setTimestamp(new Date(Date.now()));
    embed.setAuthor({
        name: userMakingChanges.username,
        iconURL: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`
    });
    embed.setFooter({
        text: `Mod ID: ${mod.id} | Edit ID: ${edit.id}`,
        iconURL: faviconUrl,
    });
    embed.setTitle(options.title ? `${options.title} ` : `Edit: ${mod.name}`);
    embed.setURL(`${Config.server.url}/mods/${mod.id}`);
    let original = undefined;
    if (originalObj) {
        original = originalObj;
    } else {
        original = edit.objectTableName === `mods` ? mod : DatabaseHelper.mapCache.versions.get(edit.objectId);
    }
    if (!original) {
        return Logger.error(`Original not found for edit ${edit.id}`);
    }

    let description = ``;

    if (edit.isMod() && `name` in original) {
        for (let key of Object.keys(edit.object) as (keyof ProjectEdit)[]) {
            let editProp = edit.object[key];
            let originalProp = original[key];
            if (Array.isArray(editProp) && Array.isArray(originalProp)) {
                // this is cursed. im not sorry
                if (editProp.every((v) => v === originalProp.find((o) => o === v)) && originalProp.every((v) => v === editProp.find((o) => o === v))) {
                    continue;
                } else {
                    if (key === `authorIds`) {
                        let originalAuthors = DatabaseHelper.cache.users.filter((v) => originalProp.find((o) => o === v.id));
                        let editAuthors = DatabaseHelper.cache.users.filter((v) => editProp.find((o) => o === v.id));

                        description += `**Authors**: ${originalAuthors.map((v) => v.username).join(`, `)} -> ${editAuthors.map((v) => v.username).join(`, `)}\n`;
                    }

                    description += `**${key}**: ${originalProp.join(`, `)} -> ${editProp.join(`, `)}\n\n`;
                }
                continue;
            }

            if (editProp != originalProp) {
                if (key === `description`) {
                    let originalDescription = originalProp as string;
                    let editDescription = editProp as string;
                    if (originalDescription.length > 100) {
                        originalDescription = originalDescription.substring(0, 100) + `...`;
                    }
                    if (editDescription.length > 100) {
                        editDescription = editDescription.substring(0, 100) + `...`;
                    }
                    originalDescription = originalDescription.replaceAll(`#`, `\\#`);
                    editDescription = editDescription.replaceAll(`#`, `\\#`);
                    description += `**${key}**: ${originalDescription} -> ${editDescription}\n`;
                    continue;
                }
                description += `**${key}**: ${originalProp} -> ${editProp}\n`;
            }
        }
    } else if (edit.isModVersion() && `platform` in original) {
        for (let key of Object.keys(edit.object) as (keyof VersionEdit)[]) {
            let editProp = edit.object[key];
            let originalProp = original[key];
            if (Array.isArray(editProp) && Array.isArray(originalProp)) {
                // this is cursed. im not sorry
                if (editProp.every((v) => v === originalProp.find((o) => o === v)) && originalProp.every((v) => v === editProp.find((o) => o === v))) {
                    continue;
                } else {
                    if (key === `supportedGameVersionIds`) {
                        let originalGameVersions = DatabaseHelper.cache.gameVersions.filter((v) => originalProp.find((o) => o === v.id));
                        let editGameVersions = DatabaseHelper.cache.gameVersions.filter((v) => editProp.find((o) => o === v.id));

                        description += `**Game Versions**: ${originalGameVersions.map((v) => v.version).join(`, `)} -> ${editGameVersions.map((v) => v.version).join(`, `)}\n`;
                    }
                    description += `**${key}**: ${originalProp.join(`, `)} -> ${editProp.join(`, `)}\n`;
                }
                continue;
            }

            if (editProp != originalProp) {
                if (key === `modVersion`) {
                    if ((originalProp as SemVer).raw === (editProp as SemVer).raw) {
                        continue;
                    } else {
                        description += `**${key}**: ${(originalProp as SemVer).raw} -> ${(editProp as SemVer).raw}\n\n`;
                        continue;
                    }
                }
                description += `**${key}**: ${originalProp} -> ${editProp}\n\n`;
            }
        }
    }

    if (description.length > 4096) {
        description = description.substring(0, 4096);
    }

    if (options.minimal) {
        embed.setDescription(description ? description : null);
        return embed;
    }

    embed.setDescription(description.length > 0 ? description : `No changes detected.`);

    return embed;
}
//#endregion