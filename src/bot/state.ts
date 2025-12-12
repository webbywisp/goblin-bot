import type { ChatInputCommand } from '@/commands/types';

let chatInputCommandMap: ReadonlyMap<string, ChatInputCommand> = new Map();

export function setChatInputCommandMap(map: ReadonlyMap<string, ChatInputCommand>) {
  chatInputCommandMap = map;
}

export function getChatInputCommandMap() {
  return chatInputCommandMap;
}
