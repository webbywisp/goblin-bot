import pino from 'pino';
import { getEnv } from '@/utils/env';

const isPretty = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  transport: isPretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    : undefined
});
