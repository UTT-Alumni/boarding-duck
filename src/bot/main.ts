import { promises as fs } from "node:fs";
import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  TextChannel,
  User,
  PartialUser,
  MessageReaction,
  PartialMessageReaction,
  TextBasedChannel
} from "discord.js";

import {
  createModal,
  onModalSubmit
} from "./userInfoModal";

import Pole from "./pole";
import Bot from "./bot";
import * as db from "./database";

const onMessageReaction = async (
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  add: boolean
) => {
  // If the reaction data we have is partial, then fetch it
  if (reaction.partial) {
    await reaction.fetch();
  }

  // If the bot is the reaction author, then ignore
  if (user.id === Bot.get().user?.id) {
    return;
  }

  // Check if the reaction happened in a pole reaction channel
  const poles = await db.getPoles();
  const pole = poles.find((p) => p.rolesChannelId === reaction.message.channel.id);
  if (pole) {
    const thematic = await db.getThematicByEmoji(pole.id, reaction.emoji.toString());

    if (thematic) {
      const member = await reaction.message.guild!.members.fetch(user.id);

      if (add) {
        member.roles.add(thematic?.roleId);
      } else {
        member.roles.remove(thematic?.roleId);
      }

      console.log(`Role ${thematic?.name} (${pole.name} pole) ${add ? "added" : "removed"} to ${user.displayName}.`);
    }
  }
};

/**
 * Start the discord bot client
 * @returns {Promise<void>} - The promise to resolve when the bot is connected
 */
