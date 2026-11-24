import {
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";
import type { StreamSession } from "./stream-session.js";

const log = createLogger("bot");

const command = new SlashCommandBuilder()
  .setName("grafcast")
  .setDescription("Stream the Grafana playlist into a voice channel")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start streaming the Grafana playlist")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Voice channel to stream to (defaults to your current one)")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
  )
  .addSubcommand((sub) => sub.setName("stop").setDescription("Stop the stream"))
  .addSubcommand((sub) => sub.setName("status").setDescription("Show the current stream status"));

export class ControlBot {
  private readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  constructor(
    private readonly config: Config,
    private readonly session: StreamSession,
  ) {}

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, async (client) => {
      log.info(`Control bot logged in as ${client.user.tag}`);
      const guild = await client.guilds.fetch(this.config.discord.guildId);
      await guild.commands.set([command.toJSON()]);
      log.info(`Registered /${command.name} in guild ${guild.name}`);
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;
      this.handle(interaction).catch((error: unknown) => {
        log.error("Command failed", error);
        const content = `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
        const reply =
          interaction.deferred || interaction.replied
            ? interaction.editReply({ content })
            : interaction.reply({ content, flags: MessageFlags.Ephemeral });
        reply.catch(() => {});
      });
    });

    await this.client.login(this.config.discord.botToken);
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }

  private isAllowed(interaction: ChatInputCommandInteraction): boolean {
    const allowed = this.config.discord.allowedRoleIds;
    if (allowed.length === 0) return true;
    const member = interaction.member as GuildMember | null;
    return member?.roles.cache.some((role) => allowed.includes(role.id)) ?? false;
  }

  private async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({ content: "This command only works in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!this.isAllowed(interaction)) {
      await interaction.reply({ content: "You are not allowed to control the stream.", flags: MessageFlags.Ephemeral });
      return;
    }

    switch (interaction.options.getSubcommand()) {
      case "start": {
        const channel = interaction.options.getChannel("channel") ?? interaction.member.voice.channel;
        if (!channel) {
          await interaction.reply({
            content: "Join a voice channel or pass one with the `channel` option.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply();
        await this.session.start(interaction.guildId, channel.id);
        await interaction.editReply(`Streaming the Grafana playlist in <#${channel.id}>.`);
        return;
      }

      case "stop": {
        if (!this.session.active) {
          await interaction.reply({ content: "Nothing is streaming right now.", flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferReply();
        await this.session.stop();
        await interaction.editReply("Stream stopped.");
        return;
      }

      case "status": {
        const active = this.session.active;
        const content = active
          ? `Streaming in <#${active.channelId}> since <t:${Math.floor(active.startedAt.getTime() / 1000)}:R>.`
          : "Not streaming.";
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        return;
      }
    }
  }
}
