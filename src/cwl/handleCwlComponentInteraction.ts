import { getChatInputCommandMap } from '@/bot/state';
import { calculateClanBonusMedals, displayResults } from '@/commands/chat-input/cwl-bonus-medals';
import { loadCachedWar } from '@/cwl/cwlDataCache';
import { getPaginationState } from '@/cwl/handleCwlNavigation';
import { ClashOfClansClient } from '@/integrations/clashOfClans/client';
import { getRecruitClans } from '@/recruit/configStore';
import { logger } from '@/utils/logger';
import type { ChatInputCommandInteraction, StringSelectMenuInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

// Store results temporarily (in-memory, cleared on restart)
// In production, you might want to use a more persistent storage
type CachedMember = {
  tag: string;
  name: string;
  townHallLevel?: number;
  totalPoints: number;
  totalAttacks: number;
  normalizedPoints: number;
  disqualified: boolean;
  disqualificationReason?: string;
  flaggedForReview: boolean;
  mirrorRuleViolations: Array<{ warIndex: number; opponentName: string; attackedTag?: string; mirrorTag?: string }>;
  attackDetails: Array<{
    warIndex: number;
    opponentName: string;
    stars: number;
    defenderTag: string;
    defenderTownHall?: number;
    wasHigherTh: boolean;
    wasMirror: boolean;
  }>;
  defenseDetails: Array<{
    warIndex: number;
    opponentName: string;
    starsDefended: number;
  }>;
};

type CachedResults = Array<{
  clanTag: string;
  clanName: string;
  members: CachedMember[];
}>;

const resultsCache = new Map<string, CachedResults>();

export function storeCwlResults(cacheKey: string, results: CachedResults): void {
  resultsCache.set(cacheKey, results);
  // Clean up old cache entries (keep last 10)
  if (resultsCache.size > 10) {
    const oldestKey = resultsCache.keys().next().value;
    if (oldestKey) {
      resultsCache.delete(oldestKey);
    }
  }
}

export async function handleCwlComponentInteraction(interaction: StringSelectMenuInteraction): Promise<boolean> {
  const isFlagged = interaction.customId.startsWith('cwl:flagged:');
  const isInspect = interaction.customId.startsWith('cwl:inspect:');
  const isMonthSelect = interaction.customId.startsWith('cwl:select-month:');
  const isExportDay = interaction.customId.startsWith('cwl:export-day:');

  if (!isFlagged && !isInspect && !isMonthSelect && !isExportDay) {
    return false;
  }

  // Handle export day selection
  if (isExportDay) {
    const parts = interaction.customId.split(':');
    const interactionId = parts[2];
    const clanTag = parts[3];

    const selectedDay = interaction.values?.[0];
    if (!selectedDay) {
      await interaction.reply({ content: 'Please select a day.', ephemeral: true });
      return true;
    }

    const day = parseInt(selectedDay, 10);
    if (isNaN(day) || day < 1 || day > 7) {
      await interaction.reply({ content: 'Invalid day selected.', ephemeral: true });
      return true;
    }

    // Get dateKey from pagination state
    const state = getPaginationState(interactionId);

    if (!state) {
      await interaction.reply({
        content: 'Export data expired. Please run the command again.',
        ephemeral: true
      });
      return true;
    }

    // Load the JSON file for the selected day
    const war = await loadCachedWar(clanTag, state.dateKey, day);

    if (!war) {
      await interaction.reply({
        content: `No data found for day ${day} of ${state.dateKey}.`,
        ephemeral: true
      });
      return true;
    }

    // Send the JSON file as an attachment
    const jsonString = JSON.stringify(war, null, 2);
    const buffer = Buffer.from(jsonString, 'utf-8');
    const attachment = {
      attachment: buffer,
      name: `cwl-${clanTag.replace('#', '')}-${state.dateKey}-day${day}.json`
    };

    await interaction.reply({
      content: `📥 Exported day ${day} data for ${state.dateKey}`,
      files: [attachment],
      ephemeral: true
    });

    return true;
  }

  // Handle month selection - re-run the command with the selected month
  if (isMonthSelect) {
    const selectedMonth = interaction.values?.[0];
    if (!selectedMonth) {
      await interaction.reply({ content: 'Please select a month.', ephemeral: true });
      return true;
    }

    // Re-run the command with the selected month
    // We need to get the command from the command map and execute it with the month option
    const commandMap = getChatInputCommandMap();
    const cwlCommand = commandMap.get('cwl');

    if (!cwlCommand) {
      await interaction.reply({
        content: 'Command not found. Please run `/cwl bonus-medals` again.',
        ephemeral: true
      });
      return true;
    }

    // Create a synthetic interaction with the month option set
    // Since we can't modify the interaction directly, we'll need to manually execute the command logic
    // For now, let's just update the message to show we're processing
    await interaction.deferUpdate();

    try {
      // storeCwlResults is already available in this file, no need to import

      if (!interaction.guildId) {
        await interaction.followUp({
          content: 'This command can only be used inside a server.',
          ephemeral: true
        });
        return true;
      }

      const clans = await getRecruitClans(interaction.guildId);
      if (clans.length === 0) {
        await interaction.followUp({
          content: 'No clans configured. Use `/settings` to add clans first.',
          ephemeral: true
        });
        return true;
      }

      const client = new ClashOfClansClient();
      const results = [];

      // Use the selected month
      const dateKey = selectedMonth;

      // Fetch CWL data for each clan
      for (const clanConfig of clans) {
        try {
          const clanResults = await calculateClanBonusMedals(client, clanConfig.tag, clanConfig.name, dateKey);
          results.push(clanResults);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          logger.error({ err, clanTag: clanConfig.tag }, 'Failed to calculate CWL bonus medals for clan');
          results.push({
            clanTag: clanConfig.tag,
            clanName: clanConfig.name || clanConfig.tag,
            members: [],
            error: errorMsg
          });
        }
      }

      if (results.length === 0) {
        await interaction.followUp({
          content: 'No clans configured or no data available.',
          ephemeral: true
        });
        return true;
      }

      // Store results for dropdown interaction
      const cacheKey = `${interaction.id}:${Date.now()}`;
      const cachedResults = results.map((r) => ({
        clanTag: r.clanTag,
        clanName: r.clanName,
        members: r.members.map((m) => ({
          tag: m.tag,
          name: m.name,
          townHallLevel: m.townHallLevel,
          totalPoints: m.totalPoints,
          totalAttacks: m.totalAttacks,
          normalizedPoints: m.normalizedPoints,
          disqualified: m.disqualified,
          disqualificationReason: m.disqualificationReason,
          flaggedForReview: m.flaggedForReview,
          mirrorRuleViolations: m.mirrorRuleViolations,
          attackDetails: m.attackDetails,
          defenseDetails: m.defenseDetails
        }))
      }));
      storeCwlResults(cacheKey, cachedResults);

      // Update the message with results
      // Create a wrapper that provides editReply/followUp methods compatible with displayResults
      const interactionWrapper = {
        id: interaction.id,
        editReply: async (options: Parameters<ChatInputCommandInteraction['editReply']>[0]) => {
          // For StringSelectMenuInteraction, we use editReply if it's available, otherwise followUp
          if ('editReply' in interaction && typeof interaction.editReply === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return interaction.editReply(options as any);
          }
          const opts = options as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return interaction.followUp({ ...opts, ephemeral: false } as any);
        },
        followUp: async (options: Parameters<ChatInputCommandInteraction['followUp']>[0]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return interaction.followUp(options as any);
        }
      };
      await displayResults(interactionWrapper, results, cacheKey, dateKey);
    } catch (err) {
      logger.error({ err }, 'Failed to process month selection');
      await interaction.followUp({
        content: `Error: ${err instanceof Error ? err.message : 'Failed to calculate bonus medals.'}`,
        ephemeral: true
      });
    }

    return true;
  }

  // Handle inspect dropdowns with pagination index (format: cwl:inspect:CLANTAG:INDEX)
  // The custom ID format supports pagination: cwl:inspect:CLANTAG or cwl:inspect:CLANTAG:INDEX
  // Both formats work the same way for member lookup

  const selected = interaction.values?.[0];
  if (!selected) {
    await interaction.reply({ content: 'Please select a member.', ephemeral: true });
    return true;
  }

  const [clanTag, memberTag] = selected.split(':');
  if (!clanTag || !memberTag) {
    await interaction.reply({ content: 'Invalid selection.', ephemeral: true });
    return true;
  }

  // Find the member data from cached results
  // We need to get the full member stats, not just cached data
  // Let's search through all cached results
  let memberData: { clanTag: string; clanName: string; member: CachedMember } | null = null;

  for (const results of resultsCache.values()) {
    for (const result of results) {
      if (result.clanTag === clanTag) {
        const member = result.members.find((m: CachedMember) => m.tag === memberTag);
        if (member) {
          memberData = { clanTag: result.clanTag, clanName: result.clanName, member };
          break;
        }
      }
    }
    if (memberData) break;
  }

  if (!memberData) {
    await interaction.reply({
      content: 'Member data not found. The results may have expired. Please run the command again.',
      ephemeral: true
    });
    return true;
  }

  const { member, clanName } = memberData;
  const th = member.townHallLevel ? `TH${member.townHallLevel}` : 'TH?';

  // For inspection, show detailed score breakdown
  if (isInspect) {
    return await showMemberInspection(interaction, member, clanName, th, clanTag);
  }

  // For flagged review, show mirror rule violations
  const embed = new EmbedBuilder()
    .setTitle(`Mirror Rule Review: ${member.name}`)
    .setDescription(`**${clanName}** • ${th}`)
    .setColor(0xff9900);

  if (member.mirrorRuleViolations.length === 0) {
    embed.addFields({
      name: 'Status',
      value: 'No violations found. This member attacked their mirror in all wars.'
    });
  } else {
    const violationsList = member.mirrorRuleViolations
      .map((violation: { warIndex: number; opponentName: string; attackedTag?: string; mirrorTag?: string }) => {
        const warNum = violation.warIndex + 1;
        let details = `**War ${warNum}** vs ${violation.opponentName}`;
        if (violation.mirrorTag && violation.attackedTag) {
          const attackedMirror = violation.attackedTag === violation.mirrorTag;
          details += `\n   Expected: ${violation.mirrorTag}`;
          details += `\n   Attacked: ${violation.attackedTag}`;
          if (!attackedMirror) {
            details += `\n   ⚠️ Did not attack mirror`;
          }
        }
        return details;
      })
      .join('\n');

    embed.addFields({
      name: `⚠️ Potential Violations (${member.mirrorRuleViolations.length})`,
      value: violationsList.length > 1024 ? violationsList.slice(0, 1020) + '...' : violationsList,
      inline: false
    });

    // Show attack details for context
    const attackSummary = member.attackDetails
      .filter((a: { wasMirror: boolean }) => !a.wasMirror)
      .map(
        (a: { warIndex: number; opponentName: string; defenderTag: string }) =>
          `War ${a.warIndex + 1} vs ${a.opponentName}: Attacked ${a.defenderTag}`
      )
      .slice(0, 10)
      .join('\n');

    if (attackSummary) {
      embed.addFields({
        name: 'Non-Mirror Attacks',
        value: attackSummary.length > 1024 ? attackSummary.slice(0, 1020) + '...' : attackSummary || 'None',
        inline: false
      });
    }
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}

async function showMemberInspection(
  interaction: StringSelectMenuInteraction,
  member: CachedMember,
  clanName: string,
  th: string,
  _clanTag: string
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setTitle(`Score Breakdown: ${member.name}`)
    .setDescription(`**${clanName}** • ${th}`)
    .setColor(member.disqualified ? 0xff0000 : member.flaggedForReview ? 0xff9900 : 0x00ae86);

  // Summary
  embed.addFields({
    name: '📊 Summary',
    value:
      `**Total Points:** ${member.totalPoints.toFixed(2)}\n` +
      `**Total Attacks:** ${member.totalAttacks}\n` +
      `**Normalized Points:** ${member.normalizedPoints.toFixed(2)} pts\n` +
      `**Status:** ${member.disqualified ? '❌ Disqualified' : member.flaggedForReview ? '⚠️ Flagged for Review' : '✅ Qualified'}`,
    inline: false
  });

  if (member.disqualificationReason) {
    embed.addFields({
      name: '❌ Disqualification Reason',
      value: member.disqualificationReason,
      inline: false
    });
  }

  // Attack breakdown
  if (member.attackDetails.length > 0) {
    const attackBreakdown = member.attackDetails
      .map((attack) => {
        const basePoints = attack.stars * 2;
        const thBonus = attack.wasHigherTh ? attack.stars : 0;
        const totalPoints = basePoints + thBonus;
        const mirrorMark = attack.wasMirror ? ' 🪞' : '';
        const thMark = attack.wasHigherTh ? ' ⬆️' : '';
        return (
          `**War ${attack.warIndex + 1}** vs ${attack.opponentName}${mirrorMark}\n` +
          `   ${attack.stars}⭐ → ${totalPoints} pts (${basePoints} base${thBonus > 0 ? ` + ${thBonus} TH bonus${thMark}` : ''})`
        );
      })
      .join('\n');

    const truncated = attackBreakdown.length > 1024 ? attackBreakdown.slice(0, 1020) + '...' : attackBreakdown;
    embed.addFields({
      name: `⚔️ Attacks (${member.attackDetails.length})`,
      value: truncated,
      inline: false
    });
  }

  // Defense breakdown
  if (member.defenseDetails.length > 0) {
    const defenseBreakdown = member.defenseDetails
      .map((defense) => {
        const points = defense.starsDefended * 2;
        return (
          `**War ${defense.warIndex + 1}** vs ${defense.opponentName}\n` +
          `   ${defense.starsDefended}⭐ defended → ${points} pts`
        );
      })
      .join('\n');

    const truncated = defenseBreakdown.length > 1024 ? defenseBreakdown.slice(0, 1020) + '...' : defenseBreakdown;
    embed.addFields({
      name: `🛡️ Defenses (${member.defenseDetails.length})`,
      value: truncated,
      inline: false
    });
  }

  // Mirror rule violations (if flagged)
  if (member.flaggedForReview && member.mirrorRuleViolations.length > 0) {
    const violationsList = member.mirrorRuleViolations
      .map((violation) => {
        let details = `**War ${violation.warIndex + 1}** vs ${violation.opponentName}`;
        if (violation.mirrorTag && violation.attackedTag) {
          const attackedMirror = violation.attackedTag === violation.mirrorTag;
          details += `\n   Expected: ${violation.mirrorTag}`;
          details += `\n   Attacked: ${violation.attackedTag}`;
          if (!attackedMirror) {
            details += `\n   ⚠️ Did not attack mirror`;
          }
        }
        return details;
      })
      .join('\n');

    const truncated = violationsList.length > 1024 ? violationsList.slice(0, 1020) + '...' : violationsList;
    embed.addFields({
      name: `⚠️ Mirror Rule Review (${member.mirrorRuleViolations.length})`,
      value: truncated,
      inline: false
    });
  }

  // Calculation explanation
  const calculationText =
    `**Point Formula:**\n` +
    `• Attack: +2 pts per star\n` +
    `• Attack Bonus: +1 pt per star if attacking higher TH\n` +
    `• Defense: +2 pts per star defended\n` +
    `• Normalized: Total points ÷ Total attacks`;

  embed.addFields({
    name: '🧮 Calculation',
    value: calculationText,
    inline: false
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}
