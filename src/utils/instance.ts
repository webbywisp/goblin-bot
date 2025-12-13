import { getEnv } from '@/utils/env';

export function getInstanceLabel(): string {
  return (
    getEnv().BOT_INSTANCE_LABEL ??
    process.env.HOSTNAME ??
    process.env.RENDER_INSTANCE_ID ??
    `pid:${process.pid}`
  );
}

