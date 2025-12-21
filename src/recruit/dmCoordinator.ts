import { ClashOfClansClient } from '@/integrations/clashOfClans/client';
import type { RecruitClanSummary, RecruitDmSession } from '@/recruit/dmSessionStore';
import { updateRecruitDmSession } from '@/recruit/dmSessionStore';
import { logger } from '@/utils/logger';
import { RESTJSONErrorCodes } from 'discord-api-types/v10';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type User
} from 'discord.js';

type RecruiterComponentRow = ActionRowBuilder<MessageActionRowComponentBuilder>;

export const DM_TEMPLATE_PLACEHOLDERS = [
  'player_name',
  'player_tag',
  'player_townhall',
  'recruiter_name',
  'applicant_mention',
  'guild_name',
  'thread_url',
  'community_invite_url',
  'original_message_url'
] as const;

type PlaceholderKey = (typeof DM_TEMPLATE_PLACEHOLDERS)[number];

const TEMPLATE_PLACEHOLDERS: Record<PlaceholderKey, (session: RecruitDmSession) => string | undefined> = {
  player_name: (session) => session.player.name,
  player_tag: (session) => session.player.tag,
  player_townhall: (session) =>
    typeof session.player.townHallLevel === 'number' ? `TH${session.player.townHallLevel}` : undefined,
  recruiter_name: (session) => session.recruiterTag,
  applicant_mention: (session) => `<@${session.applicantId}>`,
  guild_name: (session) => session.homeGuildName,
  thread_url: (session) => session.threadUrl,
  community_invite_url: (session) => session.communityInviteUrl ?? session.threadUrl,
  original_message_url: (session) => session.originalMessageUrl
};

export function renderDmTemplate(content: string, session: RecruitDmSession): string {
  return content.replace(/\{([a-z_]+)\}/gi, (match, key) => {
    const normalized = key.toLowerCase();
    if ((DM_TEMPLATE_PLACEHOLDERS as readonly string[]).includes(normalized)) {
      const resolver = TEMPLATE_PLACEHOLDERS[normalized as PlaceholderKey];
      const value = resolver?.(session);
      return value ?? match;
    }
    return match;
  });
}

export function buildRecruiterDmComponents(session: RecruitDmSession): RecruiterComponentRow[] {
  if (session.recruiterControlsClosed) return [];
  if (session.templates.length === 0) return [];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`recruit_dm:template:${session.id}`)
    .setPlaceholder('Choose a DM template to copy')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      session.templates.slice(0, 25).map((template) => ({
        label: template.name.slice(0, 100),
        value: template.id
      }))
    );

  return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)];
}

export function buildApplicantComponents(session: RecruitDmSession): RecruiterComponentRow[] {
  const rows: RecruiterComponentRow[] = [];

  const actionButtons: ButtonBuilder[] = [
    new ButtonBuilder()
      .setCustomId(`recruit_app:talk:${session.id}`)
      .setLabel('Talk to a clanmate')
      .setStyle(ButtonStyle.Primary)
  ];

  if (session.communityInviteUrl) {
    actionButtons.push(
      new ButtonBuilder()
        .setLabel('Visit community server')
        .setURL(session.communityInviteUrl)
        .setStyle(ButtonStyle.Link)
    );
  }

  if (actionButtons.length > 0) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(actionButtons));
  }

  const summaries = session.clanSummaries ?? [];
  const eligible = summaries.filter((c) => c.eligible).slice(0, 25);
  const ineligible = summaries.filter((c) => !c.eligible).slice(0, 25);

  if (eligible.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`recruit_app:apply:${session.id}`)
      .setPlaceholder('Choose a clan to apply to')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        eligible.map((clan) => ({
          label: clan.name.slice(0, 100),
          value: clan.tag,
          description: formatClanDescription(clan)
        }))
      );
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
  }

  if (ineligible.length > 0) {
    const disabled = new StringSelectMenuBuilder()
      .setCustomId(`recruit_app:apply_unavailable:${session.id}`)
      .setPlaceholder('Unavailable (full or TH mismatch)')
      .setDisabled(true)
      .addOptions(
        ineligible.map((clan) => ({
          label: clan.name.slice(0, 100),
          value: clan.tag,
          description: clan.reason?.slice(0, 100) ?? 'Unavailable'
        }))
      );
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(disabled));
  }

  return rows;
}

