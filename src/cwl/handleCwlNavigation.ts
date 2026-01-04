import type { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

type ClanResult = {
  clanTag: string;
  clanName: string;
  members: Array<{
    tag: string;
    name: string;
    townHallLevel?: number;
    normalizedPoints: number;
    flaggedForReview: boolean;
    disqualified: boolean;
  }>;
};

// Store pagination state temporarily
const paginationState = new Map<
  string,
  { embeds: EmbedBuilder[]; currentPage: number; results: ClanResult[]; dateKey: string }
>();

export function storePaginationState(
  key: string,
  embeds: EmbedBuilder[],
  results: ClanResult[],
  dateKey: string
): void {
  paginationState.set(key, { embeds, currentPage: 0, results, dateKey });
  // Clean up old entries
  if (paginationState.size > 10) {
    const oldestKey = paginationState.keys().next().value;
    if (oldestKey) {
      paginationState.delete(oldestKey);
    }
  }
}

export function getPaginationState(
  key: string
): { embeds: EmbedBuilder[]; currentPage: number; results: ClanResult[]; dateKey: string } | undefined {
  return paginationState.get(key);
}

export async function handleCwlNavigation(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('cwl:nav:')) return false;

  const parts = interaction.customId.split(':');
  const interactionId = parts[2];
  const action = parts[3]; // 'prev', 'next', 'page', or 'export'

  if (action === 'page') {
    // Page info button is disabled, ignore
    return false;
  }

  if (action === 'export') {
    // Handle export button - show day selection dropdown
    const state = paginationState.get(interactionId);
    if (!state || state.results.length === 0) {
      await interaction.reply({
        content: 'Export data expired. Please run the command again.',
        ephemeral: true
      });
      return true;
    }

    // Get the current clan being viewed
    const currentClan = state.results[state.currentPage];
    if (!currentClan) {
      await interaction.reply({
        content: 'No clan data available for export.',
        ephemeral: true
      });
      return true;
    }

    // Show dropdown to select which day (1-7) to export
    const daySelect = new StringSelectMenuBuilder()
      .setCustomId(`cwl:export-day:${interactionId}:${currentClan.clanTag}`)
      .setPlaceholder('Select a day to export (1-7)')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        Array.from({ length: 7 }, (_, i) => {
          const day = i + 1;
          return {
            label: `Day ${day}`,
            value: day.toString(),
            description: `Export CWL war data for day ${day}`
          };
        })
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(daySelect);

    await interaction.reply({
      content: `Select which day to export for **${currentClan.clanName}** (${state.dateKey}):`,
      components: [row],
      ephemeral: true
    });
    return true;
  }

  const state = paginationState.get(interactionId);
  if (!state || state.embeds.length === 0) {
    await interaction.reply({
      content: 'Navigation expired. Please run the command again.',
      ephemeral: true
    });
    return true;
  }

  if (action === 'prev') {
    state.currentPage = Math.max(0, state.currentPage - 1);
  } else if (action === 'next') {
    state.currentPage = Math.min(state.embeds.length - 1, state.currentPage + 1);
  }

  // Update button states
  const prevButton = new ButtonBuilder()
    .setCustomId(`cwl:nav:${interactionId}:prev`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('◀ Previous')
    .setDisabled(state.currentPage === 0 || state.embeds.length <= 1);

  const nextButton = new ButtonBuilder()
    .setCustomId(`cwl:nav:${interactionId}:next`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Next ▶')
    .setDisabled(state.currentPage >= state.embeds.length - 1 || state.embeds.length <= 1);

  const pageInfo = state.embeds.length > 1 ? `Page ${state.currentPage + 1}/${state.embeds.length}` : 'Page 1/1';
  const pageButton = new ButtonBuilder()
    .setCustomId(`cwl:nav:${interactionId}:page`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(pageInfo)
    .setDisabled(true);

  const exportButton = new ButtonBuilder()
    .setCustomId(`cwl:nav:${interactionId}:export`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('⬇️ Export')
    .setEmoji('⬇️');

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, pageButton, nextButton, exportButton);

  // Build dropdown(s) for current page's clan with a hard cap to stay within Discord limits
  const dropdownRows: Array<ActionRowBuilder<StringSelectMenuBuilder>> = [];
  const maxDropdownRows = 3;
  if (state.results && state.results.length > state.currentPage) {
    const currentClan = state.results[state.currentPage];
    if (currentClan.members.length > 0) {
      const totalMembers = currentClan.members.length;
      const maxOptionsPerDropdown = 25;
      const numDropdowns = Math.ceil(totalMembers / maxOptionsPerDropdown);

      for (let i = 0; i < numDropdowns; i++) {
        if (dropdownRows.length >= maxDropdownRows) {
          break;
        }

        const startIdx = i * maxOptionsPerDropdown;
        const endIdx = Math.min(startIdx + maxOptionsPerDropdown, totalMembers);
        const members = currentClan.members.slice(startIdx, endIdx);

        const placeholder =
          numDropdowns > 1
            ? `Inspect ${currentClan.clanName} member (${startIdx + 1}-${endIdx} of ${totalMembers})`
            : `Inspect ${currentClan.clanName} member (${totalMembers} total)`;

        const select = new StringSelectMenuBuilder()
          .setCustomId(`cwl:inspect:${currentClan.clanTag}:${i}`)
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
                value: `${currentClan.clanTag}:${member.tag}`,
                description: `${th} - ${member.normalizedPoints.toFixed(2)} pts`
              };
            })
          );
        dropdownRows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
      }
    }
  }

  const componentRows = dropdownRows.length > 0 ? [...dropdownRows, navRow] : [navRow];
  await interaction.update({
    embeds: [state.embeds[state.currentPage]],
    components: componentRows
  });

  return true;
}
