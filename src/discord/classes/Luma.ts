import * as Discord from "discord.js";
import { REST } from '@discordjs/rest';
import { Logger } from "../../shared/Logger";
import { Command, loadCommands } from "./Command";
import { Config } from "../../shared/Config";
import { ContextMenu } from "./ContextMenu";
import path from "path";

export class Luma extends Discord.Client {
    public commands = new Discord.Collection<string, Command>();
    public contextMenus = new Discord.Collection<string, ContextMenu>();
    public logger = Logger;
    public get isAprilFools(): boolean {
        let now = new Date(Date.now());
        return now.getDate() == 1 && now.getMonth() == 3;
    }

    constructor(options: Discord.ClientOptions) {
        super(options);

        loadCommands(this, path.resolve(__dirname, `../commands/commands`));
        //loadContextMenus(this, path.resolve(__dirname, `../commands/contextmenus`));
        this.pushCommands();
        this.once(`ready`, () => {
            Logger.log(`Logged in as ${this.user.tag}`, `Luma.constructor`);
        });
        this.registerInteractionEvent();
    }

    private async pushCommands() {
        let rest = new REST({ version: `10` }).setToken(Config.bot.token);
        let serverCommands: Discord.Collection<string, Array<Discord.RESTPostAPIChatInputApplicationCommandsJSONBody | Discord.RESTPostAPIContextMenuApplicationCommandsJSONBody>> = new Discord.Collection<string, Array<Discord.RESTPostAPIChatInputApplicationCommandsJSONBody | Discord.RESTPostAPIContextMenuApplicationCommandsJSONBody>>();
        let globalCommands: Array<Discord.RESTPostAPIChatInputApplicationCommandsJSONBody | Discord.RESTPostAPIContextMenuApplicationCommandsJSONBody> = [];

        let serverList = await rest.get(Discord.Routes.userGuilds()) as Partial<Discord.Guild>[];

        this.commands.forEach(command => {
            if (command.guilds.length != 0) {
                command.guilds.forEach(gid => {
                    try {
                        serverCommands.get(gid).push(command.data.toJSON());
                    } catch (error) {
                        this.logger.error(error, `pushServerCommands`);
                    }
                });
            } else {
                globalCommands.push(command.data.toJSON());
            }
        });

        this.contextMenus.forEach(contextmenu => {
            if (contextmenu.guilds.length != 0) {
                contextmenu.guilds.forEach(gid => {
                    try {
                        serverCommands.get(gid).push(contextmenu.data.toJSON());
                    } catch (error) {
                        this.logger.error(error, `pushServerCommands`);
                    }
                });
            } else {
                globalCommands.push(contextmenu.data.toJSON());
            }
        });

        rest.put(Discord.Routes.applicationCommands(Config.bot.clientId), { body: globalCommands })
            .then((response) => {
                let response2: Discord.RESTGetAPIApplicationCommandResult[] = response as Discord.RESTGetAPIApplicationCommandResult[];
                response2.forEach(apicommand => {
                    this.commands.forEach(command => {
                        if (command.data.name == apicommand.name) {
                            command.id = apicommand.id;
                        }
                    });
                });
                this.logger.log(`Global commands pushed.`, `Luma.pushCommands()`);
            })
            .catch(error => {
                this.logger.error(error, `Luma.pushCommands()`);
            }
            );

        for (const [key, value] of serverCommands) {
            if (!serverList.find(guild => guild.id == key)) {
                this.logger.warn(`Guild ${key} not found. Skipping.`, `Luma.pushCommands()`);
                continue;
            }
            rest.put(Discord.Routes.applicationGuildCommands(Config.bot.clientId, key), { body: value }).then(() => {
                console.log(`Pushed commands for ${key}`, `Luma.pushCommands()`);
            }).catch(error => {
                this.logger.error(error, `Luma.pushCommands()`);
            });
        }
    }

    public registerInteractionEvent() {
        this.on(Discord.Events.InteractionCreate, async interaction => {
            // console.log(interaction);
            if (interaction.isChatInputCommand()) {
                const command = this.commands.get(interaction.commandName);
                if (!command) return;
                await command.runCommand(this, interaction);
            } else if (interaction.isAutocomplete()) {
                const command = this.commands.get(interaction.commandName);
                if (!command) return;
                try {
                    command.autocomplete(this, interaction);
                } catch (error) {
                    //do nothing
                }
            } else if (interaction.isContextMenuCommand()) {
                const command = this.contextMenus.get(interaction.commandName);
                if (!command) return;
                await command.runCommand(this, interaction);
            }
        });
    }
}