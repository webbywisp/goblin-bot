import type { ChatInputCommand, MessageCommand } from '@/commands/types';

let chatInputCommandMap: ReadonlyMap<string, ChatInputCommand> = new Map();
let messageCommandMap: ReadonlyMap<string, MessageCommand> = new Map();

export function setChatInputCommandMap(map: ReadonlyMap<string, ChatInputCommand>) {
  chatInputCommandMap = map;
}

export function getChatInputCommandMap() {
  return chatInputCommandMap;
}

export function setMessageCommandMap(map: ReadonlyMap<string, MessageCommand>) {
  messageCommandMap = map;
}

export function getMessageCommandMap() {
  return messageCommandMap;
}
