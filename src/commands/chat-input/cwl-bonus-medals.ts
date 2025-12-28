import type { ChatInputCommand } from '@/commands/types';
import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import {
  getDateKey,
  isWarFinished,
  listAvailableMonths,
  loadCachedWar,
  loadCachedWarsForMonth,
  saveWarToCache
} from '@/cwl/cwlDataCache';
import { storeCwlResults } from '@/cwl/handleCwlComponentInteraction';
import { storePaginationState } from '@/cwl/handleCwlNavigation';
import { ClashOfClansClient, type CocCwlWar, type CocWarMember } from '@/integrations/clashOfClans/client';
import { getRecruitClans } from '@/recruit/configStore';
import { getRoleIdsFromMember } from '@/utils/discordRoles';
import { logger } from '@/utils/logger';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';

type MemberStats = {
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
  mirrorAttacks: Set<number>; // Track which wars they attacked mirror
  attackDetails: Array<{
    warIndex: number;
    opponentName: string;
    stars: number;
    defenderTag: string;
    defenderTownHall?: number;
    defenderMapPosition?: number;
    wasHigherTh: boolean;
    bonusAwarded: boolean; // Whether bonus points were actually awarded
    wasMirror: boolean;
  }>;
  defenseDetails: Array<{
    warIndex: number;
    opponentName: string;
    starsDefended: number;
    attackerTownHall?: number;
    attackerMapPosition?: number;
  }>;
};

