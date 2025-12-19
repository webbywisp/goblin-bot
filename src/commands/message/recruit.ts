import type { MessageCommand } from '@/commands/types';
import type { MessageContextMenuCommandInteraction } from 'discord.js';
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType
} from 'discord.js';

const MAX_PREVIEW_LENGTH = 1500;

function buildMessagePreview(raw: string | undefined): string {
  if (!raw) {
    return 'This message has no text content.';
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return 'This message has no text content.';
  }

  if (trimmed.length <= MAX_PREVIEW_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_PREVIEW_LENGTH)}…`;
}

const command: MessageCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('recruit')
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetMessage = interaction.targetMessage;
    const preview = buildMessagePreview(targetMessage.cleanContent ?? targetMessage.content);
    const attachmentUrls = [...targetMessage.attachments.values()].map((attachment) => attachment.url);

    const attachmentSection =
      attachmentUrls.length > 0 ? `\n\nAttachments:\n${attachmentUrls.map((url) => `• ${url}`).join('\n')}` : '';

    const dmContent = [
      `Forwarded message from ${targetMessage.author?.tag ?? targetMessage.author?.username ?? 'Unknown user'}`,
      `Link: ${targetMessage.url}`,
      '',
      preview,
      attachmentSection
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await interaction.user.send({ content: dmContent });
    } catch (err) {
      await logDmFailure(err, interaction);
      await interaction.editReply('I could not send you that DM. Please check your privacy settings and try again.');
      return;
    }

    await interaction.editReply('Check your DMs for that message!');
  }
};

export default command;

async function logDmFailure(err: unknown, interaction: MessageContextMenuCommandInteraction) {
  const { logger } = await import('@/utils/logger');
  logger.warn(
    { err, userId: interaction.user.id, command: interaction.commandName },
    'Failed to send Recruit message DM'
  );
}
