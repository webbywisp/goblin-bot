import type { MessageCommand } from '@/commands/types';
import { ClashOfClansClient, isValidPlayerTag, normalizePlayerTag } from '@/integrations/clashOfClans/client';
import {
  findRecruitThreadDestination,
  getRecruitClans,
  getRecruitCommunityInviteUrl,
  getRecruitDmTemplates
} from '@/recruit/configStore';
import {
  buildRecruitActionRow,
  buildRecruitCloseButton,
  ensureRecruitThreadFromMessage
} from '@/recruit/createRecruitThread';
import { buildRecruiterDmComponents } from '@/recruit/dmCoordinator';
import { createRecruitDmSession, updateRecruitDmSession } from '@/recruit/dmSessionStore';
import {
  clearOpenApplicantThreadByThreadId,
  getOpenApplicantThread,
  getOpenThreadByMessageId,
  registerOpenApplicantThread,
  releaseApplicantLock,
  releaseMessageIdLock,
  tryLockApplicant,
  tryLockMessageId
} from '@/recruit/openApplicantStore';
import { logger } from '@/utils/logger';
import type { ActionRowBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
  type Guild,
  type Message,
  type NewsChannel,
  type TextChannel,
  type User
} from 'discord.js';

const TAG_REGEX = /#[0-9A-Z]{3,15}/gi;
const USER_MENTION_REGEX = /<@!?(\d{17,21})>/g;

const PLACEHOLDER_EMOJIS: Record<string, string> = {
  th1: '🏠',
  th2: '🏘️',
  th3: '🏛️',
  th4: '🏰',
  th5: '🏯',
  th6: '🏰',
  th7: '🏰',
  th8: '🏰',
  th9: '🏰',
  th10: '🏰',
  th11: '🏰',
  th12: '🏰',
  th13: '🏰',
  th14: '🏰',
  th15: '🏰',
  th16: '🏰',
  th17: '🏰',
  th18: '🏰',
  bk: '👑',
  aq: '🏹',
  gw: '🛡️',
  rc: '⚔️',
  mp: '🦇'
};

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

function sanitizeThreadName(input: string | undefined): string {
  if (!input) return '';
  return input.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
}

function collectMessageTextSources(message: Message): string[] {
  const sources: string[] = [];
  if (message.content) sources.push(message.content);

  for (const embed of message.embeds ?? []) {
    if (embed.title) sources.push(embed.title);
    if (embed.description) sources.push(embed.description);
    if (embed.author?.name) sources.push(embed.author.name);
    if (embed.footer?.text) sources.push(embed.footer.text);
    for (const field of embed.fields ?? []) {
      if (field.name) sources.push(field.name);
      if (field.value) sources.push(field.value);
    }
  }

  return sources;
}

async function resolveFirstMentionedUser(message: Message): Promise<User | null> {
  const sources = collectMessageTextSources(message);
  for (const text of sources) {
    USER_MENTION_REGEX.lastIndex = 0;
    const match = USER_MENTION_REGEX.exec(text);
    if (!match?.[1]) continue;
    const targetId = match[1];
    const user = await message.client.users.fetch(targetId).catch(() => null);
    if (user) {
      return user;
    }
  }
  return null;
}

async function resolveApplicantUser(message: Message): Promise<User | null> {
  if (!message.author.bot) return message.author;
  if (message.interactionMetadata?.user) return message.interactionMetadata.user;
  if (message.interaction?.user) return message.interaction.user ?? null;
  return await resolveFirstMentionedUser(message);
}

type ForwardedPayload = {
  content?: string;
  embeds?: ReturnType<EmbedBuilder['toJSON']>[];
  files?: { attachment: string; name: string }[];
};

async function buildEmojiLookup(guild?: Guild | null): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!guild) return map;
  if (guild.emojis.cache.size === 0) {
    await guild.emojis.fetch().catch(() => null);
  }
  for (const emoji of guild.emojis.cache.values()) {
    const name = emoji.name?.toLowerCase();
    if (!name) continue;
    map.set(name, emoji.toString());
  }
  return map;
}

function replacePlaceholderEmojis(text: string | null | undefined, emojiMap: Map<string, string>): string | undefined {
  if (!text) return text ?? undefined;

  // Regex breakdown:
  // 1. <a?:([a-zA-Z0-9_]+):[0-9]+>  -> Matches full custom emojis (static or animated), capturing the name in Group 1
  // 2. |                            -> OR
  // 3. :([a-zA-Z0-9_]+):            -> Matches shortcodes, capturing the name in Group 2
  return text.replace(/<a?:([a-zA-Z0-9_]+):[0-9]+>|:([a-zA-Z0-9_]+):/gi, (match, nameInTag, nameInShortcode) => {
    // Get the name from whichever group matched
    const name = nameInTag || nameInShortcode;
    if (!name) return match;

    const key = name.toLowerCase();
    const custom = emojiMap.get(key);

    // If we have a matching custom emoji in the destination guild, use it.
    // This replaces the WHOLE match (including brackets if it was a tag), fixing the nesting issue.
    if (custom) return custom;

    // Check fallbacks
    const fallback = PLACEHOLDER_EMOJIS[key];

    // If we have a fallback, use it. Otherwise, leave the original text exactly as it was.
    return fallback ?? match;
  });
}

