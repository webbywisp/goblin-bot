import { FAMILY_LEADER_ROLE_ID } from '@/config/roles';
import { ClashOfClansClient, normalizePlayerTag } from '@/integrations/clashOfClans/client';
import type { RecruitClanConfig, RecruitDmTemplateConfig } from '@/recruit/configStore';
import {
  getRecruitClans,
  getRecruitDmTemplates,
  setRecruitAllowedRoleIds,
  setRecruitClans,
  setRecruitDmTemplates,
  setRecruitThreadChannelId
} from '@/recruit/configStore';
import { DM_TEMPLATE_PLACEHOLDERS } from '@/recruit/dmCoordinator';
import { canManageSettings } from '@/settings/permissions';
import {
  buildClansView,
  buildRecruitChannelView,
  buildRecruitDmTemplatesView,
  buildRecruitRolesView,
  buildSettingsMenuView
} from '@/settings/views';
import { logger } from '@/utils/logger';
import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction
} from 'discord.js';
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction
} from 'discord.js';
import { randomBytes } from 'node:crypto';

type SettingsComponentInteraction =
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction;

const TEMPLATE_NAME_INPUT_ID = 'settings_dm_template_name';
const TEMPLATE_CONTENT_INPUT_ID = 'settings_dm_template_content';
const TEMPLATE_PLACEHOLDER_HINT_ID = 'settings_dm_template_hint';
const CLAN_TAG_INPUT_ID = 'settings_clan_tag';

function generateTemplateId(): string {
  return randomBytes(5).toString('hex');
}

function buildClanModal(mode: 'create' | 'edit', clan?: RecruitClanConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(
      mode === 'create'
        ? 'settings:clan_modal:create'
        : `settings:clan_modal:edit:${encodeURIComponent(clan?.tag ?? '')}`
    )
    .setTitle(mode === 'create' ? 'Add clan' : `Edit "${clan?.name ?? clan?.tag ?? 'clan'}"`);

  const tagInput = new TextInputBuilder()
    .setCustomId(CLAN_TAG_INPUT_ID)
    .setLabel('Clan tag (name will be fetched automatically)')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(20)
    .setRequired(true)
    .setPlaceholder('#ABC123');

  if (clan) {
    tagInput.setValue(clan.tag.slice(0, 20));
  }

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(tagInput));

  return modal;
}

function buildTemplateModal(mode: 'create' | 'edit', template?: RecruitDmTemplateConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(
      mode === 'create' ? 'settings:dm_template_modal:create' : `settings:dm_template_modal:edit:${template?.id}`
    )
    .setTitle(mode === 'create' ? 'Add DM template' : `Edit "${template?.name ?? 'template'}"`);

  const nameInput = new TextInputBuilder()
    .setCustomId(TEMPLATE_NAME_INPUT_ID)
    .setLabel('Template name')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(100)
    .setRequired(true);

  const contentInput = new TextInputBuilder()
    .setCustomId(TEMPLATE_CONTENT_INPUT_ID)
    .setLabel('Message content')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1800);

  if (template) {
    nameInput.setValue(template.name.slice(0, 100));
    contentInput.setValue(template.content.slice(0, 1800));
  }

  const placeholderText = DM_TEMPLATE_PLACEHOLDERS.map((key) => `{${key}}`).join(', ');

  const placeholderInfo = new TextInputBuilder()
    .setCustomId(TEMPLATE_PLACEHOLDER_HINT_ID)
    .setLabel('Available placeholders (read-only)')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(placeholderText)
    .setRequired(false)
    .setMinLength(0)
    .setMaxLength(Math.min(placeholderText.length, 1000));

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(placeholderInfo),
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput)
  );

  return modal;
}

