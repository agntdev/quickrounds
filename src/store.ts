import { resolveSessionStorage } from "./toolkit/index.js";
import type { StorageAdapter } from "grammy";

export interface UserProfile {
  telegram_id: number;
  display_name: string;
  point_balance: number;
  join_history: string[];
}

export interface GameRound {
  id: string;
  group_chat_id: number;
  owner_id: number;
  start_timestamp: number;
  registration_deadline: number;
  status: "open" | "started" | "cancelled";
  players: number[];
  message_id: number;
}

export interface TransactionLog {
  user_id: number;
  amount: number;
  reason: string;
  timestamp: number;
}

const PREFIX = "data:";
const storage: StorageAdapter<Record<string, unknown>> =
  resolveSessionStorage<Record<string, unknown>>(undefined);

function dk(key: string): string {
  return PREFIX + key;
}

export async function getUser(userId: number): Promise<UserProfile | undefined> {
  const raw = await storage.read(dk(`user:${userId}`));
  return raw as UserProfile | undefined;
}

export async function ensureUser(userId: number, displayName: string): Promise<UserProfile> {
  let user = await getUser(userId);
  if (!user) {
    user = {
      telegram_id: userId,
      display_name: displayName,
      point_balance: 100,
      join_history: [],
    };
    await saveUser(user);
  }
  return user;
}

export async function saveUser(user: UserProfile): Promise<void> {
  await storage.write(dk(`user:${user.telegram_id}`), user as unknown as Record<string, unknown>);
}

export async function getGameRound(id: string): Promise<GameRound | undefined> {
  const raw = await storage.read(dk(`game:${id}`));
  return raw as GameRound | undefined;
}

export async function saveGameRound(game: GameRound): Promise<void> {
  await storage.write(dk(`game:${game.id}`), game as unknown as Record<string, unknown>);
}

export async function addTransaction(tx: TransactionLog): Promise<void> {
  await storage.write(dk(`tx:${tx.timestamp}:${tx.user_id}`), tx as unknown as Record<string, unknown>);
}