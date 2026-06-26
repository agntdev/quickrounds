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

async function readAllKeysWithPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  const all = storage.readAllKeys;
  if (!all) return keys;
  const result = all.call(storage);
  if (Symbol.asyncIterator in Object(result)) {
    for await (const k of result as AsyncIterable<string>) {
      if (k.startsWith(prefix)) keys.push(k);
    }
  } else if (Symbol.iterator in Object(result)) {
    for (const k of result as Iterable<string>) {
      if (k.startsWith(prefix)) keys.push(k);
    }
  }
  return keys;
}

export async function listGameRounds(chatId: number, limit = 10): Promise<GameRound[]> {
  const keys = await readAllKeysWithPrefix(dk("game:"));
  const rounds: GameRound[] = [];
  for (const key of keys) {
    const raw = await storage.read(key);
    if (!raw) continue;
    const r = raw as unknown as GameRound;
    if (r.group_chat_id === chatId) rounds.push(r);
  }
  rounds.sort((a, b) => b.start_timestamp - a.start_timestamp);
  return rounds.slice(0, limit);
}

export async function listOpenGames(): Promise<GameRound[]> {
  const keys = await readAllKeysWithPrefix(dk("game:"));
  const rounds: GameRound[] = [];
  for (const key of keys) {
    const raw = await storage.read(key);
    if (!raw) continue;
    const r = raw as unknown as GameRound;
    if (r.status === "open") rounds.push(r);
  }
  return rounds;
}

export async function listTransactions(userId: number, limit = 10): Promise<TransactionLog[]> {
  const keys = await readAllKeysWithPrefix(dk("tx:"));
  const txs: TransactionLog[] = [];
  for (const key of keys) {
    const raw = await storage.read(key);
    if (!raw) continue;
    const tx = raw as unknown as TransactionLog;
    if (tx.user_id === userId) txs.push(tx);
  }
  txs.sort((a, b) => b.timestamp - a.timestamp);
  return txs.slice(0, limit);
}