const start = async (): Promise<void> => {
  // Get .env variables
  const botToken = process.env.BOT_TOKEN;
  const guildId = process.env.GUILD_ID;
  const rulesChannelId = process.env.RULES_CHANNEL_ID;
  const baseRoleId = process.env.BASE_ROLE_ID;
  const adminRoleId = process.env.ADMIN_ROLE_ID;

  if (!botToken || !guildId || !rulesChannelId || !baseRoleId || !adminRoleId) {
    console.error("You must fill all the fields in the .env file.");
    return;
  }

  // Get messages from config file
  const messages = JSON.parse(await fs.readFile("messages.json", "utf8"));

  try {
    const bot = Bot.get();

    bot.on(Events.ClientReady, async (): Promise<void> => {
      console.info(`UTT Alumni Discord bot logged in as ${bot?.user?.tag}!`);
      const guild = await bot.guilds.fetch(guildId);
      console.info(`Discord guild ${guildId} retrieved.`);
      const channel = await guild.channels.fetch(rulesChannelId) as TextChannel;
      console.info(`Discord channel ${rulesChannelId} retrieved.`);
      const channelMessages = await channel.messages.fetch();
      console.info(`Fetch ${channelMessages.size} messages on channel ${rulesChannelId}.`);
      if (channelMessages.size > 0) {
        console.info("Discord server already set with a welcome message.");
      } else {
        console.info("Sending the welcome message to the Discord channel.");
        // Sends custom message mentioning the user and adds rules
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId("primary")
              .setLabel(messages.accept)
              .setStyle(ButtonStyle.Primary)
          ) as ActionRowBuilder<ButtonBuilder>;
        await channel.send({
          content: messages.rules,
          components: [row]
        });
      }
    });

    bot.on(Events.InteractionCreate, async (interaction): Promise<void> => {
      try {
        // Bot commands
        if (interaction.isChatInputCommand()) {
          await interaction.deferReply({ ephemeral: true });
          // Check if the user has the authorization to use the commands
          const guild = await bot.guilds.fetch(guildId);
          const member = guild.members.cache.find((m) => m.id === interaction.user.id);
          const isAdmin = member?.roles.cache.has(adminRoleId);

          console.log(`Received command ${interaction.commandName}`);

          if (!isAdmin) {
            console.warn(`${interaction.user.globalName} tried to send a command but is not administrator.`);
            await interaction.editReply("You are not allowed to send commands.");
            return;
          }

          // Pole command
          if (interaction.commandName === "pole") {
            const name = interaction.options.getString("name");
            const emoji = interaction.options.getString("emoji");
            const channel = interaction.options.getChannel("channel");

            if (name && emoji) {
              let error;
              if (channel) {
                if (!(channel instanceof TextChannel)) {
                  error = "The specified channel is not a text channel.";
                } else {
                  await Pole.addPole(name, emoji, channel);
                }
              } else {
                await Pole.addPole(name, emoji);
              }

              await interaction.editReply(error || ":white_check_mark: Pole added.");
            } else {
              await interaction.editReply("A name and an emoji must be provided");
            }
            return;
          }

          // Thematic command
          if (interaction.commandName === "thematic") {
            const poleName = interaction.options.getString("pole");
            const name = interaction.options.getString("name");
            const emoji = interaction.options.getString("emoji");
            const channel = interaction.options.getChannel("channel");

            if (poleName && name && emoji) {
              let error;
              const pole = await Pole.getPole(poleName);
              if (!pole) {
                error = "Unable to find pole.";
              } else if (channel) {
                if (!(channel instanceof TextChannel)) {
                  error = "The specified channel is not a text channel.";
                } else {
                  error = await pole.addThematic(name, emoji, channel);
                }
              } else {
                error = await pole.addThematic(name, emoji);
              }
              await interaction.editReply(error || ":white_check_mark: Thematic added.");
            } else {
              await interaction.editReply(
                "A pole name, a thematic name and an emoji must be provided"
              );
            }
            return;
          }

          // Project command
          if (interaction.commandName === "project") {
            const poleName = interaction.options.getString("pole");
            const thematicName = interaction.options.getString("thematic");
            const name = interaction.options.getString("name");
            const channel = interaction.options.getChannel("channel");

            if (poleName && thematicName && name) {
              let error;
              const thematic = await (await Pole.getPole(poleName))?.getThematic(thematicName);
              if (!thematic) {
                error = "Unable to find the pole or the thematic.";
              } else if (channel) {
                if (!(channel instanceof TextChannel)) {
                  error = "The specified channel is not a text channel.";
                } else {
                  error = await thematic.addProject(name, channel);
                }
              } else {
                error = await thematic.addProject(name);
              }
              await interaction.editReply(error || ":white_check_mark: Project added.");
            } else {
              await interaction.editReply("A thematic name, a project name and an emoji must be provided");
            }
            return;
          }

          // "Remove pole" command
          if (interaction.commandName === "remove-pole") {
            const poleName = interaction.options.getString("pole");

            if (poleName) {
              const error = await db.deletePole(poleName);
              await interaction.editReply(error || ":wastebasket: Pole successfully deleted.");
            } else {
              await interaction.editReply("A pole name must be provided");
            }
            return;
          }

          // "Remove thematic" command
          if (interaction.commandName === "remove-thematic") {
            const poleName = interaction.options.getString("pole");
            const thematicName = interaction.options.getString("thematic");
            let error;

            if (poleName && thematicName) {
              // Get pole
              const pole = await db.getPoleByName(poleName);
              if (!pole) {
                error = "Unable to find the pole.";
              } else {
                // Get thematic
                const thematic = await db.getThematicByName(pole.id, thematicName);

                if (!thematic) {
                  error = "Unable to find the thematic.";
                } else {
                  // Delete from database
                  error = await db.deleteThematic(poleName, thematicName);

                  // Remove reaction
                  const rolesChannel = (
                    await guild.channels.fetch(pole.rolesChannelId)
                  ) as TextBasedChannel;
                  const reactions = (await rolesChannel.messages.fetch()).at(0)?.reactions.cache;
                  const reaction = reactions?.find((r) => r.emoji.toString() === thematic.emoji);
                  await reaction?.remove();

                  // Delete role
                  const role = await guild.roles.fetch(thematic.roleId);
                  role?.delete();
                }
              }

              await interaction.editReply(error || ":wastebasket: Thematic successfully deleted.");
            } else {
              await interaction.editReply("A pole name and a thematic name must be provided");
            }
            return;
          }

          // "Remove project" command
          if (interaction.commandName === "remove-project") {
            const poleName = interaction.options.getString("pole");
            const thematicName = interaction.options.getString("thematic");
            const projectName = interaction.options.getString("project");

            if (poleName && thematicName && projectName) {
              const error = await db.deleteProject(poleName, thematicName, projectName);
              await interaction.editReply(error || ":wastebasket: Project successfully deleted.")
            } else {
              await interaction.editReply("A pole name, a thematic name and a project name must be provided");
            }
            return;
          }

          // Get command
          if (interaction.commandName === "get") {
            await interaction.editReply(await Pole.getFormatted(bot));
            return;
          }
        }

        // "Accept rules" button
        if (interaction.channelId === rulesChannelId && interaction.isButton()) {
          const modal = await createModal(messages.modal);
          await interaction.showModal(modal);
          return;
        }

        // "Register" modal submit
        if (interaction.isModalSubmit() && interaction.customId === "registerModal") {
          await onModalSubmit(interaction, baseRoleId);
          await interaction.reply({ content: messages.welcome, ephemeral: true });
          return;
        }
      } catch (err) {
        console.error(`Error while listening to interaction ${interaction.type.toString()}: ${err}`);
      }
    });

    bot.on(Events.MessageReactionAdd, (reaction, user) => onMessageReaction(reaction, user, true));
    bot.on(
      Events.MessageReactionRemove,
      (reaction, user) => onMessageReaction(reaction, user, false)
    );

    await bot.login(botToken);
  } catch (err) {
    console.error(err);
  }
};

start().then(() => {
  console.info("UTT Alumni Discord bot started.");
});
