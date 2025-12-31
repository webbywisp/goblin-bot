import type { ClashOfClansClient, CocPlayer, CocWarMember } from '@/integrations/clashOfClans/client';
import { normalizePlayerTag } from '@/integrations/clashOfClans/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type Message
} from 'discord.js';

// Hero max levels per Town Hall level (from Clash of Clans Wiki)
const HERO_MAX_LEVELS: Record<number, Record<string, number>> = {
  7: {
    'Barbarian King': 10
  },
  8: {
    'Barbarian King': 20,
    'Archer Queen': 10
  },
  9: {
    'Barbarian King': 30,
    'Archer Queen': 30,
    'Minion Prince': 10
  },
  10: {
    'Barbarian King': 40,
    'Archer Queen': 40,
    'Minion Prince': 20
  },
  11: {
    'Barbarian King': 50,
    'Archer Queen': 50,
    'Minion Prince': 30,
    'Grand Warden': 20
  },
  12: {
    'Barbarian King': 65,
    'Archer Queen': 65,
    'Minion Prince': 40,
    'Grand Warden': 40
  },
  13: {
    'Barbarian King': 75,
    'Archer Queen': 75,
    'Minion Prince': 50,
    'Grand Warden': 50,
    'Royal Champion': 25
  },
  14: {
    'Barbarian King': 85,
    'Archer Queen': 85,
    'Minion Prince': 60,
    'Grand Warden': 60,
    'Royal Champion': 30
  },
  15: {
    'Barbarian King': 90,
    'Archer Queen': 90,
    'Minion Prince': 70,
    'Grand Warden': 65,
    'Royal Champion': 40
  },
  16: {
    'Barbarian King': 95,
    'Archer Queen': 95,
    'Minion Prince': 80,
    'Grand Warden': 70,
    'Royal Champion': 45
  },
  17: {
    'Barbarian King': 100,
    'Archer Queen': 100,
    'Minion Prince': 90,
    'Grand Warden': 75,
    'Royal Champion': 50
  },
  18: {
    'Barbarian King': 105,
    'Archer Queen': 105,
    'Minion Prince': 95,
    'Grand Warden': 80,
    'Royal Champion': 55
  }
};

// Emojis for Town Hall levels
const TOWNHALL_EMOJIS: Record<number, string> = {
  1: '🏠',
  2: '🏘️',
  3: '🏛️',
  4: '🏰',
  5: '🏯',
  6: '🏰',
  7: '🏰',
  8: '🏰',
  9: '🏰',
  10: '🏰',
  11: '🏰',
  12: '🏰',
  13: '🏰',
  14: '🏰',
  15: '🏰',
  16: '🏰',
  17: '🏰',
  18: '🏰'
};

// Emojis for heroes
const HERO_EMOJIS: Record<string, string> = {
  'Barbarian King': '👑',
  'Archer Queen': '🏹',
  'Grand Warden': '🛡️',
  'Royal Champion': '⚔️',
  'Minion Prince': '🦇'
};

const EXCLUDED_HEROES = new Set(['Battle Machine', 'Battle Copter']);

function getHeroMaxLevel(heroName: string, townHallLevel: number | undefined): number | undefined {
  if (!townHallLevel || townHallLevel < 1 || townHallLevel > 18) return undefined;
  return HERO_MAX_LEVELS[townHallLevel]?.[heroName];
}

function getTownHallEmoji(townHallLevel: number | undefined): string {
  if (!townHallLevel || townHallLevel < 1 || townHallLevel > 18) return '🏰';
  return TOWNHALL_EMOJIS[townHallLevel] ?? '🏰';
}

function getHeroEmoji(heroName: string): string {
  return HERO_EMOJIS[heroName] ?? '⚔️';
}

function buildClanLine(clan: CocPlayer['clan'] | undefined): string {
  if (!clan?.name) return 'Clan: None';
  const tagNoHash = clan.tag?.replace(/^#/, '');
  if (!tagNoHash) return `Clan: ${clan.name}`;
  const url = `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(tagNoHash)}`;
  return `Clan: [${clan.name}](<${url}>)`;
}

function formatCocTime(input?: string): string | undefined {
  if (!input) return undefined;
  const iso = input.includes('.') ? input : input.replace(/(\.\d{3}Z)?$/, '.000Z');
  // CoC uses e.g. 20250101T000000.000Z
  const normalized = iso.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/, '$1-$2-$3T$4:$5:$6.$7Z');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return undefined;
  return `<t:${Math.floor(d.getTime() / 1000)}:R>`;
}

function findMember(members: CocWarMember[] | undefined, tag: string): CocWarMember | undefined {
  return (members ?? []).find((m) => m.tag === tag);
}

type WarAttackRow = {
  stars: number;
  destructionPercentage: number;
  defenderTownHall?: number;
  opponentName?: string;
  warType: 'Current war' | 'CWL';
  warEnds?: string;
};