async function buildForwardedMessagePayload(message: Message, guild?: Guild | null): Promise<ForwardedPayload | null> {
  const emojiMap = await buildEmojiLookup(guild);
  const headerText = message.url
    ? `Original message forwarded from ${message.url}`
    : message.author
      ? `Original message forwarded from ${message.author.tag}`
      : 'Original message forwarded';
  const header = replacePlaceholderEmojis(headerText, emojiMap);
  const body = replacePlaceholderEmojis(message.content?.trim(), emojiMap);
  const content = [header, body].filter(Boolean).join('\n\n');

  const embeds =
    message.embeds.length > 0
      ? message.embeds.map((embed) => {
          const cloned = EmbedBuilder.from(embed);
          const title = replacePlaceholderEmojis(cloned.data.title, emojiMap);
          if (title) cloned.setTitle(title);
          const description = replacePlaceholderEmojis(cloned.data.description, emojiMap);
          if (description) cloned.setDescription(description);
          if (cloned.data.footer?.text) {
            const footerText = replacePlaceholderEmojis(cloned.data.footer.text, emojiMap) ?? cloned.data.footer.text;
            if (footerText) {
              cloned.setFooter({
                text: footerText,
                iconURL: cloned.data.footer.icon_url ?? undefined
              });
            }
          }
          if (cloned.data.author?.name) {
            const authorName = replacePlaceholderEmojis(cloned.data.author.name, emojiMap) ?? cloned.data.author.name;
            if (authorName) {
              cloned.setAuthor({
                name: authorName,
                url: cloned.data.author.url ?? undefined,
                iconURL: cloned.data.author.icon_url ?? undefined
              });
            }
          }
          if (cloned.data.fields) {
            const fields = cloned.data.fields.map((field) => ({
              name: replacePlaceholderEmojis(field.name, emojiMap) ?? field.name,
              value: replacePlaceholderEmojis(field.value, emojiMap) ?? field.value,
              inline: field.inline
            }));
            cloned.setFields(fields);
          }
          return cloned.toJSON();
        })
      : undefined;
  const files =
    message.attachments.size > 0
      ? Array.from(message.attachments.values()).map((attachment) => ({
          attachment: attachment.url,
          name: attachment.name ?? `attachment-${attachment.id}`
        }))
      : undefined;

  if (!content && (!embeds || embeds.length === 0) && (!files || files.length === 0)) {
    return null;
  }

  return { content: content || undefined, embeds, files };
}

async function resolveDestinationChannel(client: Message['client']): Promise<{
  guildId: string;
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

  return { guildId: destination.guildId, guildName: guild.name, channel: channel as TextChannel | NewsChannel };
}

