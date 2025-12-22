import {
  getRecruitRoleIdsForTownHall,
  getRecruitRoleMappingSummary,
  setRecruitRoleIdsForTownHall
} from '@/recruit/configStore';
import { clearOpenApplicantThreadByThreadId } from '@/recruit/openApplicantStore';
import {
  ActionRowBuilder,
  PermissionFlagsBits,
  roleMention,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction
} from 'discord.js';

type RecruitComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | RoleSelectMenuInteraction
  | AnySelectMenuInteraction;

function hasRecruitManagePerms(interaction: RecruitComponentInteraction): boolean {
  const perms = interaction.memberPermissions;
  return Boolean(
    perms?.has(PermissionFlagsBits.Administrator) ||
    perms?.has(PermissionFlagsBits.ManageThreads) ||
    perms?.has(PermissionFlagsBits.ManageMessages)
  );
}

function parseCustomId(
  customId: string
):
  | { kind: 'accept'; th: number; tagNoHash: string }
  | { kind: 'close'; tagNoHash: string; replyMessageId?: string }
  | { kind: 'settings'; th: number; tagNoHash: string }
  | { kind: 'settingsTh'; th: number; tagNoHash: string }
  | { kind: 'settingsRoles'; th: number; tagNoHash: string }
  | { kind: 'pick'; th: number; tagNoHash: string }
  | { kind: 'unknown' } {
  const parts = customId.split(':');
  if (parts[0] !== 'recruit') return { kind: 'unknown' };

  const action = parts[1];
  if (action === 'accept') {
    const th = Number(parts[2]);
    const tagNoHash = parts[3] ?? '';
    return { kind: 'accept', th, tagNoHash };
  }
  if (action === 'close') {
    const tagNoHash = parts[2] ?? '';
    const replyMessageId = parts[3];
    return { kind: 'close', tagNoHash, replyMessageId };
  }
  if (action === 'settings') {
    const th = Number(parts[2]);
    const tagNoHash = parts[3] ?? '';
    return { kind: 'settings', th, tagNoHash };
  }
  if (action === 'settings_th') {
    const th = Number(parts[2]);
    const tagNoHash = parts[3] ?? '';
    return { kind: 'settingsTh', th, tagNoHash };
  }
  if (action === 'settings_roles') {
    const th = Number(parts[2]);
    const tagNoHash = parts[3] ?? '';
    return { kind: 'settingsRoles', th, tagNoHash };
  }
  if (action === 'pick') {
    const th = Number(parts[2]);
    const tagNoHash = parts[3] ?? '';
    return { kind: 'pick', th, tagNoHash };
  }

  return { kind: 'unknown' };
}

async function handleAccept(interaction: ButtonInteraction, th: number, tagNoHash: string) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }
  if (!hasRecruitManagePerms(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to accept/close recruit threads.',
      ephemeral: true
    });
    return;
  }

  if (!Number.isInteger(th) || th < 1 || th > 18) {
    await interaction.reply({
      content: `This applicant’s Town Hall (TH${String(th)}) is outside the configurable range (TH1–TH18).`,
      ephemeral: true
    });
    return;
  }

  const guild = interaction.guild;
  const guildId = interaction.guildId;

  const roleIds = await getRecruitRoleIdsForTownHall(guildId, th);
  if (roleIds.length === 0) {
    await interaction.reply({
      content: `No leader roles are configured for TH${th}. Use the ⚙️ Settings button to configure.`,
      ephemeral: true
    });
    return;
  }

  if (roleIds.length === 1) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.channel?.send({
      content:
        `Recruit accepted for TH${th} applicant \`#${tagNoHash}\`.\n` +
        `Pinging: ${roleMention(roleIds[0])}\n` +
        `(Accepted by ${interaction.user.tag})`,
      allowedMentions: { roles: roleIds }
    });
    await interaction.editReply('Ping sent.');
    return;
  }

  // Multiple leader roles match: let the user choose which to ping (and allow multiple).
  const options = roleIds.slice(0, 25).map((roleId) => {
    const role = guild.roles.cache.get(roleId);
    return {
      label: role?.name ?? `Role ${roleId}`,
      value: roleId
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`recruit:pick:${th}:${tagNoHash}`)
    .setPlaceholder('Select leader roles to ping')
    .setMinValues(1)
    .setMaxValues(Math.min(options.length, 25))
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: `Multiple leader roles match TH${th}. Choose which role(s) to ping for \`#${tagNoHash}\`:`,
    components: [row],
    ephemeral: true
  });
}

