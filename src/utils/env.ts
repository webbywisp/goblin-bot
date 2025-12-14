import { z } from 'zod';

const EnvSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_GUILD_ID: z.string().min(1).optional(),
    // Clash of Clans API
    // Set this in your local environment; do not commit it.
    CLASH_OF_CLANS_API_TOKEN: z.string().min(1).optional(),
    CLASH_OF_CLANS_API_BASE_URL: z
      .string()
      .url()
      .default('https://api.clashofclans.com/v1'),
    // Optional: hard timeout for CoC API requests (ms)
    CLASH_OF_CLANS_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10_000),
    // Optional: helps identify which running instance replied in Discord
    BOT_INSTANCE_LABEL: z.string().min(1).optional(),
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
