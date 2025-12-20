// Central place for static role IDs used by the bot.
const DEFAULT_FAMILY_LEADER_ROLE_ID = '1438076614700175581';

const envOverride = process.env.FAMILY_LEADER_ROLE_ID;
export const FAMILY_LEADER_ROLE_ID =
  envOverride && envOverride.trim().length > 0 ? envOverride.trim() : DEFAULT_FAMILY_LEADER_ROLE_ID;
