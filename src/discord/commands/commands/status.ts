import { CommandInteraction, SlashCommandBuilder, EmbedBuilder, InteractionContextType, MessageFlags } from "discord.js";
import { Command } from "../../classes/Command.ts";
import { Luma } from "../../classes/Luma.ts";
// eslint-disable-next-line quotes
import swaggerDocument from '../../../api/swagger.json' with { type: "json" };
import * as os from "os";
import * as fs from "fs";

export default {
    command: new Command({
        data: new SlashCommandBuilder()
            .setName(`status`)
            .setDescription(`Gets the status of Luma.`)
            .setContexts(InteractionContextType.PrivateChannel),
        execute: async function exec(luma: Luma, interaction: CommandInteraction) {
            let version = `Version not found.`;
            if (fs.existsSync(`.git/HEAD`) || process.env.GIT_VERSION) {
                if (process.env.GIT_VERSION) {
                    version = `Running on commit: ${process.env.GIT_VERSION.substring(0, 7)}`;
                } else {
                    let gitId = fs.readFileSync(`.git/HEAD`, `utf8`);
                    if (gitId.indexOf(`:`) !== -1) {
                        let refPath = `.git/` + gitId.substring(5).trim();
                        gitId = fs.readFileSync(refPath, `utf8`);
                    }

                    version = `Running on commit: ${gitId.substring(0, 7)}`;
                }
            }

            if (swaggerDocument?.info?.version) {
                version += ` • Running on API version: ${swaggerDocument.info.version}`;
            }

            let lastConnectionAt = `Last connection not found.`;
            if (luma.readyAt) {
                lastConnectionAt = new Date(luma.readyAt).toUTCString();
            }

            if (!luma.user) {
                return await interaction.reply({ content: `Luma is not connected to Discord. idk how that happened.`, flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Luma Status`)
                .setDescription(`Luma is developed by <@!213074932458979330>. You can find more information about her at https://saeraphinx.dev. You can find the ToS and Privacy Policy at https://saeraphinx.dev/bot-tos.`)
                .addFields(
                    {
                        name: `Server OS`,
                        value: `${process.platform}`,
                        inline: true
                    },
                    {
                        name: `Host Uptime`,
                        value: `${toHHMMSS(Math.floor(os.uptime()))}`,
                        inline: true
                    },
                    {
                        name: `Server Uptime`,
                        value: `${toHHMMSS(Math.floor(process.uptime()))}`,
                        inline: true
                    },
                    {
                        name: `Last Connection`,
                        value: lastConnectionAt,
                        inline: true
                    },
                    {
                        name: `Ping to Discord`,
                        value: `${luma.ws.ping}ms`,
                        inline: true
                    },
                    {
                        name: `Load Average (1m, 5m, 15m)`,
                        value: `${os.loadavg()}`,
                        inline: true
                    },
                )
                .setThumbnail(luma.user.displayAvatarURL({ size: 512 }))
                .setColor(`#00ff00`)
                .setFooter({
                    text: `Developed by Saera • ${version}`,
                    iconURL: luma.user.displayAvatarURL({ size: 512 }),
                });

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral});
        }
    })
};

function toHHMMSS(anumber: any) {
    let sec_num = parseInt(anumber, 10); // don't forget the second param
    let hours: any = Math.floor(sec_num / 3600);
    let minutes: any = Math.floor((sec_num - (hours * 3600)) / 60);
    let seconds: any = sec_num - (hours * 3600) - (minutes * 60);

    if (hours < 10) { hours = `0` + hours; }
    if (minutes < 10) { minutes = `0` + minutes; }
    if (seconds < 10) { seconds = `0` + seconds; }
    return hours + `:` + minutes + `:` + seconds;
}