export async function handleSettingsComponentInteraction(interaction: SettingsComponentInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('settings:')) return false;

  if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Settings can only be used inside a server.', ephemeral: true });
    }
    return true;
  }

  if (!(await canManageSettings(interaction.user.id, interaction.member, interaction.guildId))) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Only owners or leader roles can change settings.',
        ephemeral: true
      });
    }
    return true;
  }

  const guild = interaction.guild;
  const guildId = interaction.guildId;
  const leaderRole =
    guild.roles.cache.get(FAMILY_LEADER_ROLE_ID) ?? (await guild.roles.fetch(FAMILY_LEADER_ROLE_ID).catch(() => null));
  const leaderRoleId = leaderRole?.id;

  const action = interaction.customId.split(':')[1];
  if (action === 'menu_select' && interaction.isStringSelectMenu()) {
    const selected = interaction.values?.[0];
    const view =
      selected === 'recruit_roles'
        ? await buildRecruitRolesView(guildId, leaderRoleId)
        : selected === 'recruit_channel'
          ? await buildRecruitChannelView(guildId)
          : selected === 'dm_templates'
            ? await buildRecruitDmTemplatesView(guildId)
            : selected === 'clans'
              ? await buildClansView(guildId)
              : await buildSettingsMenuView(guildId, leaderRoleId);
    await interaction.update(view);
    return true;
  }

  if (action === 'back' && interaction.isButton()) {
    const view = await buildSettingsMenuView(guildId, leaderRoleId);
    await interaction.update(view);
    return true;
  }

  if (action === 'dm_templates_add' && interaction.isButton()) {
    const modal = buildTemplateModal('create');
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'dm_templates_edit' && interaction.isStringSelectMenu()) {
    const templateId = interaction.values?.[0];
    if (!templateId) {
      await interaction.reply({ content: 'Select a template first.', ephemeral: true });
      return true;
    }
    const templates = await getRecruitDmTemplates(guildId);
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      await interaction.reply({ content: 'That template is no longer available.', ephemeral: true });
      return true;
    }

    await interaction.showModal(buildTemplateModal('edit', template));
    return true;
  }

  if (action === 'dm_templates_delete' && interaction.isStringSelectMenu()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    try {
      const templateId = interaction.values?.[0];
      if (!templateId) {
        await interaction.followUp({ content: 'Select a template first.', ephemeral: true });
        return true;
      }

      const templates = await getRecruitDmTemplates(guildId);
      const next = templates.filter((entry) => entry.id !== templateId);
      if (next.length === templates.length) {
        await interaction.followUp({ content: 'That template was already removed.', ephemeral: true });
        return true;
      }

      await setRecruitDmTemplates(guildId, next);
      const view = await buildRecruitDmTemplatesView(guildId);
      await interaction.editReply(view);
      await interaction.followUp({ content: 'Recruit DM template deleted.', ephemeral: true });
    } catch (err) {
      await reportSettingsError(interaction, 'Failed to delete DM template.', err);
    }
    return true;
  }

  if (action === 'recruit_roles' && interaction.isRoleSelectMenu()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    try {
      const selected = Array.from(new Set((interaction.values ?? []).slice(0, 25)));
      await setRecruitAllowedRoleIds(guildId, selected);

      const view = await buildRecruitRolesView(guildId, leaderRoleId);
      await interaction.editReply(view);
    } catch (err) {
      await reportSettingsError(interaction, 'Failed to update recruit roles.', err);
    }
    return true;
  }

  if (action === 'recruit_channel' && interaction.isChannelSelectMenu()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    try {
      const selected = (interaction.values ?? [])[0] ?? null;

      await setRecruitThreadChannelId(guildId, selected);

      const view = await buildRecruitChannelView(guildId);
      await interaction.editReply(view);
    } catch (err) {
      await reportSettingsError(interaction, 'Failed to update recruit channel.', err);
    }
    return true;
  }

  if (action === 'clans_add' && interaction.isButton()) {
    const modal = buildClanModal('create');
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'clans_edit' && interaction.isStringSelectMenu()) {
    const clanTag = interaction.values?.[0];
    if (!clanTag) {
      await interaction.reply({ content: 'Select a clan first.', ephemeral: true });
      return true;
    }
    const clans = await getRecruitClans(guildId);
    const clan = clans.find((c) => c.tag === clanTag);
    if (!clan) {
      await interaction.reply({ content: 'That clan is no longer available.', ephemeral: true });
      return true;
    }

    await interaction.showModal(buildClanModal('edit', clan));
    return true;
  }

  if (action === 'clans_delete' && interaction.isStringSelectMenu()) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    try {
      const clanTag = interaction.values?.[0];
      if (!clanTag) {
        await interaction.followUp({ content: 'Select a clan first.', ephemeral: true });
        return true;
      }

      const clans = await getRecruitClans(guildId);
      const next = clans.filter((c) => c.tag !== clanTag);
      if (next.length === clans.length) {
        await interaction.followUp({ content: 'That clan was already removed.', ephemeral: true });
        return true;
      }

      await setRecruitClans(guildId, next);
      const view = await buildClansView(guildId);
      await interaction.editReply(view);
      await interaction.followUp({ content: 'Clan deleted.', ephemeral: true });
    } catch (err) {
      await reportSettingsError(interaction, 'Failed to delete clan.', err);
    }
    return true;
  }

  return false;
}

export async function handleSettingsModalInteraction(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('settings:')) return false;

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: 'Settings can only be used inside a server.', ephemeral: true });
    return true;
  }

  if (!(await canManageSettings(interaction.user.id, interaction.member, interaction.guildId))) {
    await interaction.reply({
      content: 'Only owners or leader roles can change settings.',
      ephemeral: true
    });
    return true;
  }

  const [, action, mode, id] = interaction.customId.split(':');
  const guildId = interaction.guildId;

  if (action === 'dm_template_modal') {
    return await handleDmTemplateModal(interaction, mode, id, guildId);
  }
  if (action === 'clan_modal') {
    return await handleClanModal(interaction, mode, id, guildId);
  }
  return false;
}