function formatClanDescription(clan: RecruitClanSummary): string {
  const thRange =
    typeof clan.minTownHall === 'number' && typeof clan.maxTownHall === 'number'
      ? `TH${clan.minTownHall}-${clan.maxTownHall}`
      : 'Town Hall varies';
  return `${thRange} • ${clan.memberCount}/${clan.memberLimit}`;
}

async function fetchClanSummaries(session: RecruitDmSession): Promise<RecruitClanSummary[]> {
  if (session.clans.length === 0) return [];
  const client = new ClashOfClansClient();
  const applicantTownHall = session.player.townHallLevel;

  const results = await Promise.all(
    session.clans.map(async (clanConfig) => {
      try {
        const clan = await client.getClanByTag(clanConfig.tag);
        const memberCount = clan.members ?? clan.memberList?.length ?? 0;
        const memberLimit = clan.memberLimit ?? 50;
        const thValues = (clan.memberList ?? [])
          .map((member) => member.townHallLevel)
          .filter((value): value is number => typeof value === 'number' && value > 0);
        const minTownHall = thValues.length > 0 ? Math.min(...thValues) : undefined;
        const maxTownHall = thValues.length > 0 ? Math.max(...thValues) : undefined;

        let eligible = true;
        const reasons: string[] = [];
        if (memberCount >= memberLimit) {
          eligible = false;
          reasons.push(`Full (${memberCount}/${memberLimit})`);
        }
        if (typeof applicantTownHall === 'number' && minTownHall && maxTownHall) {
          if (applicantTownHall < minTownHall || applicantTownHall > maxTownHall) {
            eligible = false;
            reasons.push(`Needs TH${minTownHall}-${maxTownHall}`);
          }
        }

        return {
          tag: clan.tag,
          name: clanConfig.name ?? clan.name ?? clan.tag,
          memberCount,
          memberLimit,
          minTownHall,
          maxTownHall,
          applicationUrl: clanConfig.applicationUrl,
          eligible,
          reason: reasons.join(' • ') || undefined
        } satisfies RecruitClanSummary;
      } catch (err) {
        logger.warn({ err, clanTag: clanConfig.tag }, 'Failed to fetch clan details');
        return {
          tag: clanConfig.tag,
          name: clanConfig.name ?? clanConfig.tag,
          memberCount: 0,
          memberLimit: 50,
          applicationUrl: clanConfig.applicationUrl,
          eligible: false,
          reason: 'Unavailable right now'
        } satisfies RecruitClanSummary;
      }
    })
  );

  return results;
}

export async function ensureClanSummaries(session: RecruitDmSession): Promise<RecruitDmSession> {
  if (session.clanSummaries) return session;
  const summaries = await fetchClanSummaries(session);
  return (
    updateRecruitDmSession(session.id, {
      clanSummaries: summaries
    }) ?? session
  );
}

export type SendApplicantDmResult =
  | { ok: true }
  | { ok: false; reason: 'dm_blocked'; message: string }
  | { ok: false; reason: 'unknown'; message: string };

export async function sendApplicantDm(
  session: RecruitDmSession,
  content: string,
  recruiterUser: User
): Promise<SendApplicantDmResult> {
  try {
    let prepared = session;
    if (!session.clanSummaries && session.clans.length > 0) {
      prepared = await ensureClanSummaries(session);
    }

    const user = await recruiterUser.client.users.fetch(session.applicantId);
    const dmChannel = await user.createDM();

    const rows = buildApplicantComponents(prepared);
    const sent = await dmChannel.send({
      content,
      components: rows,
      allowedMentions: { parse: [] }
    });

    updateRecruitDmSession(session.id, {
      dmChannelId: sent.channelId,
      dmMessageId: sent.id,
      clanSummaries: prepared.clanSummaries ?? session.clanSummaries
    });
    return { ok: true };
  } catch (err: unknown) {
    const discordError = err as { code?: number };
    const code = typeof discordError?.code === 'number' ? discordError.code : undefined;
    const reason = code === RESTJSONErrorCodes.CannotSendMessagesToThisUser ? 'dm_blocked' : 'unknown';
    logger.warn({ err, applicantId: session.applicantId }, 'Failed to send recruit DM');
    const generic =
      err instanceof Error
        ? `I could not DM ${session.applicantTag}: ${err.message}`
        : `I could not DM ${session.applicantTag}.`;
    const message =
      reason === 'dm_blocked'
        ? `${generic}\nDiscord prevents me from messaging them directly (we probably don't share a server).`
        : generic;
    return { ok: false, reason, message };
  }
}
