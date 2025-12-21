import { type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { getRecruitDmSession, type RecruitDmSession } from '@/recruit/dmSessionStore';
import { renderDmTemplate } from '@/recruit/dmCoordinator';

function isRecruiterDmCustomId(customId: string): boolean {
  return customId.startsWith('recruit_dm:');
}

function parseCustomId(customId: string): { action: string; sessionId: string } | null {
  if (!isRecruiterDmCustomId(customId)) return null;
  const [, action, sessionId] = customId.split(':');
  if (!sessionId) return null;
  return { action, sessionId };
}

function assertSessionOwner(session: RecruitDmSession, userId: string) {
  if (session.recruiterId !== userId) {
    throw new Error('Only the recruiter who started this flow can use these controls.');
  }
}

function buildNextContent(session: RecruitDmSession, suffix: string): string {
  const base = session.statusMessage ?? 'Recruit thread created.';
  return `${base}\n${suffix}`;
}

function buildManualDmPayload(session: RecruitDmSession, message: string) {
  const sanitized = message.length > 1900 ? `${message.slice(0, 1900)}…` : message;
  const header = buildNextContent(session, 'Copy/paste this message:');

  return {
    instructions: header,
    template: sanitized
  };
}

export async function handleRecruiterDmComponentInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction
): Promise<boolean> {
  if (!isRecruiterDmCustomId(interaction.customId)) return false;
  if (!interaction.isStringSelectMenu()) return false;
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const session = getRecruitDmSession(parsed.sessionId);
  if (!session) {
    await interaction.reply({ content: 'This DM prompt has expired. Run the command again.', ephemeral: true });
    return true;
  }

  try {
    assertSessionOwner(session, interaction.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'You cannot use that control.';
    await interaction.reply({ content: message, ephemeral: true });
    return true;
  }

  if (session.recruiterControlsClosed) {
    await interaction.reply({ content: 'This DM flow is already complete.', ephemeral: true });
    return true;
  }

  const templateId = interaction.values?.[0];
  if (!templateId) {
    await interaction.reply({ content: 'Choose a template first.', ephemeral: true });
    return true;
  }
  const template = session.templates.find((entry) => entry.id === templateId);
  if (!template) {
    await interaction.reply({ content: 'That template is no longer available.', ephemeral: true });
    return true;
  }
  const rendered = renderDmTemplate(template.content, session);
  const { instructions, template: templateText } = buildManualDmPayload(session, rendered);
  await interaction.reply({
    content: instructions,
    allowedMentions: { parse: [], users: [] },
    ephemeral: true
  });
  await interaction.followUp({
    content: templateText,
    allowedMentions: { parse: [], users: [] },
    ephemeral: true
  });
  return true;
}
