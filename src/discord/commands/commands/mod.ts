import { CommandInteraction, SlashCommandBuilder, EmbedBuilder, InteractionContextType, AutocompleteInteraction } from "discord.js";
import { Command } from "../../classes/Command.ts";
import { Luma } from "../../classes/Luma.ts";
import { DatabaseHelper } from "../../../shared/Database.ts";
import { Op } from "sequelize";
import { rcompare } from "semver";

let commandData = new SlashCommandBuilder();
commandData.setName(`mods`);
commandData.setDescription(`Finds info on a mod.`);
commandData.addStringOption(option => option.setName(`search`).setDescription(`The name of the mod you're looking for.`).setAutocomplete(true));
commandData.setContexts(InteractionContextType.PrivateChannel, InteractionContextType.Guild, InteractionContextType.BotDM);

export default {
    command: new Command({
        data: commandData,
        execute: async function exec(luma: Luma, interaction: CommandInteraction) {
            const search = interaction.options.get(`search`);
            if (!search || typeof search.value !== `string`) return;
            let id = parseInt(search.value);
            if (isNaN(id)) {
                interaction.reply(`Invalid ID`);
                return;
            }
            let mod = await DatabaseHelper.database.Mods.findOne({ where: { id: id } });
            if (!mod) {
                interaction.reply(`Mod not found`);
                return;
            }
            let versions = await DatabaseHelper.database.ModVersions.findAll({ where: { modId: mod.id } });
            versions.sort((a, b) => rcompare(a.modVersion, b.modVersion));
            let embed = new EmbedBuilder()
                .setTitle(mod.name)
                .setDescription(mod.description)
                .setColor(`#00ff00`);
                
            let supportedGameVersions: string[] = [];
            for (let verId of versions[0].supportedGameVersionIds) {
                let gameVersion = await DatabaseHelper.database.GameVersions.findOne({ where: { id: verId } });
                if (gameVersion) {
                    supportedGameVersions.push(gameVersion.version);
                }
            }
            embed.addFields({
                name: `Supported Game Versions`,
                value: supportedGameVersions.join(`, `)
            }, {
                name: `Latest Version`,
                value: versions[0].modVersion.raw
            });
            
            return interaction.reply({ embeds: [embed] });
        },
        autocomplete: async function exec(luma: Luma, interaction: AutocompleteInteraction) {
            const search = interaction.options.getString(`search`);
            if (!search) return;
            let mods = await DatabaseHelper.database.Mods.findAll({ where: { name: { [Op.like]: `%${search}%` } } });
            
            if (!mods) {
                interaction.respond([]);
                return;
            }

            let response = mods.map(mod => {
                return {
                    name: mod.name,
                    value: mod.id.toString(),
                };
            });

            if (response.length > 25) {
                response = response.slice(0, 25);
            }

            interaction.respond(response);
        }
    })
};