type ClanResults = {
  clanTag: string;
  clanName: string;
  members: MemberStats[];
  error?: string;
};

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('cwl')
    .setDescription('CWL bonus medal calculations')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('bonus-medals')
        .setDescription('Calculate bonus medals for CWL performance')
        .addStringOption((option) =>
          option
            .setName('month')
            .setDescription(
              'Month to calculate for (YYYY-MM format, e.g., 2025-12). Leave empty to see available months.'
            )
            .setRequired(false)
            .setAutocomplete(true)
        )
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a server.'
      });
      return;
    }

    const guild = interaction.guild;
    const guildId = interaction.guildId;

    const leaderRole =
      guild.roles.cache.get(FAMILY_LEADER_ROLE_ID) ??
      (await guild.roles.fetch(FAMILY_LEADER_ROLE_ID).catch(() => null));

    if (!leaderRole) {
      await interaction.reply({
        content: `The Family Leader role (<@&${FAMILY_LEADER_ROLE_ID}>) is missing in this server. Create it to use this command.`
      });
      return;
    }

    const memberRoleIds = getRoleIdsFromMember(interaction.member);
    const hasLeaderRole = memberRoleIds.has(FAMILY_LEADER_ROLE_ID);

    if (!hasLeaderRole) {
      await interaction.reply({
        content: 'Only Family Leaders can use this command.'
      });
      return;
    }

    if (interaction.options.getSubcommand() !== 'bonus-medals') {
      await interaction.reply({ content: 'Unknown subcommand.' });
      return;
    }

    await interaction.deferReply();

    try {
      const clans = await getRecruitClans(guildId);
      if (clans.length === 0) {
        await interaction.editReply({
          content: 'No clans configured. Use `/settings` to add clans first.'
        });
        return;
      }

      const client = new ClashOfClansClient();
      const results: ClanResults[] = [];

      // Get month from command option or show selection menu
      const monthOption = interaction.options.getString('month');
      let dateKey: string | undefined;

      if (monthOption) {
        // Validate format (YYYY-MM)
        if (/^\d{4}-\d{2}$/.test(monthOption)) {
          dateKey = monthOption;
        } else {
          await interaction.editReply({
            content: 'Invalid month format. Please use YYYY-MM format (e.g., 2025-12).'
          });
          return;
        }
      } else {
        // No month specified - show available months for selection
        // Collect all available months from all clans (like autocomplete does)
        const allMonths = new Set<string>();
        for (const clan of clans) {
          const months = await listAvailableMonths(clan.tag);
          months.forEach((month) => allMonths.add(month));
        }
        const availableMonths = Array.from(allMonths).sort().reverse();

        // Check if there's an active CWL happening
        let hasActiveCwl = false;
        const currentMonth = getDateKey(new Date());
        try {
          // Check if any clan has an active CWL
          for (const clan of clans) {
            try {
              const group = await client.getWarLeagueGroupByClanTag(clan.tag);
              // CWL is active if state is not "notInWar" and has rounds
              if (group.state !== 'notInWar' && group.rounds && group.rounds.length > 0) {
                hasActiveCwl = true;
                break;
              }
            } catch {
              // Clan not in CWL, continue checking other clans
              continue;
            }
          }
        } catch {
          // Error checking CWL status, assume no active CWL
        }

        // Build list of options for the select menu
        const options: Array<{ label: string; value: string; description: string }> = [];

        // Add cached months
        for (const month of availableMonths) {
          const [year, monthNum] = month.split('-');
          const date = new Date(parseInt(year), parseInt(monthNum) - 1);
          const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
          // Only mark as "Current/Ongoing" if it's the current month AND there's an active CWL
          const isCurrentAndActive = month === currentMonth && hasActiveCwl;
          options.push({
            label: isCurrentAndActive ? `${monthName} (Current/Ongoing)` : monthName,
            value: month,
            description: isCurrentAndActive ? 'Current month - active CWL in progress' : `CWL data for ${monthName}`
          });
        }

        // Add current month option only if there's an active CWL and it's not already in the list
        if (hasActiveCwl && !availableMonths.includes(currentMonth)) {
          const [year, monthNum] = currentMonth.split('-');
          const date = new Date(parseInt(year), parseInt(monthNum) - 1);
          const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
          options.push({
            label: `${monthName} (Current/Ongoing)`,
            value: currentMonth,
            description: 'Current month - active CWL in progress'
          });
        }

        // Check if we have any options - Discord requires at least 1 option
        if (options.length === 0) {
          await interaction.editReply({
            content:
              'No CWL data available. No cached months found and no active CWL detected. Please specify a month using the `month` option, or wait for CWL data to be cached.'
          });
          return;
        }

        // Show month selection menu
        const monthSelect = new StringSelectMenuBuilder()
          .setCustomId(`cwl:select-month:${interaction.id}`)
          .setPlaceholder('Select a month to calculate CWL bonus medals')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(monthSelect);

        await interaction.editReply({
          content: 'Select a month to calculate CWL bonus medals:',
          components: [row]
        });
        return;
      }

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

      // Display results
      if (results.length === 0) {
        await interaction.editReply({
          content: 'No clans configured or no data available.'
        });
        return;
      }

      // Store results for dropdown interaction (use interaction ID as cache key)
      const cacheKey = `${interaction.id}:${Date.now()}`;
      // Store full member data for the dropdown handler (for inspection)
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

      await displayResults(interaction, results, cacheKey, dateKey);
    } catch (err) {
      logger.error({ err }, 'CWL bonus medals command failed');
      const msg = err instanceof Error ? err.message : 'Failed to calculate bonus medals.';

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: `Error: ${msg}`
          });
        } else {
          await interaction.reply({
            content: `Error: ${msg}`
          });
        }
      } catch (replyErr) {
        logger.error({ err: replyErr }, 'Failed to send error message');
      }
    }
  },
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name !== 'month') {
      await interaction.respond([]);
      return;
    }

    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    try {
      // Get all configured clans
      const clans = await getRecruitClans(interaction.guildId);
      if (clans.length === 0) {
        await interaction.respond([]);
        return;
      }

      // Collect all available months from all clans
      const allMonths = new Set<string>();
      for (const clan of clans) {
        const months = await listAvailableMonths(clan.tag);
        months.forEach((month) => allMonths.add(month));
      }

      // Convert to array and sort (newest first)
      let months = Array.from(allMonths).sort().reverse();

      // Filter based on user input if provided
      const userInput = focusedOption.value.toLowerCase();
      if (userInput) {
        months = months.filter((month) => month.toLowerCase().includes(userInput));
      }

      // Format months for display (e.g., "2025-12" -> "December 2025")
      const formattedMonths = months.slice(0, 25).map((month) => {
        const [year, monthNum] = month.split('-');
        const date = new Date(parseInt(year), parseInt(monthNum) - 1);
        const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        return {
          name: monthName,
          value: month
        };
      });

      await interaction.respond(formattedMonths);
    } catch (err) {
      logger.error({ err }, 'Autocomplete failed for CWL month');
      await interaction.respond([]);
    }
  }
};