async function handlePick(interaction: StringSelectMenuInteraction, th: number, tagNoHash: string) {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }
  if (!hasRecruitManagePerms(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to accept/close recruit threads.',
      ephemeral: true
    });
    return;
  }

  const selectedRoleIds = (interaction.values ?? []).slice(0, 25);
  if (selectedRoleIds.length === 0) {
    await interaction.reply({ content: 'No roles selected.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await interaction.channel?.send({
    content:
      `Recruit accepted for TH${th} applicant \`#${tagNoHash}\`.\n` +
      `Pinging: ${selectedRoleIds.map(roleMention).join(' ')}\n` +
      `(Accepted by ${interaction.user.tag})`,
    allowedMentions: { roles: selectedRoleIds }
  });

  await interaction.editReply('Ping sent.');
}

export async function handleClose(interaction: ButtonInteraction, tagNoHash: string, replyMessageId?: string) {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }
  if (!hasRecruitManagePerms(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to accept/close recruit threads.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Update the original "Thread created" message to show it's closed
  if (replyMessageId && interaction.channel?.isThread()) {
    try {
      const parentChannel = interaction.channel.parent;
      if (parentChannel?.isTextBased() && 'messages' in parentChannel) {
        const originalMessage = await parentChannel.messages.fetch(replyMessageId).catch(() => null);
        if (originalMessage && originalMessage.editable) {
          const threadMention = `<#${interaction.channel.id}>`;
          // Update with strikethrough for old text and bold for closed status
          await originalMessage.edit({
            content: `~~Thread created: ${threadMention}~~\n🔒 **Thread closed:** ${threadMention}`
          });
        }
      }
    } catch {
      // ignore if we can't update the original message
    }
  }

  // Try to remove components from the recruit embed message to prevent further actions.
  try {
    if (interaction.message.editable) {
      await interaction.message.edit({ components: [] });
    }
  } catch {
    // ignore
  }

  // Post a closing note before archiving/locking.
  try {
    await interaction.channel?.send(`Recruit thread closed by <@${interaction.user.id}> for \`#${tagNoHash}\`.`);
  } catch {
    // ignore
  }

  // Archive/lock the thread if applicable.
  try {
    if (interaction.channel?.isThread()) {
      await interaction.channel.setLocked(true, `Closed by ${interaction.user.tag}`);
      await interaction.channel.setArchived(true, `Closed by ${interaction.user.tag}`);
      clearOpenApplicantThreadByThreadId(interaction.channel.id);
    }
  } catch {
    // ignore
  }

  await interaction.editReply('Closed.');
}

function buildSettingsRows(opts: { th: number }) {
  const th = Number.isInteger(opts.th) && opts.th >= 1 && opts.th <= 18 ? opts.th : 1;

  const thSelect = new StringSelectMenuBuilder()
    .setCustomId(`recruit:settings_th:${th}:x`)
    .setPlaceholder('Select Town Hall to configure')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      Array.from({ length: 18 }, (_, i) => {
        const value = String(i + 1);
        return {
          label: `TH${value}`,
          value,
          default: i + 1 === th
        };
      })
    );

  const rolesSelect = new RoleSelectMenuBuilder()
    .setCustomId(`recruit:settings_roles:${th}:x`)
    .setPlaceholder(`Select leader roles for TH${th}`)
    .setMinValues(0)
    .setMaxValues(25);

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(thSelect);
  const row2 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(rolesSelect);
  return { row1, row2, th };
}

async function handleSettingsOpen(interaction: ButtonInteraction, th: number) {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }
  if (!hasRecruitManagePerms(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to configure recruit settings.',
      ephemeral: true
    });
    return;
  }

  const guildId = interaction.guildId;

  const safeTh = Number.isInteger(th) && th >= 1 && th <= 18 ? th : 1;
  const currentForTh = await getRecruitRoleIdsForTownHall(guildId, safeTh);
  const summary = await getRecruitRoleMappingSummary(guildId);

  const { row1, row2 } = buildSettingsRows({ th: safeTh });

  // Patch the custom IDs to include a stable marker we can parse (tag is unused here).
  (row1.components[0] as StringSelectMenuBuilder).setCustomId(`recruit:settings_th:${safeTh}:cfg`);
  (row2.components[0] as RoleSelectMenuBuilder).setCustomId(`recruit:settings_roles:${safeTh}:cfg`);

  await interaction.reply({
    content:
      `**Recruit leader role settings**\n\n` +
      `**Current mapping**:\n${summary}\n\n` +
      `**Editing TH${safeTh}**: ${currentForTh.length ? currentForTh.map(roleMention).join(' ') : '_none_'}\n` +
      `Select a TH, then pick role(s) (selection saves immediately).`,
    components: [row1, row2],
    ephemeral: true
  });
}