function collectAttacksFromWar(opts: {
  warType: WarAttackRow['warType'];
  playerTag: string;
  clanName?: string;
  opponentName?: string;
  clanMembers?: CocWarMember[];
  opponentMembers?: CocWarMember[];
  warEnds?: string;
}): WarAttackRow[] {
  const attacker = findMember(opts.clanMembers, opts.playerTag);
  if (!attacker?.attacks?.length) return [];

  return attacker.attacks.map((a) => {
    const defender = findMember(opts.opponentMembers, a.defenderTag);
    return {
      stars: a.stars,
      destructionPercentage: a.destructionPercentage,
      defenderTownHall: defender?.townhallLevel,
      opponentName: opts.opponentName,
      warType: opts.warType,
      warEnds: opts.warEnds
    };
  });
}

export async function findExistingThreadByPlayerTag(
  channel: Message['channel'],
  playerTag: string
): Promise<AnyThreadChannel | null> {
  if (!channel.isTextBased() || channel.isDMBased()) return null;
  if (!('guild' in channel) || !channel.guild) return null;

  try {
    const normalizedTag = normalizePlayerTag(playerTag).toUpperCase();
    const tagWithoutHash = normalizedTag.replace(/^#/, '');
    const fetched = await channel.guild.channels.fetchActiveThreads();

    // Check threads in this channel
    const candidateThreads = Array.from(fetched.threads.values()).filter((thread) => {
      if (thread.parentId !== channel.id) return false;
      if (thread.archived) return false;
      return true;
    });

    // Search each thread's messages for the player tag
    for (const thread of candidateThreads) {
      try {
        // Fetch the first few messages (recruit threads have the tag in the first embed)
        const messages = await thread.messages.fetch({ limit: 5 });
        for (const message of messages.values()) {
          // Check message content
          if (message.content && message.content.toUpperCase().includes(tagWithoutHash)) {
            return thread;
          }
          // Check embeds (player tag is typically in the embed title)
          for (const embed of message.embeds) {
            const title = embed.title?.toUpperCase() ?? '';
            const description = embed.description?.toUpperCase() ?? '';
            if (title.includes(tagWithoutHash) || description.includes(tagWithoutHash)) {
              return thread;
            }
            // Check embed fields
            for (const field of embed.fields ?? []) {
              const fieldName = field.name.toUpperCase();
              const fieldValue = field.value.toUpperCase();
              if (fieldName.includes(tagWithoutHash) || fieldValue.includes(tagWithoutHash)) {
                return thread;
              }
            }
          }
        }
      } catch {
        // Skip threads we can't read
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function findExistingThreadByMessageId(
  channel: Message['channel'],
  messageId: string
): Promise<AnyThreadChannel | null> {
  if (!channel.isTextBased() || channel.isDMBased()) return null;
  if (!('guild' in channel) || !channel.guild) return null;

  try {
    const fetched = await channel.guild.channels.fetchActiveThreads();

    // Check threads in this channel
    const candidateThreads = Array.from(fetched.threads.values()).filter((thread) => {
      if (thread.parentId !== channel.id) return false;
      if (thread.archived) return false;
      return true;
    });

    // Search each thread's messages for the message ID reference
    for (const thread of candidateThreads) {
      try {
        // Fetch the first few messages to check for message ID references
        const messages = await thread.messages.fetch({ limit: 10 });
        for (const message of messages.values()) {
          // Check message content for message link or ID
          if (message.content && message.content.includes(messageId)) {
            return thread;
          }
          // Check embeds for message references
          for (const embed of message.embeds) {
            const description = embed.description ?? '';
            const footer = embed.footer?.text ?? '';
            if (description.includes(messageId) || footer.includes(messageId)) {
              return thread;
            }
          }
        }
      } catch {
        // Skip threads we can't read
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function ensureRecruitThreadFromMessage(
  parentMessage: Message,
  threadName: string
): Promise<AnyThreadChannel | null> {
  if (parentMessage.channel.isThread()) {
    return parentMessage.channel;
  }
  if (parentMessage.hasThread && parentMessage.thread) {
    return parentMessage.thread;
  }

  try {
    return await parentMessage.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay
    });
  } catch {
    return null;
  }
}

type PopulateRecruitThreadOptions = {
  thread: AnyThreadChannel;
  player: CocPlayer;
  client: ClashOfClansClient;
  customBaseId: string;
  replyMessageId: string;
  originalMessageSummary?: string;
  originalMessageNote?: string;
};

export function buildRecruitActionRow({
  player,
  replyMessageId
}: {
  player: CocPlayer;
  replyMessageId: string;
}): ActionRowBuilder<ButtonBuilder> {
  const tagNoHash = player.tag.replace('#', '');
  const th = typeof player.townHallLevel === 'number' ? player.townHallLevel : 0;

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`recruit:accept:${th}:${tagNoHash}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('Ping Leaders')
    .setDisabled(th <= 0);
  const settingsBtn = new ButtonBuilder()
    .setCustomId(`recruit:settings:${th}:${tagNoHash}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⚙️')
    .setLabel('Settings')
    .setDisabled(th <= 0);
  const closeBtn = new ButtonBuilder()
    .setCustomId(`recruit:close:${tagNoHash}:${replyMessageId}`)
    .setStyle(ButtonStyle.Danger)
    .setLabel('Close');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, settingsBtn, closeBtn);
}

export function buildRecruitCloseButton({
  replyMessageId
}: {
  replyMessageId: string;
}): ActionRowBuilder<ButtonBuilder> {
  // Use "no-tag" as tagNoHash placeholder when there's no player tag
  const closeBtn = new ButtonBuilder()
    .setCustomId(`recruit:close:no-tag:${replyMessageId}`)
    .setStyle(ButtonStyle.Danger)
    .setLabel('Close');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(closeBtn);
}

export async function populateRecruitThread({
  thread,
  player,
  client,
  customBaseId,
  replyMessageId,
  originalMessageSummary,
  originalMessageNote
}: PopulateRecruitThreadOptions): Promise<void> {
  const heroes = (player.heroes ?? []).filter((h) => {
    const name = (h?.name ?? '').trim();
    if (name.length === 0) return false;
    return !EXCLUDED_HEROES.has(name);
  });
  const thLevel = player.townHallLevel;
  const heroesValue =
    heroes.length > 0
      ? heroes
          .map((h) => {
            const heroMax = getHeroMaxLevel(h.name, thLevel);
            const max = heroMax !== undefined ? `/${heroMax}` : '';
            const emoji = getHeroEmoji(h.name);
            return `${emoji} ${h.name}: ${h.level}${max}`;
          })
          .join('\n')
      : 'Unknown';

  const leagueName = player.leagueTier?.name ?? player.league?.name ?? 'Unranked';
  const trophies = typeof player.trophies === 'number' ? `${player.trophies} trophies` : 'Unknown trophies';
  const leagueRankValue = `${leagueName} (${trophies})`;
  const leagueThumbnail = player.leagueTier?.iconUrls?.medium ?? player.leagueTier?.iconUrls?.small ?? undefined;

  const thEmoji = getTownHallEmoji(thLevel);
  const thValue = thLevel !== undefined ? `${thEmoji} TH${thLevel}` : 'Unknown';

  const embedTitle = `${player.name} (${player.tag})`;
  const descriptionLines = [
    buildClanLine(player.clan),
    originalMessageSummary ? `Source: ${originalMessageSummary}` : undefined,
    originalMessageNote
  ].filter(Boolean);

  // ---- Build paginated embeds ----
  const overviewEmbed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setDescription(descriptionLines.join('\n'))
    .addFields(
      { name: 'Town Hall', value: thValue, inline: true },
      { name: 'Current league rank', value: leagueRankValue, inline: true },
      { name: 'EXP level', value: String(player.expLevel ?? 'Unknown'), inline: true },
      { name: 'Hero levels', value: heroesValue, inline: false }
    )
    .setFooter({ text: 'Page 1/2 • Overview' });

  if (leagueThumbnail) {
    overviewEmbed.setThumbnail(leagueThumbnail);
  }

  // War page: uses current war + CWL war tags (if available).
  let warSummaryLines: string[] = [];
  let warRecentLines: string[] = [];

  if (!player.clan?.tag) {
    warSummaryLines = ['No clan on profile — cannot look up war attacks.'];
  } else {
    const clanTag = player.clan.tag;

    // Current war attacks (if in war)
    try {
      const currentWar = await client.getCurrentWarByClanTag(clanTag);
      if (currentWar?.state && currentWar.state !== 'notInWar') {
        const opponentName = currentWar.opponent?.name;
        const ends = formatCocTime(currentWar.endTime);
        const rows = collectAttacksFromWar({
          warType: 'Current war',
          playerTag: player.tag,
          opponentName,
          clanMembers: currentWar.clan?.members,
          opponentMembers: currentWar.opponent?.members,
          warEnds: ends
        });

        if (rows.length > 0) {
          warSummaryLines.push(`Current war: ${rows.length} attack(s) found${ends ? ` • ends ${ends}` : ''}`);
          warRecentLines.push(
            ...rows.slice(0, 5).map((r) => {
              const th = r.defenderTownHall ? `TH${r.defenderTownHall}` : 'TH?';
              const opp = r.opponentName ? ` vs ${r.opponentName}` : '';
              return `- ⭐${r.stars} • ${r.destructionPercentage}% • ${th}${opp}`;
            })
          );
        } else {
          warSummaryLines.push('Current war: no attacks found for this player.');
        }
      } else {
        warSummaryLines.push('Current war: clan is not in war.');
      }
    } catch {
      warSummaryLines.push('Current war: unavailable (API restriction or clan data not accessible).');
    }

    // CWL attacks (if league group is available)
    try {
      const group = await client.getWarLeagueGroupByClanTag(clanTag);
      const warTags =
        (group.rounds ?? [])
          .flatMap((r) => r.warTags ?? [])
          .filter((t) => t && t !== '#0')
          .slice(0, 8) ?? [];

      const cwlRows: WarAttackRow[] = [];
      for (const warTag of warTags) {
        try {
          const war = await client.getCwlWarByTag(warTag);
          const isClanSide = war.clan?.tag === clanTag;
          const ourSide = isClanSide ? war.clan : war.opponent;
          const theirSide = isClanSide ? war.opponent : war.clan;
          const ends = formatCocTime(war.endTime);

          cwlRows.push(
            ...collectAttacksFromWar({
              warType: 'CWL',
              playerTag: player.tag,
              opponentName: theirSide?.name,
              clanMembers: ourSide?.members,
              opponentMembers: theirSide?.members,
              warEnds: ends
            })
          );
        } catch {
          // ignore individual war failures
        }
      }

      if (cwlRows.length > 0) {
        const totalStars = cwlRows.reduce((s, r) => s + r.stars, 0);
        const totalPct = cwlRows.reduce((s, r) => s + r.destructionPercentage, 0);
        const avgStars = (totalStars / cwlRows.length).toFixed(2);
        const avgPct = (totalPct / cwlRows.length).toFixed(1);
        warSummaryLines.push(`CWL: ${cwlRows.length} attack(s) • avg ⭐${avgStars} • avg ${avgPct}%`);

        const remaining = Math.max(0, 5 - warRecentLines.length);
        if (remaining > 0) {
          warRecentLines.push(
            ...cwlRows.slice(0, remaining).map((r) => {
              const th = r.defenderTownHall ? `TH${r.defenderTownHall}` : 'TH?';
              const opp = r.opponentName ? ` vs ${r.opponentName}` : '';
              const ends = r.warEnds ? ` • ends ${r.warEnds}` : '';
              return `- ⭐${r.stars} • ${r.destructionPercentage}% • ${th}${opp}${ends}`;
            })
          );
        }
      } else {
        warSummaryLines.push('CWL: no attack history found (not in CWL, or data not available).');
      }
    } catch {
      warSummaryLines.push('CWL: unavailable (clan not in league group or API restriction).');
    }
  }

  if (warRecentLines.length === 0) {
    warRecentLines = ['No attack-level data available from the official API for this player right now.'];
  }

  const warEmbed = new EmbedBuilder()
    .setTitle(`${embedTitle} — War performance`)
    .setDescription(
      [
        '**Recent attacks (best-effort)**',
        ...warRecentLines,
        '',
        '**Summary**',
        ...warSummaryLines.map((l) => `- ${l}`),
        '',
        '_Note: The official CoC API does not expose “player war log” for regular past wars; attack-level history is only available for current war and CWL wars._'
      ].join('\n')
    )
    .setFooter({ text: 'Page 2/2 • War performance' });

  const pages = [overviewEmbed, warEmbed];
  let pageIndex = 0;

  const prevBtn = new ButtonBuilder()
    .setCustomId(`${customBaseId}:prev`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Prev')
    .setDisabled(true);
  const nextBtn = new ButtonBuilder()
    .setCustomId(`${customBaseId}:next`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next')
    .setDisabled(pages.length <= 1);

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);

  const actionRow = buildRecruitActionRow({ player, replyMessageId });

  const pagedMessage = await thread.send({
    embeds: [pages[pageIndex]],
    components: [navRow, actionRow]
  });

  const collector = pagedMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.customId === `${customBaseId}:prev` || i.customId === `${customBaseId}:next`,
    time: 15 * 60 * 1000
  });

  collector.on('collect', async (i) => {
    if (i.customId === `${customBaseId}:prev`) pageIndex = Math.max(0, pageIndex - 1);
    if (i.customId === `${customBaseId}:next`) pageIndex = Math.min(pages.length - 1, pageIndex + 1);

    prevBtn.setDisabled(pageIndex === 0);
    nextBtn.setDisabled(pageIndex === pages.length - 1);
    const updatedNavRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);

    await i.update({ embeds: [pages[pageIndex]], components: [updatedNavRow, actionRow] });
  });

  collector.on('end', async () => {
    try {
      prevBtn.setDisabled(true);
      nextBtn.setDisabled(true);
      const disabledNavRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);
      await pagedMessage.edit({ components: [disabledNavRow, actionRow] });
    } catch {
      // ignore
    }
  });
}