export async function calculateClanBonusMedals(
  client: ClashOfClansClient,
  clanTag: string,
  clanName?: string,
  dateKey?: string
): Promise<ClanResults> {
  const wars: Array<{ war: CocCwlWar; index: number; opponentName: string }> = [];
  const currentMonthKey = getDateKey(new Date());

  // If dateKey is provided, try to load from cache first
  if (dateKey) {
    const cachedWars = await loadCachedWarsForMonth(clanTag, dateKey);
    if (cachedWars.size > 0) {
      // Use cached wars - day numbers (1-7) correspond to rounds (0-6)
      // Sort by day to ensure correct order
      // Deduplicate wars by endTime to avoid processing the same war multiple times
      const sortedDays = Array.from(cachedWars.keys()).sort((a: number, b: number) => a - b);
      const seenEndTimes = new Set<string>();

      for (let i = 0; i < sortedDays.length; i++) {
        const day = sortedDays[i];
        const war = cachedWars.get(day)!;
        // Skip duplicate wars (same endTime means same war)
        if (war.endTime && seenEndTimes.has(war.endTime)) {
          continue;
        }
        if (war.endTime) {
          seenEndTimes.add(war.endTime);
        }

        const isClanSide = war.clan?.tag === clanTag;
        const opponentName = isClanSide ? war.opponent?.name || 'Unknown' : war.clan?.name || 'Unknown';
        // Use sequential index (0, 1, 2...) after deduplication
        // This ensures wars are numbered correctly even if duplicates are skipped
        wars.push({ war, index: wars.length, opponentName });
      }

      // If we have all cached wars, we can process them
      // (continue to processing logic below)
    }
  }

  // If no cached data and it's a past month, return error
  if (wars.length === 0 && dateKey && dateKey !== currentMonthKey) {
    return {
      clanTag,
      clanName: clanName || clanTag,
      members: [],
      error: `No CWL data available for ${dateKey}. The clan may not have participated in CWL that month.`
    };
  }

  // If no cached data or not using cache, fetch from API
  if (wars.length === 0) {
    // Get current CWL group
    let group;
    try {
      group = await client.getWarLeagueGroupByClanTag(clanTag);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      // Check if it's a 404 or similar - clan might not be in CWL
      const status = err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : undefined;
      if (status === 404 || errorMsg.includes('404') || errorMsg.includes('not found')) {
        // Clan is not in CWL - return empty results instead of throwing
        return {
          clanTag,
          clanName: clanName || clanTag,
          members: [],
          error: 'Clan is not currently in CWL or has no CWL history'
        };
      }
      // For other errors, still return gracefully
      return {
        clanTag,
        clanName: clanName || clanTag,
        members: [],
        error: `Failed to fetch CWL data: ${errorMsg}`
      };
    }

    // Check if group state indicates CWL is active
    if (group.state === 'notInWar' || !group.rounds || group.rounds.length === 0) {
      // No active CWL - if we have a dateKey for a past month, try cache
      // Otherwise return empty results
      if (dateKey && dateKey !== currentMonthKey) {
        // Try to load from cache for the specified month
        const cachedWars = await loadCachedWarsForMonth(clanTag, dateKey);
        if (cachedWars.size > 0) {
          // Process cached wars (same logic as above)
          const sortedDays = Array.from(cachedWars.keys()).sort((a: number, b: number) => a - b);
          const seenEndTimes = new Set<string>();

          for (let i = 0; i < sortedDays.length; i++) {
            const day = sortedDays[i];
            const war = cachedWars.get(day)!;
            if (war.endTime && seenEndTimes.has(war.endTime)) {
              continue;
            }
            if (war.endTime) {
              seenEndTimes.add(war.endTime);
            }

            const isClanSide = war.clan?.tag === clanTag;
            const opponentName = isClanSide ? war.opponent?.name || 'Unknown' : war.clan?.name || 'Unknown';
            wars.push({ war, index: wars.length, opponentName });
          }
          // Continue to processing logic below
        } else {
          // No cached data for this month
          return {
            clanTag,
            clanName: clanName || clanTag,
            members: [],
            error: `No CWL data available for ${dateKey}. The clan may not have participated in CWL that month.`
          };
        }
      } else {
        // No active CWL and no specific month requested
        return {
          clanTag,
          clanName: clanName || clanTag,
          members: [],
          error: 'Clan is not currently in an active CWL'
        };
      }
    }

    const warTags = (group.rounds ?? []).flatMap((r) => r.warTags ?? []).filter((t) => t && t !== '#0') ?? [];

    if (warTags.length === 0) {
      // No wars found - return empty results instead of throwing
      return {
        clanTag,
        clanName: clanName || clanTag,
        members: [],
        error: 'No CWL wars found. CWL may not have started yet.'
      };
    }

    // Fetch all wars from API
    for (let i = 0; i < warTags.length; i++) {
      try {
        // Try cache first if we have dateKey
        let war: CocCwlWar | null = null;
        if (dateKey) {
          const cached = await loadCachedWar(clanTag, dateKey, i + 1);
          if (cached && isWarFinished(cached)) {
            war = cached;
          }
        }

        // If not in cache or not finished, fetch from API
        if (!war) {
          war = await client.getCwlWarByTag(warTags[i]);
          // Save to cache if war has finished (pass round index for proper day numbering)
          if (isWarFinished(war)) {
            await saveWarToCache(war, clanTag, i);
          }
        }

        // Check if war has member data
        if (!war.clan?.members || war.clan.members.length === 0) {
          // War might not have started yet or data not available
          continue;
        }
        const isClanSide = war.clan?.tag === clanTag;
        const opponentName = isClanSide ? war.opponent?.name || 'Unknown' : war.clan?.name || 'Unknown';
        wars.push({ war, index: i, opponentName });
      } catch (err) {
        logger.warn({ err, warTag: warTags[i], clanTag }, 'Failed to fetch CWL war');
        // Continue with other wars
      }
    }
  }

  if (wars.length === 0) {
    // No wars with data - return empty results instead of throwing
    return {
      clanTag,
      clanName: clanName || clanTag,
      members: [],
      error: 'No CWL wars with member data found. Wars may not have started yet or data is not available.'
    };
  }

  // Initialize member stats
  const memberStatsMap = new Map<string, MemberStats>();

  // Process each war
  for (const { war, index, opponentName } of wars) {
    const isClanSide = war.clan?.tag === clanTag;
    const ourSide = isClanSide ? war.clan : war.opponent;
    const theirSide = isClanSide ? war.opponent : war.clan;

    if (!ourSide?.members || !theirSide?.members) continue;

    // Create a map of opponent members by mapPosition for mirror checking
    const opponentByMapPosition = new Map<number, CocWarMember>();
    theirSide.members.forEach((member) => {
      if (member.mapPosition !== undefined) {
        opponentByMapPosition.set(member.mapPosition, member);
      }
    });

    // Process each member
    for (const member of ourSide.members) {
      if (!member) continue;

      const tag = member.tag;
      if (!memberStatsMap.has(tag)) {
        memberStatsMap.set(tag, {
          tag,
          name: member.name || tag,
          townHallLevel: member.townhallLevel,
          totalPoints: 0,
          totalAttacks: 0,
          normalizedPoints: 0,
          disqualified: false,
          flaggedForReview: false,
          mirrorRuleViolations: [],
          mirrorAttacks: new Set(),
          attackDetails: [],
          defenseDetails: []
        });
      }

      const stats = memberStatsMap.get(tag)!;
      // Update townHallLevel in case it changed between wars
      if (member.townhallLevel) {
        stats.townHallLevel = member.townhallLevel;
      }
      const memberTownHall = member.townhallLevel || 0;
      const memberMapPosition = member.mapPosition;

      // Check if member was in war but didn't attack
      const expectedAttacks = war.attacksPerMember || 1;
      const actualAttacks = member.attacks?.length || 0;

      if (actualAttacks === 0 && expectedAttacks > 0) {
        stats.disqualified = true;
        stats.disqualificationReason = 'Missed attack(s)';
      }

      // Process attacks
      let attackedMirror = false;
      if (member.attacks) {
        for (const attack of member.attacks) {
          stats.totalAttacks++;
          const stars = attack.stars || 0;

          // Find defender's townhall level
          const defender = theirSide.members.find((m) => m.tag === attack.defenderTag);
          const defenderTownHall = defender?.townhallLevel || 0;
          const defenderMapPosition = defender?.mapPosition;
          const wasHigherTh = defenderTownHall > memberTownHall;

          // Check mirror rule (member at mapPosition N should attack opponent at mapPosition N)
          const mirrorOpponent =
            memberMapPosition !== undefined ? opponentByMapPosition.get(memberMapPosition) : undefined;
          const wasMirror = mirrorOpponent ? attack.defenderTag === mirrorOpponent.tag : false;
          if (wasMirror) {
            attackedMirror = true;
            stats.mirrorAttacks.add(index);
          }

          // Check if bonus points should be awarded
          // Bonus points only if: defender is higher TH AND no lower THs above defender's position
          let shouldAwardBonus = false;
          if (wasHigherTh && defenderMapPosition !== undefined) {
            const defenderPos = defenderMapPosition;
            // Check all opponents above (lower map position = higher in war) the defender
            // If any have TH < defender TH, don't award bonus
            shouldAwardBonus = true;
            for (const opponentMember of theirSide.members) {
              const opponentMapPos = opponentMember.mapPosition;
              if (
                opponentMapPos !== undefined &&
                opponentMapPos < defenderPos &&
                (opponentMember.townhallLevel || 0) < defenderTownHall
              ) {
                shouldAwardBonus = false;
                break;
              }
            }
          }

          // Calculate points: +2 per star, +1 bonus per star if higher TH and no rushed bases above
          const attackPoints = stars * 2 + (shouldAwardBonus ? stars : 0);
          stats.totalPoints += attackPoints;

          stats.attackDetails.push({
            warIndex: index,
            opponentName,
            stars,
            defenderTag: attack.defenderTag,
            defenderTownHall: defenderTownHall || undefined,
            defenderMapPosition: defenderMapPosition,
            wasHigherTh,
            bonusAwarded: shouldAwardBonus,
            wasMirror
          });
        }
      }

      // Check mirror rule violation (didn't attack mirror this war)
      if (!attackedMirror && actualAttacks > 0) {
        stats.mirrorRuleViolations.push({ warIndex: index, opponentName });
      }

      // Process defenses (stars lost to opponent attacks)
      // Look for attacks from opponent side against this member
      // Track the maximum stars lost from any single attack (best attack against this base)
      let maxStarsLost = 0;
      let wasAttackedThisWar = false;
      let attackerTownHall = 0; // Track TH level of attacker who caused max stars lost
      let attackerMapPosition: number | undefined; // Track position of attacker who caused max stars lost

      // Only check for attacks if theirSide has members
      if (theirSide.members && theirSide.members.length > 0) {
        for (const opponentMember of theirSide.members) {
          if (opponentMember?.attacks && opponentMember.attacks.length > 0) {
            for (const attack of opponentMember.attacks) {
              if (attack?.defenderTag === tag) {
                wasAttackedThisWar = true;
                const stars = attack.stars || 0;
                // Track the worst attack (most stars lost) and the attacker's TH level and position
                if (stars > maxStarsLost) {
                  maxStarsLost = stars;
                  attackerTownHall = opponentMember.townhallLevel || 0;
                  attackerMapPosition = opponentMember.mapPosition;
                } else if (stars === maxStarsLost) {
                  // If multiple attacks have the same max stars, use the highest attacker TH
                  const currentTh = opponentMember.townhallLevel || 0;
                  if (currentTh > attackerTownHall) {
                    attackerTownHall = currentTh;
                    attackerMapPosition = opponentMember.mapPosition;
                  }
                }
              }
            }
          }
        }
      }

      // Calculate stars defended: 3 - max stars lost from any attack
      // If not attacked at all in this war, award 2 points (not 6 like before)
      if (!wasAttackedThisWar) {
        // Award 2 points per war when not attacked
        stats.totalPoints += 2;
        stats.defenseDetails.push({
          warIndex: index,
          opponentName,
          starsDefended: 3 // Defended all 3 stars since not attacked
        });
      } else {
        const starsDefended = Math.max(0, 3 - maxStarsLost);
        // Only award defense points if attacker had at least the same TH level as defender
        if (starsDefended > 0 && attackerTownHall >= memberTownHall) {
          // +2 points per defense star
          stats.totalPoints += starsDefended * 2;
        }
        // Always record defense details with actual stars defended, even if no points awarded
        // This allows users to see who attacked them and how many stars were defended
        stats.defenseDetails.push({
          warIndex: index,
          opponentName,
          starsDefended,
          attackerTownHall: attackerTownHall > 0 ? attackerTownHall : undefined,
          attackerMapPosition
        });
      }
    }
  }

  // Normalize points and check disqualifications
  const members = Array.from(memberStatsMap.values());

  for (const member of members) {
    if (member.totalAttacks > 0) {
      member.normalizedPoints = member.totalPoints / member.totalAttacks;
    } else {
      member.normalizedPoints = 0;
    }

    // Flag for review if mirror rule violated (didn't attack mirror at least once across all wars)
    // Don't disqualify - just flag for manual review
    if (member.mirrorRuleViolations.length > 0 && !member.disqualified) {
      // Check if they attacked mirror in ANY war
      const attackedMirrorInAnyWar = member.mirrorAttacks.size > 0;

      if (!attackedMirrorInAnyWar && member.totalAttacks > 0) {
        // Flag for review instead of disqualifying
        member.flaggedForReview = true;
      }
    }
  }

  // Sort by normalized points (descending)
  members.sort((a, b) => {
    if (a.disqualified && !b.disqualified) return 1;
    if (!a.disqualified && b.disqualified) return -1;
    return b.normalizedPoints - a.normalizedPoints;
  });

  return {
    clanTag,
    clanName: clanName || clanTag,
    members
  };
}

