import { APIEmbed, APIMessage, Colors, EmbedBuilder, JSONEncodable, MessagePayload, WebhookClient, WebhookMessageCreateOptions } from "discord.js";
import { DatabaseHelper, EditQueue, Project, ProjectEdit, ProjectInfer, Version, VersionEdit, VersionInfer, Status, User, Game } from "./Database.ts";
import { Config } from "./Config.ts";
import { Logger } from "./Logger.ts";
import { SemVer } from "semver";

type WebhookClientWithTags = { tags: WebhookLogType[], client: WebhookClient }
const WebhookClients: Map<string, WebhookClientWithTags[]> = new Map();

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

    All = `all`, // used to indicate all types, not a real type
}
const allWebhookTypes = Object.values(WebhookLogType);

async function generateWebhookClients(gameName: string | Game): Promise<WebhookClientWithTags[]> {
    let webhooks: WebhookClientWithTags[] = [];
    let game = typeof gameName === `string` ? await DatabaseHelper.database.Games.findOne({ where: { name: gameName } }) : gameName;
    if (!game) {
        Logger.error(`Game not found for webhook generation: ${game}`);
        return webhooks;
    }

    if (game.webhookConfig && game.webhookConfig.length > 0) {
        for (let config of game.webhookConfig) {
            if (config.url && config.types && config.types.length > 0) {
                try {
                    let client = new WebhookClient({ url: config.url });
                    webhooks.push({
                        tags: config.types[0] === `all` ? allWebhookTypes : config.types as WebhookLogType[],
                        client: client
                    });
                } catch (error) {
                    Logger.error(`Failed to create webhook client for ${gameName}: ${error}`);
                }
            }
        }
    }

    return webhooks;
}

export async function generateWebhooksForGame(gameName: Game | string): Promise<boolean> {
    if (typeof gameName === `string`) {
        let game = DatabaseHelper.cache.games.find((g) => g.name === gameName);
        if (game) {
            gameName = game;
        } else {
            Logger.error(`Game not found in cache for webhook generation: ${gameName}`);
            return false;
        }
    }

    if (!gameName) {
        Logger.error(`Game not found for webhook generation: ${gameName}`);
        return false;
    }

    let webhooks = await generateWebhookClients(gameName);
    if (webhooks.length === 0) {
        Logger.debugWarn(`No webhooks configured for game ${gameName.name}. Skipping webhook logging.`);
        return false;
    }
    WebhookClients.set(gameName.name, webhooks);
    Logger.debug(`Generated ${webhooks.length} webhooks for game ${gameName.name}`);
    return true;
}

async function sendToWebhooks(content: string | MessagePayload | WebhookMessageCreateOptions, logType: WebhookLogType, gameName:string): Promise<APIMessage[] | undefined> {
    let retVal: Promise<APIMessage>[] = [];
    let webhooks = WebhookClients.get(gameName);
    if (!webhooks) {
        webhooks = await generateWebhookClients(gameName);
        WebhookClients.set(gameName, webhooks);
    }

    if (webhooks.length === 0) {
        Logger.debugWarn(`No webhooks configured for game ${gameName}. Skipping webhook logging.`);
        return;
    }

    for (let webhook of webhooks) {
        if (webhook.tags.includes(logType) || webhook.tags.includes(WebhookLogType.All)) {
            try {
                if (typeof content === `string`) {
                    retVal.push(webhook.client.send({ content: content }));
                } else if (content instanceof MessagePayload || content instanceof EmbedBuilder) {
                    retVal.push(webhook.client.send(content));
                } else {
                    retVal.push(webhook.client.send({ embeds: [content as APIEmbed] }));
                }
            } catch (error) {
                Logger.error(`Failed to send webhook for ${gameName} with type ${logType}: ${error}`);
            }
        }
    }
    return Promise.all(retVal);
}

async function sendEmbedToWebhooks(embed: APIEmbed | JSONEncodable<APIEmbed>, logType: WebhookLogType, gameName:string) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    sendToWebhooks({
        username: `BadBeatMods`,
        avatarURL: faviconUrl,
        embeds: [embed]
    }, logType, gameName);
}