async function handleSettingsTh(interaction: StringSelectMenuInteraction, th: number) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }
  if (!hasRecruitManagePerms(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to configure recruit settings.',
      ephemeral: true
    });
    return;
  }

  const guildId = interaction.guildId;
  const selected = Number(interaction.values?.[0]);
  const nextTh = Number.isInteger(selected) && selected >= 1 && selected <= 18 ? selected : th;

  const currentForTh = await getRecruitRoleIdsForTownHall(guildId, nextTh);
  const summary = await getRecruitRoleMappingSummary(guildId);
  const { row1, row2 } = buildSettingsRows({ th: nextTh });
  (row1.components[0] as StringSelectMenuBuilder).setCustomId(`recruit:settings_th:${nextTh}:cfg`);
  (row2.components[0] as RoleSelectMenuBuilder).setCustomId(`recruit:settings_roles:${nextTh}:cfg`);

  await interaction.update({
    content:
      `**Recruit leader role settings**\n\n` +
      `**Current mapping**:\n${summary}\n\n` +
      `**Editing TH${nextTh}**: ${currentForTh.length ? currentForTh.map(roleMention).join(' ') : '_none_'}\n` +
      `Select a TH, then pick role(s) (selection saves immediately).`,
    components: [row1, row2]
  });
}

async function handleSettingsRoles(interaction: RoleSelectMenuInteraction, th: number) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This can only be used in a server.', ephemeral: true });
    return;
  }
  if (!hasRecruitManagePerms(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to configure recruit settings.',
      ephemeral: true
    });
    return;
  }

  const guildId = interaction.guildId;
  const picked = Array.from(new Set((interaction.values ?? []).slice(0, 25)));
  await setRecruitRoleIdsForTownHall(guildId, th, picked);

  const currentForTh = await getRecruitRoleIdsForTownHall(guildId, th);
  const summary = await getRecruitRoleMappingSummary(guildId);
  const { row1, row2 } = buildSettingsRows({ th });
  (row1.components[0] as StringSelectMenuBuilder).setCustomId(`recruit:settings_th:${th}:cfg`);
  (row2.components[0] as RoleSelectMenuBuilder).setCustomId(`recruit:settings_roles:${th}:cfg`);

  await interaction.update({
    content:
      `**Recruit leader role settings**\n\n` +
      `**Current mapping**:\n${summary}\n\n` +
      `**Editing TH${th}**: ${currentForTh.length ? currentForTh.map(roleMention).join(' ') : '_none_'}\n` +
      `Saved. You can keep editing.`,
    components: [row1, row2]
  });
}

export async function handleRecruitComponentInteraction(interaction: RecruitComponentInteraction): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (parsed.kind === 'unknown') return false;

  if (parsed.kind === 'accept' && interaction.isButton()) {
    await handleAccept(interaction, parsed.th, parsed.tagNoHash);
    return true;
  }

  if (parsed.kind === 'settings' && interaction.isButton()) {
    await handleSettingsOpen(interaction, parsed.th);
    return true;
  }

  if (parsed.kind === 'settingsTh' && interaction.isStringSelectMenu()) {
    await handleSettingsTh(interaction, parsed.th);
    return true;
  }

  if (parsed.kind === 'settingsRoles' && interaction.isRoleSelectMenu()) {
    await handleSettingsRoles(interaction, parsed.th);
    return true;
  }

  if (parsed.kind === 'pick' && interaction.isStringSelectMenu()) {
    await handlePick(interaction, parsed.th, parsed.tagNoHash);
    return true;
  }

  if (parsed.kind === 'close' && interaction.isButton()) {
    await handleClose(interaction, parsed.tagNoHash, parsed.replyMessageId);
    return true;
  }

  return false;
}
