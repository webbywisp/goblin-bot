import type { MessageCommand } from '@/commands/types';
import { ClashOfClansClient, isValidPlayerTag, normalizePlayerTag } from '@/integrations/clashOfClans/client';
import { findRecruitThreadDestination } from '@/recruit/configStore';
import { ensureRecruitThreadFromMessage, populateRecruitThread } from '@/recruit/createRecruitThread';
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  type Message,
  type NewsChannel,
  type TextChannel
} from 'discord.js';

const TAG_REGEX = /#[0-9A-Z]{3,15}/gi;

function extractPlayerTag(message: Message): string | undefined {
  const sources: string[] = [];
  if (message.content) sources.push(message.content);

  for (const embed of message.embeds ?? []) {
    if (embed.title) sources.push(embed.title);
    if (embed.description) sources.push(embed.description);
    for (const field of embed.fields ?? []) {
      if (field.name) sources.push(field.name);
      if (field.value) sources.push(field.value);
    }
  }

  for (const text of sources) {
    const matches = text.match(TAG_REGEX);
    if (!matches) continue;

    for (const candidate of matches) {
      if (isValidPlayerTag(candidate)) {
        return normalizePlayerTag(candidate);
      }
    }
  }

  return undefined;
}

function buildSourceSummary(message: Message, invokedBy: string): string {
  const lines = [
    `Recruit extracted by ${invokedBy}`,
    message.guild ? `from ${message.guild.name}` : undefined,
    message.url ? `Original message: ${message.url}` : undefined
  ].filter(Boolean);

  return lines.join(' • ');
}

async function resolveDestinationChannel(client: Message['client']): Promise<{
  guildName: string;
  channel: TextChannel | NewsChannel;
} | null> {
  const destination = await findRecruitThreadDestination();
  if (!destination) return null;

  const guild = await client.guilds.fetch(destination.guildId).catch(() => null);
  if (!guild) return null;

  const channel = await guild.channels.fetch(destination.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return null;

  return { guildName: guild.name, channel: channel as TextChannel | NewsChannel };
}

const command: MessageCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('recruit')
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const destination = await resolveDestinationChannel(interaction.client);
    if (!destination) {
      await interaction.editReply(
        'No recruit destination channel configured. Run /settings in your home server to pick one.'
      );
      return;
    }

    const playerTag = extractPlayerTag(interaction.targetMessage);
    if (!playerTag) {
      await interaction.editReply('Could not find a valid player tag in that message.');
      return;
    }

    const cocClient = new ClashOfClansClient();

    try {
      const player = await cocClient.getPlayerByTag(playerTag);
      const thValue = typeof player.townHallLevel === 'number' && player.townHallLevel > 0 ? player.townHallLevel : '?';
      const threadName = `${player.name} TH ${thValue} from message`;

      const statusMessage = await destination.channel.send({
        content: `Creating recruit thread for ${player.name} (tag ${player.tag}) requested by ${interaction.user}.`
      });

      const thread = await ensureRecruitThreadFromMessage(statusMessage, threadName);
      if (!thread) {
        await statusMessage.edit('Failed to create a recruit thread in this channel.');
        await interaction.editReply('I could not create a thread in the configured channel. Check my permissions.');
        return;
      }

      await populateRecruitThread({
        thread,
        player,
        client: cocClient,
        customBaseId: `recruit:${interaction.id}`,
        replyMessageId: statusMessage.id
      });

      const summary = buildSourceSummary(interaction.targetMessage, interaction.user.tag);
      if (summary) {
        await thread.send(summary);
      }

      await statusMessage.edit(`Recruit thread created by ${interaction.user}: <#${thread.id}>`);
      await interaction.editReply(`Thread created in ${destination.guildName}: <#${thread.id}>`);
    } catch (err) {
      const { logger } = await import('@/utils/logger');
      logger.error({ err, command: 'message/recruit', playerTag }, 'Failed to create recruit thread from message');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Could not create recruit thread: ${msg}`);
    }
  }
};

export default command;