export async function sendProjectLog(project: Project, userMakingChanges: User, logType: WebhookLogType, reason?: string) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let color = 0x00FF00;

    let embed;
    switch (logType) {
        case WebhookLogType.SetToPending:
            color = Colors.Purple;
            embed = await generateProjectEmbed(project, userMakingChanges, color, { title: `Project Submitted for Approval - ${project.name}`, minimal: false, reason: reason });
            break;
        case WebhookLogType.Verified:
            color = Colors.Green;
            embed = await generateProjectEmbed(project, userMakingChanges, color, { title: `Project Approved - ${project.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.RejectedUnverified:
            color = Colors.Yellow;
            embed = await generateProjectEmbed(project, userMakingChanges, color, { title: `Project Marked Unverified - ${project.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.VerificationRevoked:
            color = Colors.DarkRed;
            embed = await generateProjectEmbed(project, userMakingChanges, color, { title: `Verification Revoked - ${project.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Removed:
            color = Colors.Red;
            embed = await generateProjectEmbed(project, userMakingChanges, color, { title: `Project Removed - ${project.name}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Text_Updated:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name}](<${Config.server.url}/mods/${project.id}>)** - Updated by ${userMakingChanges.username}`,
            }, logType, project.gameName);
            break;
        case WebhookLogType.Text_StatusChanged:
            color = Colors.Blue;
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name}](<${Config.server.url}/mods/${project.id}>)** - Status changed to ${project.status} by ${userMakingChanges.username}`,
            }, logType, project.gameName);
            break;
        case WebhookLogType.Text_Created:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name}](<${Config.server.url}/mods/${project.id}>)** - Created by ${userMakingChanges.username}`,
            }, logType, project.gameName);
            break;
        default:
            return Logger.error(`Invalid log type ${logType} for Project Log`);
    }
     
    if (!embed) {
        return Logger.error(`Failed to generate embed for project ${project.name}`);
    }

    sendEmbedToWebhooks(embed, logType, project.gameName);
}

export async function sendVersionLog(version: Version, userMakingChanges: User, logType: WebhookLogType, projectObj?: Project, reason?: string) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let project = projectObj ? projectObj : await DatabaseHelper.database.Projects.findOne({ where: { id: version.projectId } });
    let color = 0x00FF00;

    if (!project) {
        return Logger.error(`Project not found for version ${version.id}`);
    }

    let embed;
    switch (logType) {
        case WebhookLogType.SetToPending:
            color = Colors.Purple;
            embed = await generateVersionEmbed(project, version, userMakingChanges, color, { title: `Version Submitted for Approval - ${project.name} v${version.modVersion.raw}`, minimal: false, reason: reason });
            break;
        case WebhookLogType.Verified:
            color = Colors.Green;
            embed = await generateVersionEmbed(project, version, userMakingChanges, color, { title: `Version Approved - ${project.name} v${version.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.RejectedUnverified:
            color = Colors.Yellow;
            embed = await generateVersionEmbed(project, version, userMakingChanges, color, { title: `Version Marked Unverified - ${project.name} v${version.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.VerificationRevoked:
            color = Colors.DarkRed;
            embed = await generateVersionEmbed(project, version, userMakingChanges, color, { title: `Verification Revoked - ${project.name} v${version.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Removed:
            color = Colors.Red;
            embed = await generateVersionEmbed(project, version, userMakingChanges, color, { title: `Version Removed - ${project.name} v${version.modVersion.raw}`, minimal: true, reason: reason });
            break;
        case WebhookLogType.Text_Updated:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name} v${version.modVersion.raw}](<${Config.server.url}/mods/${project.id}#${version.id}>)** - Updated by ${userMakingChanges.username}`,
            }, logType, project.gameName);
            break;
        case WebhookLogType.Text_StatusChanged:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name} v${version.modVersion.raw}](<${Config.server.url}/mods/${project.id}#${version.id}>)** - Status changed to ${version.status} by ${userMakingChanges.username}`,
            }, logType, project.gameName);
            break;
        case WebhookLogType.Text_Created:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name} v${version.modVersion.raw}](<${Config.server.url}/mods/${project.id}#${version.id}>)** - Created by ${userMakingChanges.username}`,
            }, logType, project.gameName);
            break;
        default:
            return Logger.error(`Invalid log type ${logType} for Version Log`);
    }


    if (!embed) {
        return Logger.error(`Failed to generate embed for mod ${project.name}`);
    }

    sendEmbedToWebhooks(embed, logType, project.gameName);
}