export async function displayResults(
  interaction:
    | ChatInputCommandInteraction
    | {
        id: string;
        editReply: ChatInputCommandInteraction['editReply'];
        followUp: ChatInputCommandInteraction['followUp'];
      },
  results: ClanResults[],
  cacheKey: string,
  dateKey: string
): Promise<void> {
  if (results.length === 0) {
    await interaction.editReply({
      content: 'No results to display.'
    });
    return;
  }

  const embeds: EmbedBuilder[] = [];

  for (const clanResult of results) {
    try {
      const embed = new EmbedBuilder()
        .setTitle(`${clanResult.clanName} - CWL Bonus Medals`)
        .setDescription(`Clan Tag: ${clanResult.clanTag}`)
        .setColor(0x00ae86);

      if (clanResult.members.length === 0) {
        const errorMsg = clanResult.error || 'No member data available';
        const warningText =
          errorMsg +
          "\n\nThis is normal for:\n• New clans that haven't participated in CWL yet\n• Clans not currently in an active CWL\n• CWL wars that haven't started yet";

        // Discord field value limit is 1024 characters
        const truncatedWarning = warningText.length > 1024 ? warningText.slice(0, 1020) + '...' : warningText;

        embed
          .setColor(0xff9900) // Orange color for warnings
          .addFields({
            name: '⚠️ No Data Available',
            value: truncatedWarning
          });
        embeds.push(embed);
        continue;
      }

      // Split into qualified (including flagged) and disqualified
      // Flagged members are included in the sorted list with a marker
      const qualified = clanResult.members.filter((m) => !m.disqualified);
      const disqualified = clanResult.members.filter((m) => m.disqualified);

      // Build sorted list (all qualified members, including flagged ones)
      // Split into multiple fields to fit all members
      if (qualified.length > 0) {
        const flaggedCount = qualified.filter((m) => m.flaggedForReview).length;
        const baseName =
          flaggedCount > 0
            ? `✅ Qualified (${qualified.length}, ${flaggedCount} flagged ⚠️)`
            : `✅ Qualified (${qualified.length})`;

        // Split members into chunks that fit in Discord fields (~15-20 members per field)
        const membersPerField = 18; // Conservative estimate to stay under 1024 chars
        const chunks: MemberStats[][] = [];
        for (let i = 0; i < qualified.length; i += membersPerField) {
          chunks.push(qualified.slice(i, i + membersPerField));
        }

        chunks.forEach((chunk, chunkIdx) => {
          let memberList = chunk
            .map((member, idx) => {
              const globalIdx = chunkIdx * membersPerField + idx;
              const th = member.townHallLevel ? `TH${member.townHallLevel}` : 'TH?';
              const flaggedMarker = member.flaggedForReview ? ' ⚠️' : '';
              return `${globalIdx + 1}. **${member.name}** (${th}) - ${member.normalizedPoints.toFixed(2)} pts (${member.totalAttacks} attacks)${flaggedMarker}`;
            })
            .join('\n');

          // Discord field value limit is 1024 characters
          if (memberList.length > 1024) {
            // Truncate and add ellipsis
            memberList = memberList.slice(0, 1020) + '...';
          }

          // Use a single space for continuation fields (Discord requires a non-empty field name)
          const fieldName = chunkIdx === 0 ? baseName : ' ';
          embed.addFields({
            name: fieldName,
            value: memberList || 'None',
            inline: false
          });
        });
      }

      // Build disqualified list
      if (disqualified.length > 0) {
        let disqualifiedList = disqualified
          .map((member) => {
            const th = member.townHallLevel ? `TH${member.townHallLevel}` : 'TH?';
            const reason = member.disqualificationReason || 'Unknown';
            const violations =
              member.mirrorRuleViolations.length > 0
                ? `\n   Mirror violations: ${member.mirrorRuleViolations.map((v) => `War ${v.warIndex + 1} vs ${v.opponentName}`).join(', ')}`
                : '';
            return `**${member.name}** (${th}) - ${reason}${violations}`;
          })
          .join('\n');

        // Discord field value limit is 1024 characters
        if (disqualifiedList.length > 1024) {
          // Truncate and add ellipsis
          disqualifiedList = disqualifiedList.slice(0, 1020) + '...';
        }

        embed.addFields({
          name: `❌ Disqualified (${disqualified.length})`,
          value: disqualifiedList || 'None',
          inline: false
        });
      }

      embeds.push(embed);
    } catch (err) {
      logger.error({ err, clanTag: clanResult.clanTag }, 'Failed to build embed for clan result');
      // Add a simple error embed instead
      const errorEmbed = new EmbedBuilder()
        .setTitle(`${clanResult.clanName} - CWL Bonus Medals`)
        .setDescription(`Clan Tag: ${clanResult.clanTag}`)
        .setColor(0xff0000)
        .addFields({
          name: 'Error',
          value: 'Failed to process clan data. Please try again.'
        });
      embeds.push(errorEmbed);
    }
  }

  // Build components: inspection dropdown for current page + navigation buttons
  // We'll build the dropdown dynamically based on the current page in the navigation handler
  const components: Array<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>> = [];

  // Add inspection dropdown(s) for the first clan (current page)
  // Discord limit is 25 options per dropdown, so we need multiple dropdowns if >25 members
  if (results.length > 0 && embeds.length > 0) {
    const firstClanResult = results[0];
    if (firstClanResult.members.length > 0 && !firstClanResult.error) {
      const totalMembers = firstClanResult.members.length;
      const maxOptionsPerDropdown = 25;
      const numDropdowns = Math.ceil(totalMembers / maxOptionsPerDropdown);

      for (let i = 0; i < numDropdowns; i++) {
        const startIdx = i * maxOptionsPerDropdown;
        const endIdx = Math.min(startIdx + maxOptionsPerDropdown, totalMembers);
        const members = firstClanResult.members.slice(startIdx, endIdx);

        const placeholder =
          numDropdowns > 1
            ? `Inspect ${firstClanResult.clanName} member (${startIdx + 1}-${endIdx} of ${totalMembers})`
            : `Inspect ${firstClanResult.clanName} member (${totalMembers} total)`;

        const select = new StringSelectMenuBuilder()
          .setCustomId(`cwl:inspect:${firstClanResult.clanTag}:${i}`)
          .setPlaceholder(placeholder)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            members.map((member) => {
              const th = member.townHallLevel ? `TH${member.townHallLevel}` : 'TH?';
              const flaggedMarker = member.flaggedForReview ? ' ⚠️' : '';
              const disqualifiedMarker = member.disqualified ? ' ❌' : '';
              const label = `${member.name}${flaggedMarker}${disqualifiedMarker}`.slice(0, 100);
              return {
                label,
                value: `${firstClanResult.clanTag}:${member.tag}`,
                description: `${th} - ${member.normalizedPoints.toFixed(2)} pts`
              };
            })
          );
        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
      }
    }
  }

  if (embeds.length === 0) {
    await interaction.editReply({
      content: 'No data to display.'
    });
    return;
  }

  // Create pagination with navigation arrows
  // Store current page index in custom ID
  const baseCustomId = `cwl:nav:${interaction.id}`;
  const currentPage = 0;

  // Store pagination state for navigation handler (include results for dropdown updates)
  storePaginationState(interaction.id, embeds, results, dateKey);

  // Build navigation buttons
  const prevButton = new ButtonBuilder()
    .setCustomId(`${baseCustomId}:prev`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('◀ Previous')
    .setDisabled(currentPage === 0 || embeds.length <= 1);

  const nextButton = new ButtonBuilder()
    .setCustomId(`${baseCustomId}:next`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next ▶')
    .setDisabled(currentPage >= embeds.length - 1 || embeds.length <= 1);

  const pageInfo = embeds.length > 1 ? `Page ${currentPage + 1}/${embeds.length}` : '';
  const pageButton = new ButtonBuilder()
    .setCustomId(`${baseCustomId}:page`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(pageInfo || 'Page 1/1')
    .setDisabled(true);

  const exportButton = new ButtonBuilder()
    .setCustomId(`${baseCustomId}:export`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Export')
    .setEmoji('📥');

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, pageButton, nextButton, exportButton);

  // Send initial message with first embed
  await interaction.editReply({
    embeds: [embeds[currentPage]],
    components: components.length > 0 ? [...components, navRow] : [navRow]
  });
}

export default command;
