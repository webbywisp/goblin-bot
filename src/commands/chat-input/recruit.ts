import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration
} from 'discord.js';
import type { ChatInputCommand } from '@/commands/types';
import { ClashOfClansClient, type CocWarAttack, type CocWarMember } from '@/integrations/clashOfClans/client';

function formatCocTime(input?: string): string | undefined {
  if (!input) return undefined;
  const iso = input.includes('.') ? input : input.replace(/(\.\d{3}Z)?$/, '.000Z');
  // CoC uses e.g. 20250101T000000.000Z
  const normalized = iso.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/,
    '$1-$2-$3T$4:$5:$6.$7Z'
  );
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

const command: ChatInputCommand = {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Look up a Clash of Clans player by tag')
    .addStringOption((opt) =>
      opt
        .setName('player_tag')
        .setDescription('Player tag, e.g. #ABC123')
        .setRequired(true)
    ),
  async execute(interaction) {
    await interaction.deferReply();

    const playerTag = interaction.options.getString('player_tag', true);
    const client = new ClashOfClansClient();

    try {
      const player = await client.getPlayerByTag(playerTag);

      if (!interaction.inGuild()) {
        await interaction.editReply('This command can only create threads inside a server channel.');
        return;
      }

      const threadTitle = `${player.name} (${player.tag})`;

      // Reply in-channel, then start a thread from that reply message.
      await interaction.editReply({ content: `Creating thread for \`${threadTitle}\`...` });
      const replyMessage = await interaction.fetchReply();

      if (!replyMessage.isThread()) {
        const thread = await replyMessage.startThread({
          name: threadTitle.slice(0, 100),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay
        });

        const heroes = (player.heroes ?? []).filter((h) => (h?.name ?? '').trim().length > 0);
        const heroesValue =
          heroes.length > 0
            ? heroes
                .map((h) => {
                  const max = typeof h.maxLevel === 'number' ? `/${h.maxLevel}` : '';
                  return `${h.name}: ${h.level}${max}`;
                })
                .join('\n')
            : 'Unknown';

        const leagueName = player.league?.name ?? 'Unranked';
        const trophies = typeof player.trophies === 'number' ? `${player.trophies} trophies` : 'Unknown trophies';
        const leagueRankValue = `${leagueName} (${trophies})`;

        // ---- Build paginated embeds ----
        const overviewEmbed = new EmbedBuilder()
          .setTitle(threadTitle)
          .setDescription(player.clan ? `Clan: ${player.clan.name} (${player.clan.tag})` : 'Clan: None')
          .addFields(
            { name: 'Town Hall', value: String(player.townHallLevel ?? 'Unknown'), inline: true },
            { name: 'Current league rank', value: leagueRankValue, inline: true },
            { name: 'EXP level', value: String(player.expLevel ?? 'Unknown'), inline: true },
            { name: 'Hero levels', value: heroesValue, inline: false }
          )
          .setFooter({ text: 'Page 1/2 • Overview' });

        // War page: uses current war + CWL war tags (if available). Regular past-war attacks are not exposed by the official API.
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

            let cwlRows: WarAttackRow[] = [];
            for (const warTag of warTags) {
              try {
                const war = await client.getCwlWarByTag(warTag);
                // Determine which side is "our" clan by matching tag
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

              // Append some CWL recent lines if we don't already have 5
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
          .setTitle(`${threadTitle} — War performance`)
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

        const customBase = `recruit:${interaction.id}`;
        const prevBtn = new ButtonBuilder()
          .setCustomId(`${customBase}:prev`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Prev')
          .setDisabled(true);
        const nextBtn = new ButtonBuilder()
          .setCustomId(`${customBase}:next`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Next')
          .setDisabled(pages.length <= 1);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);
        const pagedMessage = await thread.send({ embeds: [pages[pageIndex]], components: [row] });

        const collector = pagedMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 15 * 60 * 1000
        });

        collector.on('collect', async (i) => {
          if (i.customId === `${customBase}:prev`) pageIndex = Math.max(0, pageIndex - 1);
          if (i.customId === `${customBase}:next`) pageIndex = Math.min(pages.length - 1, pageIndex + 1);

          prevBtn.setDisabled(pageIndex === 0);
          nextBtn.setDisabled(pageIndex === pages.length - 1);
          const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);

          await i.update({ embeds: [pages[pageIndex]], components: [updatedRow] });
        });

        collector.on('end', async () => {
          try {
            prevBtn.setDisabled(true);
            nextBtn.setDisabled(true);
            const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn);
            await pagedMessage.edit({ components: [disabledRow] });
          } catch {
            // ignore
          }
        });

        await interaction.editReply({ content: `Thread created: <#${thread.id}>` });
      } else {
        await interaction.editReply('Could not create a thread in this channel.');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to look up that player. Please try again.';
      await interaction.editReply({
        content:
          `Could not look up that player tag.\n` +
          `- Tag: \`${playerTag}\`\n` +
          `- Error: ${msg}\n\n` +
          `Make sure \`CLASH_OF_CLANS_API_TOKEN\` is set in your environment and the tag is correct.`
      });
    }
  }
};

export default command;

