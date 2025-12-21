import { describe, expect, it } from 'vitest';
import { renderDmTemplate } from '@/recruit/dmCoordinator';
import type { RecruitDmSession } from '@/recruit/dmSessionStore';

const baseSession: RecruitDmSession = {
  id: 'session',
  guildId: 'guild',
  threadId: 'thread',
  threadUrl: 'https://discord.com/channels/guild/thread',
  recruiterId: 'recruiter',
  recruiterTag: 'Recruiter#1234',
  applicantId: 'applicant',
  applicantTag: 'Applicant#1234',
  player: {
    name: 'Player',
    tag: '#PLAYER',
    townHallLevel: 16
  },
  originalMessageUrl: 'https://discord.com/channels/guild/message/abc',
  clans: [],
  templates: [],
  createdAt: Date.now()
};

describe('renderDmTemplate', () => {
  it('falls back to thread URL when community invite is missing', () => {
    const session = { ...baseSession };
    const rendered = renderDmTemplate('Join us: {community_invite_url}', session);
    expect(rendered).toContain(session.threadUrl);
  });

  it('uses configured community invite when provided', () => {
    const session: RecruitDmSession = {
      ...baseSession,
      communityInviteUrl: 'https://discord.gg/example'
    };
    const rendered = renderDmTemplate('Join us: {community_invite_url}', session);
    expect(rendered).toContain('https://discord.gg/example');
  });
});