async function handleDmTemplateModal(
  interaction: ModalSubmitInteraction,
  mode: string,
  templateId: string | undefined,
  guildId: string
): Promise<boolean> {
  const name = interaction.fields.getTextInputValue(TEMPLATE_NAME_INPUT_ID)?.trim();
  const content = interaction.fields.getTextInputValue(TEMPLATE_CONTENT_INPUT_ID)?.trim();

  if (!name || !content) {
    await interaction.reply({ content: 'Both a name and message are required.', ephemeral: true });
    return true;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const current = await getRecruitDmTemplates(guildId);
    const templates = [...current];

    if (mode === 'create') {
      let id = generateTemplateId();
      const taken = new Set(templates.map((entry) => entry.id));
      while (taken.has(id)) {
        id = generateTemplateId();
      }
      templates.push({ id, name, content });
    } else if (mode === 'edit' && templateId) {
      const index = templates.findIndex((entry) => entry.id === templateId);
      if (index === -1) {
        await interaction.reply({ content: 'That template no longer exists.', ephemeral: true });
        return true;
      }
      templates[index] = { id: templateId, name, content };
    } else {
      await interaction.reply({ content: 'Unknown template action.', ephemeral: true });
      return true;
    }

    await setRecruitDmTemplates(guildId, templates);
    const view = await buildRecruitDmTemplatesView(guildId);
    await interaction.editReply({
      content: `✅ Recruit DM template saved.\n\n${view.content}`,
      components: view.components
    });
  } catch (err) {
    await reportSettingsError(interaction, 'Failed to save DM template.', err);
  }

  return true;
}

async function handleClanModal(
  interaction: ModalSubmitInteraction,
  mode: string,
  oldTag: string | undefined,
  guildId: string
): Promise<boolean> {
  const tag = interaction.fields.getTextInputValue(CLAN_TAG_INPUT_ID)?.trim();

  if (!tag) {
    await interaction.reply({ content: 'Clan tag is required.', ephemeral: true });
    return true;
  }

  // Normalize tag
  const normalizedTag = normalizePlayerTag(tag);
  if (!normalizedTag || normalizedTag === '#') {
    await interaction.reply({ content: 'Invalid clan tag format.', ephemeral: true });
    return true;
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    // Fetch clan info from API to get the name
    const client = new ClashOfClansClient();
    let clanName: string | undefined;
    try {
      const clan = await client.getClanByTag(normalizedTag);
      clanName = clan.name;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      await interaction.editReply({
        content: `Failed to fetch clan info from Clash of Clans API: ${errorMsg}\n\nPlease verify the clan tag is correct.`
      });
      return true;
    }

    const current = await getRecruitClans(guildId);
    const clans = [...current];

    if (mode === 'create') {
      // Check if tag already exists
      if (clans.some((c) => c.tag === normalizedTag)) {
        await interaction.editReply({ content: 'A clan with that tag already exists.' });
        return true;
      }
      clans.push({ tag: normalizedTag, name: clanName });
    } else if (mode === 'edit' && oldTag) {
      const decodedOldTag = decodeURIComponent(oldTag);
      const index = clans.findIndex((c) => c.tag === decodedOldTag);
      if (index === -1) {
        await interaction.editReply({ content: 'That clan no longer exists.' });
        return true;
      }
      // If tag changed, check for duplicates
      if (normalizedTag !== decodedOldTag && clans.some((c) => c.tag === normalizedTag)) {
        await interaction.editReply({ content: 'A clan with that tag already exists.' });
        return true;
      }
      clans[index] = { tag: normalizedTag, name: clanName };
    } else {
      await interaction.editReply({ content: 'Unknown clan action.' });
      return true;
    }

    await setRecruitClans(guildId, clans);
    const view = await buildClansView(guildId);
    await interaction.editReply({
      content: `✅ Clan saved: **${clanName}** (${normalizedTag})\n\n${view.content}`,
      components: view.components
    });
  } catch (err) {
    await reportSettingsError(interaction, 'Failed to save clan.', err);
  }

  return true;
}

async function reportSettingsError(
  interaction:
    | RoleSelectMenuInteraction
    | ChannelSelectMenuInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  message: string,
  err: unknown
) {
  logger.error({ err, customId: interaction.customId, guildId: interaction.guildId }, 'Settings interaction failed');

  const payload = {
    content: `${message} Please try again.`,
    ephemeral: true
  } as const;

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}
