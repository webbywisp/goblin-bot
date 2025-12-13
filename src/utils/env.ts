import { z } from 'zod';

const EnvSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_GUILD_ID: z.string().min(1).optional(),
    // /recruit leader ping config (JSON)
    // Example:
    // [{"minTh":12,"maxTh":13,"roleIds":["123","456"]},{"minTh":14,"maxTh":17,"roleIds":["789"]}]
    RECRUIT_TH_ROLE_RANGES: z.string().min(1).optional(),
    // Clash of Clans API
    // Set this in your local environment; do not commit it.
    CLASH_OF_CLANS_API_TOKEN: z.string().min(1).optional(),
    CLASH_OF_CLANS_API_BASE_URL: z
      .string()
      .url()
      .default('https://api.clashofclans.com/v1'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info')
  })
  .passthrough();

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
