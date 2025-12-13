import {
  ActionRowBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  roleMention
} from 'discord.js';
import { getRecruitLeaderRoleIdsForTownHall } from '@/recruit/leaderPingConfig';

type RecruitComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;

function hasRecruitManagePerms(interaction: RecruitComponentInteraction): boolean {
  const perms = interaction.memberPermissions;
  return Boolean(
    perms?.has(PermissionFlagsBits.Administrator) ||
      perms?.has(PermissionFlagsBits.ManageThreads) ||
      perms?.has(PermissionFlagsBits.ManageMessages)
  );
}

function parseCustomId(customId: string):
  | { kind: 'accept'; th: number; tagNoHash: string }
  | { kind: 'close'; tagNoHash: string }
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
    return { kind: 'close', tagNoHash };
  }
  if (action === 'pick') {
    const th = Number(parts[2]);
    const tagNoHash = parts[3] ?? '';
    return { kind: 'pick', th, tagNoHash };
  }

  return { kind: 'unknown' };
}

async function handleAccept(interaction: ButtonInteraction, th: number, tagNoHash: string) {
  if (!interaction.inGuild()) {
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

  const roleIds = getRecruitLeaderRoleIdsForTownHall(th);
  if (roleIds.length === 0) {
    await interaction.reply({
      content: `No leader roles are configured for TH${th}. (Set \`RECRUIT_TH_ROLE_RANGES\`.)`,
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
    const role = interaction.guild.roles.cache.get(roleId);
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
  if (!interaction.inGuild()) {
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

async function handleClose(interaction: ButtonInteraction, tagNoHash: string) {
  if (!interaction.inGuild()) {
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
    await interaction.channel?.send(`Recruit thread closed by ${interaction.user.tag} for \`#${tagNoHash}\`.`);
  } catch {
    // ignore
  }

  // Archive/lock the thread if applicable.
  try {
    if (interaction.channel?.isThread()) {
      await interaction.channel.setLocked(true, `Closed by ${interaction.user.tag}`);
      await interaction.channel.setArchived(true, `Closed by ${interaction.user.tag}`);
    }
  } catch {
    // ignore
  }

  await interaction.editReply('Closed.');
}

export async function handleRecruitComponentInteraction(
  interaction: RecruitComponentInteraction
): Promise<boolean> {
  const parsed = parseCustomId(interaction.customId);
  if (parsed.kind === 'unknown') return false;

  if (parsed.kind === 'accept' && interaction.isButton()) {
    await handleAccept(interaction, parsed.th, parsed.tagNoHash);
    return true;
  }

  if (parsed.kind === 'pick' && interaction.isStringSelectMenu()) {
    await handlePick(interaction, parsed.th, parsed.tagNoHash);
    return true;
  }

  if (parsed.kind === 'close' && interaction.isButton()) {
    await handleClose(interaction, parsed.tagNoHash);
    return true;
  }

  return false;
}

