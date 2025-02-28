import { Routes, REST, RESTGetAPIApplicationCommandResult, ContextMenuCommandBuilder, ContextMenuCommandInteraction, Collection } from "discord.js";
import { Luma } from "./Luma";
import { Config } from "../../shared/Config";
import path from "node:path";
import fs from "node:fs";


export interface IContextMenu {
    data:ContextMenuCommandBuilder;
    guilds:string[];
    execute: (luma: Luma, interaction: ContextMenuCommandInteraction) => Promise<any>;
}

export class ContextMenu {
    public data: ContextMenuCommandBuilder;
    public guilds?: string[] = [];
    public execute: (luma: Luma, interaction: ContextMenuCommandInteraction) => Promise<any>;
    public id?: string;

    constructor(command: IContextMenu) {
        this.data = command.data;
        this.execute = command.execute;
        if (command.guilds != undefined) {
            if (command.guilds.length != 0) {
                this.guilds = command.guilds;
            }
        }
    }

    public async updateCommand(luma: Luma) {
        let rest = new REST({ version: `10` }).setToken(Config.bot.token);

        if (!this.id) {
            luma.logger.error(`Context Menu (${this.data.name}) does not have an ID.`, `Update Command`);
            return;
        }

        rest.patch(Routes.applicationCommand(Config.bot.clientId, this.id), { body: this.data.toJSON() })
            .then((response) => {
                let response2: RESTGetAPIApplicationCommandResult = response as RESTGetAPIApplicationCommandResult;
                this.id = response2.id;
                luma.logger.log(`Patched command (${this.data.name})`, `Update Command`);
            })
            .catch(error => {
                luma.logger.error(error, `Update Command`);
            }
            );
    }

    public async runCommand(luma: Luma, interaction: ContextMenuCommandInteraction) {
        luma.logger.log(`<@!${interaction.user.id}> ran ${this.data.name}`, `contextmenu`);

        try {
            await this.execute(luma, interaction);
        } catch (error: any) {
            console.error(error);
            luma.logger.warn(`Interaction (${interaction.commandName}) did not reply.`, `Interactions`);
            await interaction.reply({ content: `damn it broke. msg <@!213074932458979330>\nError: \`${error.name}: ${error.message}\`` }).catch(error => {
                interaction.editReply(`damn it broke. msg <@!213074932458979330>\nError: \`${error.name}: ${error.message}\``).catch(error => {
                    luma.logger.warn(`Interaction (${interaction.commandName}) did not reply in time.`, `Interactions`);
                    console.warn(error);
                });
            });
        }
    }
}

export function loadContextMenus(luma: Luma, commandsPath?: string) {
    luma.contextMenus = new Collection<string, ContextMenu>();

    let commandsDirectory: string;
    if (commandsPath) {
        commandsDirectory = commandsPath;
    } else {
        commandsDirectory = path.resolve(__dirname);
    }

    fs.readdirSync(path.join(commandsDirectory), { withFileTypes: true })
        .filter((item) => !item.isDirectory() && item.name.endsWith(`.js`))
        .forEach(item => {
            let fileName: string = item.name;
            let filePath = path.join(commandsDirectory, fileName);
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const commandFile = require(filePath);
                let command: ContextMenu = commandFile.cm;
                luma.contextMenus.set(command.data.name, command);
            } catch (error) {
                luma.logger.error(`Error when trying to load \`${filePath}\`\n\`\`\`${error}\`\`\``, `commandLoader`);
            }
        });
}