const command: MessageCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Recruit this goblin')
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
    const sourceMessageId = interaction.targetMessage.id;
    const cocClient = new ClashOfClansClient();
    let pendingApplicantLockId: string | null = null;
    let pendingMessageIdLock: string | null = null;
    let normalizedPlayerTag: string | null = null;
    let player: Awaited<ReturnType<typeof cocClient.getPlayerByTag>> | null = null;
    let noPlayerTagWarning = false;

    try {
      // Always check for duplicates by message ID first (fast in-memory lookup)
      const existingByMessageId = getOpenThreadByMessageId(sourceMessageId);
      if (existingByMessageId) {
        const existingChannel = await interaction.client.channels.fetch(existingByMessageId.threadId).catch(() => null);
        const isStillOpen = existingChannel?.isThread() && !existingChannel.archived;
        if (isStillOpen) {
          await interaction.editReply(
            `A recruit thread already exists for this message: <#${existingByMessageId.threadId}>.\n` +
              'Close the existing thread before creating another.'
          );
          return;
        }
        clearOpenApplicantThreadByThreadId(existingByMessageId.threadId);
      }

      // Lock the message ID to prevent race conditions
      if (!tryLockMessageId(sourceMessageId)) {
        // If lock fails, check one more time if a thread exists (race condition)
        const existingByMessageIdAfterLock = getOpenThreadByMessageId(sourceMessageId);
        if (existingByMessageIdAfterLock) {
          const existingChannel = await interaction.client.channels
            .fetch(existingByMessageIdAfterLock.threadId)
            .catch(() => null);
          const isStillOpen = existingChannel?.isThread() && !existingChannel.archived;
          if (isStillOpen) {
            await interaction.editReply(
              `A recruit thread already exists for this message: <#${existingByMessageIdAfterLock.threadId}>.\n` +
                'Close the existing thread before creating another.'
            );
            return;
          }
        }
        // If no thread found, another recruiter is creating one concurrently
        await interaction.editReply(
          'Another recruiter is already creating a recruit thread for this message. Please try again shortly.'
        );
        return;
      }
      pendingMessageIdLock = sourceMessageId;

      // Try to extract player tag and fetch player data (optional)
      if (playerTag) {
        normalizedPlayerTag = normalizePlayerTag(playerTag);
        try {
          player = await cocClient.getPlayerByTag(playerTag);
        } catch {
          // If player lookup fails, treat as no player tag case
          normalizedPlayerTag = null;
          player = null;
          noPlayerTagWarning = true;
        }
      } else {
        noPlayerTagWarning = true;
      }

      // Resolve applicant user once
      const applicantUser = await resolveApplicantUser(interaction.targetMessage);

      // Build thread name
      let threadName: string;
      if (player) {
        const thValue =
          typeof player.townHallLevel === 'number' && player.townHallLevel > 0 ? player.townHallLevel : '?';
        const safePlayerName = sanitizeThreadName(player.name) || player.tag.replace('#', '');
        const applicantUsername = applicantUser && !applicantUser.bot ? ` @${applicantUser.username}` : '';
        threadName = `${safePlayerName} TH ${thValue} (Discord)${applicantUsername}`;
      } else {
        // Get guild name from the original message
        const sourceGuild = interaction.targetMessage.guild;
        const guildName = sourceGuild ? sanitizeThreadName(sourceGuild.name) : '';
        const applicantUsername = applicantUser && !applicantUser.bot ? ` @${applicantUser.username}` : '';
        if (guildName && applicantUsername) {
          threadName = `${guildName}${applicantUsername} (Discord)`;
        } else if (applicantUsername) {
          threadName = `${applicantUsername} (Discord)`;
        } else {
          threadName = 'Recruit (Discord)';
        }
      }

      if (applicantUser && !applicantUser.bot && applicantUser.id !== interaction.user.id) {
        const existing = getOpenApplicantThread(applicantUser.id);
        if (existing) {
          const existingChannel = await interaction.client.channels.fetch(existing.threadId).catch(() => null);
          const isStillOpen = existingChannel?.isThread() && !existingChannel.archived;
          if (isStillOpen) {
            await interaction.editReply(
              `That applicant already has an open recruit thread: <#${existing.threadId}>.\n` +
                'Close the existing thread before starting another.'
            );
            return;
          }

          clearOpenApplicantThreadByThreadId(existing.threadId);
        }
        if (!tryLockApplicant(applicantUser.id)) {
          await interaction.editReply(
            'Another recruiter is already creating a recruit thread for this applicant. Please try again shortly.'
          );
          return;
        }
        pendingApplicantLockId = applicantUser.id;
      }

      const statusMessageContent = player
        ? `Creating recruit thread for ${player.name} (tag ${player.tag}) requested by ${interaction.user}.`
        : `Creating recruit thread for message requested by ${interaction.user}.`;
      const statusMessage = await destination.channel.send({
        content: statusMessageContent
      });

      const thread = await ensureRecruitThreadFromMessage(statusMessage, threadName);
      if (!thread) {
        await statusMessage.edit('Failed to create a recruit thread in this channel.');
        await interaction.editReply('I could not create a thread in the configured channel. Check my permissions.');
        return;
      }

      const forwardedPayload = await buildForwardedMessagePayload(interaction.targetMessage, thread.guild);
      const payload: ForwardedPayload = forwardedPayload ?? {
        content: `Forwarded message unavailable. Use the original link for context: ${interaction.targetMessage.url}`
      };

      // Add warning if no player tag was found
      if (noPlayerTagWarning) {
        const warningText = `⚠️ **Warning:** Could not find a valid player tag in the original message. Creating recruit thread anyway.`;
        payload.content = payload.content ? `${warningText}\n\n${payload.content}` : warningText;
      }

      // Add action row - full buttons if we have player data, close button only if not
      if (player) {
        const actionRow = buildRecruitActionRow({ player, replyMessageId: statusMessage.id });
        await thread.send({
          ...payload,
          components: [actionRow],
          allowedMentions: { parse: [] }
        });
      } else {
        const closeButtonRow = buildRecruitCloseButton({
          replyMessageId: statusMessage.id
        });
        await thread.send({
          ...payload,
          components: [closeButtonRow],
          allowedMentions: { parse: [] }
        });
      }

      // Register the thread in the store to prevent duplicates (always by message ID)
      if (pendingApplicantLockId && applicantUser && !applicantUser.bot) {
        registerOpenApplicantThread({
          applicantId: applicantUser.id,
          applicantTag: applicantUser.tag,
          threadId: thread.id,
          threadUrl: `https://discord.com/channels/${thread.guildId ?? '@me'}/${thread.id}`,
          playerTag: normalizedPlayerTag ?? '',
          guildId: thread.guildId ?? destination.guildId,
          sourceMessageId: sourceMessageId
        });
        pendingApplicantLockId = null;
        pendingMessageIdLock = null;
      } else if (pendingMessageIdLock) {
        // Register thread by message ID
        const placeholderApplicantId = applicantUser
          ? applicantUser.bot
            ? `message-id:${sourceMessageId}`
            : applicantUser.id
          : `message-id:${sourceMessageId}`;
        registerOpenApplicantThread({
          applicantId: placeholderApplicantId,
          applicantTag: applicantUser?.tag ?? player?.name ?? 'Unknown',
          threadId: thread.id,
          threadUrl: `https://discord.com/channels/${thread.guildId ?? '@me'}/${thread.id}`,
          playerTag: normalizedPlayerTag ?? '',
          guildId: thread.guildId ?? destination.guildId,
          sourceMessageId: sourceMessageId
        });
        pendingMessageIdLock = null;
      }

      const baseReply = `Thread created in ${destination.guildName}: <#${thread.id}>`;
      let replyContent = baseReply;
      let dmComponents: ActionRowBuilder<MessageActionRowComponentBuilder>[] | undefined;

      if (noPlayerTagWarning) {
        replyContent = `${baseReply}\n⚠️ **Note:** Could not find a valid player tag in that message, but created the recruit thread anyway.`;
      }

      if (!applicantUser) {
        replyContent = `${replyContent}\nCould not determine who to DM from that message.`;
      } else if (applicantUser.bot) {
        replyContent = `${replyContent}\nSkipped the DM because the detected applicant is a bot.`;
      } else if (applicantUser.id === interaction.user.id) {
        replyContent = `${replyContent}\nYou invoked this command on your own message, so no DM was opened.`;
      } else if (player) {
        // Only set up DM if we have player data
        const [dmTemplates, clanConfigs, communityInviteUrl] = await Promise.all([
          getRecruitDmTemplates(destination.guildId),
          getRecruitClans(destination.guildId),
          getRecruitCommunityInviteUrl(destination.guildId)
        ]);

        const session = createRecruitDmSession({
          guildId: destination.guildId,
          threadId: thread.id,
          threadUrl: `https://discord.com/channels/${thread.guildId ?? '@me'}/${thread.id}`,
          homeGuildName: destination.guildName,
          recruiterId: interaction.user.id,
          recruiterTag: interaction.user.tag,
          applicantId: applicantUser.id,
          applicantTag: applicantUser.tag,
          applicantDisplayName: applicantUser.username,
          player: {
            name: player.name,
            tag: player.tag,
            townHallLevel: player.townHallLevel
          },
          originalMessageUrl: interaction.targetMessage.url,
          communityInviteUrl: communityInviteUrl,
          clans: clanConfigs,
          templates: dmTemplates,
          statusMessage: baseReply
        });

        const recruiterRows = buildRecruiterDmComponents(session);
        if (recruiterRows.length > 0) {
          replyContent = `${replyContent}\nSelect a DM template below to copy and DM <@${applicantUser.id}>.`;
          dmComponents = recruiterRows;
          updateRecruitDmSession(session.id, { statusMessage: replyContent });
        } else {
          replyContent = `${replyContent}\nNo DM templates are configured yet. Update your recruit settings to enable DM outreach.`;
        }
      }

      await statusMessage.edit(`Recruit thread created by <@${interaction.user.id}>: <#${thread.id}>`);

      await interaction.editReply({
        content: replyContent,
        components: dmComponents
      });
    } catch (err) {
      logger.error(
        { err, command: 'message/recruit', playerTag: playerTag ?? 'none', sourceMessageId },
        'Failed to create recruit thread from message'
      );
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply(`Could not create recruit thread: ${msg}`);
    } finally {
      if (pendingApplicantLockId) {
        releaseApplicantLock(pendingApplicantLockId);
      }
      if (pendingMessageIdLock) {
        releaseMessageIdLock(pendingMessageIdLock);
      }
    }
  }
};

export default command;