export async function sendEditLog(edit: EditQueue, userMakingChanges: User, logType: WebhookLogType, originalObj?: ProjectInfer | VersionInfer) {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let color = 0x00FF00;

    let projectId = edit.isProject() ? edit.objectId : null;
    let version;
    if (!projectId) {
        version = DatabaseHelper.mapCache.versions.get(edit.objectId);
        if (!version) {
            return Logger.error(`Version not found for edit ${edit.id}`);
        }
        projectId = version.projectId;
    }

    let project = DatabaseHelper.mapCache.projects.get(projectId);
    if (!project) {
        return Logger.error(`Project not found for edit ${edit.id}`);
    }

    let versionString = ``;
    if (edit.isVersion()) {
        if (!version) {
            return Logger.error(`Version not found for edit ${edit.id}`);
        }
        versionString = ` v${version.modVersion.raw}`;
    }

    let embed;
    switch (logType) {
        case WebhookLogType.EditSubmitted:
            color = Colors.Purple;
            embed = await generateEditEmbed(edit, project, userMakingChanges, color, originalObj, { title: `Edit Submitted for Approval - ${project.name}${versionString}`, minimal: false });
            break;
        case WebhookLogType.EditApproved:
            color = Colors.Green;
            embed = await generateEditEmbed(edit, project, userMakingChanges, color, originalObj, { title: `Edit Approved - ${project.name}${versionString}`, minimal: false });
            break;
        case WebhookLogType.EditRejected:
            color = Colors.Red;
            embed = await generateEditEmbed(edit, project, userMakingChanges, color, originalObj, { title: `Edit Rejected - ${project.name}${versionString}`, minimal: false });
            break;
        case WebhookLogType.Text_Updated:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name}${versionString}](<${Config.server.url}/mods/${project.id}>)** - Edit ${edit.id} updated by [${userMakingChanges.username}](<${Config.server.url}/user/${userMakingChanges.id}>).`,
            }, logType, project.gameName);
            break;
        case WebhookLogType.Text_EditBypassed:
            return sendToWebhooks({
                username: `BadBeatMods`,
                avatarURL: faviconUrl,
                content: `**[${project.name}${versionString}](<${Config.server.url}/mods/${project.id}>)** - Edit ${edit.id} ${edit.approved ? `approved` : `rejected`} (bypassed by [${userMakingChanges.username}](<${Config.server.url}/user/${userMakingChanges.id}>)).`,
            }, logType, project.gameName);
            break;
        default:
            return Logger.error(`Invalid log type ${logType} for Edit Log`);
    }

    if (!embed) {
        return Logger.error(`Failed to generate embed for edit ${edit.id}`);
    }

    sendEmbedToWebhooks(embed, logType, project.gameName);
}

//#region Generate Embeds
async function generateProjectEmbed(project: Project, userMakingChanges: User, color: number, options: {
    title?: string,
    useSummary?: boolean,
    minimal?: boolean,
    reason?: string,
} = {}): Promise<APIEmbed | void> {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;

    let authors: User[] = [];
    for (let author of project.authorIds) {
        let authorDb = await DatabaseHelper.database.Users.findOne({ where: { id: author } });
        if (!authorDb) {
            continue;
        }
        authors.push(authorDb);
    }
    if (authors.length === 0) {
        return Logger.error(`No authors found for project ${project.name}`);
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
            title: options.title ? options.title : `Project: ${project.name}`,
            url: `${Config.server.url}/mods/${project.id}`,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            description: `${project.summary} `,
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${project.iconFileName}`,
            },
            fields: fields,
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Project ID: ${project.id} | Game: ${project.gameName}`,
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
                value: `${project.category} `,
                inline: true,
            },
            {
                name: `Git URL`,
                value: `${project.gitUrl} `,
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
            title: options?.title ? options.title : `Project: ${project.name}`,
            url: `${Config.server.url}/mods/${project.id}`,
            description: options?.useSummary ? `${project.summary} ` : `${project.description.length > 100 ? project.description.substring(0, 100) : project.description} `,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${project.iconFileName}`,
            },
            fields: fields,
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Project ID: ${project.id} | Game: ${project.gameName}`,
                icon_url: faviconUrl,
            },
        };
    }
}

async function generateVersionEmbed(project: Project, version: Version, userMakingChanges: User, color: number, options: {
    title?: string,
    minimal?: boolean,
    reason?: string,
} = {}): Promise<APIEmbed | void> {
    const faviconUrl = Config.flags.enableFavicon ? `${Config.server.url}/favicon.ico` : `https://raw.githubusercontent.com/Saeraphinx/BadBeatMods/refs/heads/main/assets/favicon.png`;
    let author = await DatabaseHelper.database.Users.findOne({ where: { id: version.authorId } });
    let gameVersions = await version.getSupportedGameVersions(`v3`);
    let dependancies: string[] = [];
    let resolvedDependancies = await version.getDependencyObjs(gameVersions[0].id, [Status.Verified, Status.Unverified]);

    if (!author) {
        return Logger.error(`Author not found for version ${version.id}`);
    }

    if (!project) {
        return Logger.error(`Project not found for version ${version.id}`);
    }

    if (!resolvedDependancies) {
        return Logger.error(`Dependencies not found for version ${version.id}`);
    }

    for (let dependancy of resolvedDependancies) {
        let dependancyMod = await DatabaseHelper.database.Projects.findOne({ where: { id: dependancy.projectId } });
        if (!dependancyMod) {
            return Logger.warn(`Dependancy project ${dependancy.projectId} not found for version ${version.id}`);
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
            title: options.title ? `${options.title} ` : `Version: ${project.name} v${version.modVersion.raw}`,
            url: `${Config.server.url}/mods/${project.id}#${version.id}`,
            description: `${project.summary} `,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${project.iconFileName}`,
            },
            fields: fields,
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Project ID: ${project.id} | Version ID: ${version.id} | Game: ${project.gameName}`,
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
                value: `${version.platform} `,
                inline: true,
            },
            {
                name: `# of Files`,
                value: `${version.contentHashes.length} `,
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
            title: options.title ? `${options.title} ` : `Version: ${project.name} v${version.modVersion.raw}`,
            url: `${Config.server.url}/mods/${project.id}#${version.id}`,
            description: `${project.summary} `,
            author: {
                name: `${userMakingChanges.username} `,
                icon_url: userMakingChanges.username === `ServerAdmin` ? faviconUrl : `https://github.com/${userMakingChanges.username}.png`,
            },
            fields: fields,
            thumbnail: {
                url: `${Config.server.url}/cdn/icon/${project.iconFileName}`,
            },
            color: color,
            timestamp: new Date().toISOString(),
            footer: {
                text: `Project ID: ${project.id} | Version ID: ${version.id} | Game: ${project.gameName}`,
                icon_url: faviconUrl,
            },
        };
    }
}

async function generateEditEmbed(edit: EditQueue, project:Project, userMakingChanges: User, color: number, originalObj?: ProjectInfer | VersionInfer, options: {
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
        text: `Project ID: ${project.id} | Edit ID: ${edit.id}`,
        iconURL: faviconUrl,
    });
    embed.setTitle(options.title ? `${options.title} ` : `Edit: ${project.name}`);
    embed.setURL(`${Config.server.url}/mods/${project.id}`);
    let original = undefined;
    if (originalObj) {
        original = originalObj;
    } else {
        original = edit.isProject() ? project : DatabaseHelper.mapCache.versions.get(edit.objectId);
    }
    if (!original) {
        return Logger.error(`Original not found for edit ${edit.id}`);
    }

    let description = ``;

    if (edit.isProject() && `name` in original) {
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
    } else if (edit.isVersion() && `platform` in original) {
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