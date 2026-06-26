import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, type InlineKeyboardMarkup } from "../toolkit/index.js";
import {
  ensureUser,
  getUser,
  saveUser,
  saveGameRound,
  getGameRound,
  addTransaction,
  listGameRounds,
  type GameRound,
} from "../store.js";

declare module "../bot.js" {
  interface Session {
    activeGameId?: string;
    activeGameMessageId?: number;
  }
}

registerMainMenuItem({ label: "🎮 New Game", data: "game:new", order: 10 });

const JOIN_COST = 10;
const REGISTRATION_SECONDS = 30;

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function registrationKeyboard(ownerId: number, viewerId: number): InlineKeyboardMarkup {
  const joinBtn = inlineButton("✋ Join", "game:join");
  const row = [joinBtn];
  if (viewerId === ownerId) {
    row.push(inlineButton("▶️ Start now", "game:start"));
  }
  return inlineKeyboard([row]);
}

function gameStatusText(game: GameRound): string {
  const deadline = Math.max(0, game.registration_deadline - Date.now());
  const seconds = Math.ceil(deadline / 1000);
  const playersText =
    game.players.length > 0
      ? game.players.map((pid, i) => `${i + 1}. Player ${pid}`).join("\n")
      : "No players yet — tap ✋ Join to enter.";
  return `🎮 Game round!\n\nPlayers (${game.players.length}):\n${playersText}\n\n⏳ Registration closes in ${seconds}s`;
}

function startedText(game: GameRound): string {
  const playersText = game.players.map((pid, i) => `${i + 1}. Player ${pid}`).join("\n");
  return `🎮 Game started!\n\nPlayers:\n${playersText}\n\nGood luck!`;
}

function cancelledText(): string {
  return "Game cancelled — need at least 2 players to start. All join fees have been refunded.";
}

async function cancelPreviousGame(chatId: number, excludeGameId: string, api: Ctx["api"]): Promise<void> {
  const rounds = await listGameRounds(chatId, 5);
  for (const r of rounds) {
    if (r.id === excludeGameId) continue;
    if (r.status !== "open") continue;
    r.status = "cancelled";
    await saveGameRound(r);
    for (const pid of r.players) {
      const user = await getUser(pid);
      if (user) {
        user.point_balance += JOIN_COST;
        user.join_history.push(`refund:${r.id}`);
        await saveUser(user);
        await addTransaction({
          user_id: pid,
          amount: JOIN_COST,
          reason: `refund:${r.id}`,
          timestamp: Date.now(),
        });
        try {
          await api.sendMessage(pid, "A previous game round was cancelled and your 10 points have been refunded.");
        } catch {
          // DM delivery is best-effort
        }
      }
    }
    try {
      await api.editMessageText(chatId, r.message_id, "Game cancelled — a new round was started.");
    } catch {
      // Message may no longer exist
    }
  }
}

async function resolveGame(
  game: GameRound,
  api: Ctx["api"],
): Promise<void> {
  if (game.players.length >= 2) {
    game.status = "started";
    await saveGameRound(game);
    await api.editMessageText(game.group_chat_id, game.message_id, startedText(game));
  } else {
    game.status = "cancelled";
    await saveGameRound(game);
    for (const pid of game.players) {
      const user = await getUser(pid);
      if (user) {
        user.point_balance += JOIN_COST;
        user.join_history.push(`refund:${game.id}`);
        await saveUser(user);
        await addTransaction({
          user_id: pid,
          amount: JOIN_COST,
          reason: `refund:${game.id}`,
          timestamp: Date.now(),
        });
        try {
          await api.sendMessage(pid, "The game round was cancelled and your 10 points have been refunded.");
        } catch {
          // DM delivery is best-effort
        }
      }
    }
    await api.editMessageText(game.group_chat_id, game.message_id, cancelledText());
  }
}

function clearGameSession(ctx: Ctx): void {
  ctx.session.activeGameId = undefined;
  ctx.session.activeGameMessageId = undefined;
}

const composer = new Composer<Ctx>();

async function doCreateGame(
  ctx: Ctx,
  send: (text: string, markup: InlineKeyboardMarkup) => Promise<{ message_id: number } | unknown>,
): Promise<void> {
  const userId = ctx.from!.id;
  const chatId = ctx.chat!.id;
  const userName = ctx.from!.first_name ?? "Player";

  const prevId = ctx.session.activeGameId;
  if (prevId) {
    const existingTimer = activeTimers.get(prevId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      activeTimers.delete(prevId);
    }
  }

  await ensureUser(userId, userName);

  const gameId = `${Date.now()}_${userId}`;
  const now = Date.now();
  const game: GameRound = {
    id: gameId,
    group_chat_id: chatId,
    owner_id: userId,
    start_timestamp: now,
    registration_deadline: now + REGISTRATION_SECONDS * 1000,
    status: "open",
    players: [],
    message_id: 0,
  };

  await cancelPreviousGame(chatId, gameId, ctx.api);

  await saveGameRound(game);

  const msg = await send(gameStatusText(game), registrationKeyboard(userId, userId));
  const sentMsg = msg as { message_id: number };
  game.message_id = sentMsg.message_id;
  await saveGameRound(game);

  ctx.session.activeGameId = gameId;
  ctx.session.activeGameMessageId = sentMsg.message_id;

  const api = ctx.api;
  const timer = setTimeout(async () => {
    activeTimers.delete(gameId);
    const current = await getGameRound(gameId);
    if (!current || current.status !== "open") return;
    await resolveGame(current, api);
  }, REGISTRATION_SECONDS * 1000);

  activeTimers.set(gameId, timer);
}

// Start from main menu button
composer.callbackQuery("game:new", async (ctx) => {
  await ctx.answerCallbackQuery();
  await doCreateGame(ctx, (text, markup) =>
    ctx.editMessageText(text, { reply_markup: markup }),
  );
});

// Start via /game command
composer.command("game", async (ctx) => {
  await doCreateGame(ctx, (text, markup) =>
    ctx.reply(text, { reply_markup: markup }),
  );
});

// Join a game
composer.callbackQuery("game:join", async (ctx) => {
  const userId = ctx.from!.id;
  const gameId = ctx.session.activeGameId;

  if (!gameId) {
    await ctx.answerCallbackQuery({
      text: "No active game round. Start one with /game.",
      show_alert: true,
    });
    return;
  }

  const game = await getGameRound(gameId);
  if (!game || game.status !== "open") {
    await ctx.answerCallbackQuery({
      text: "This game round has ended. Start a new one with /game.",
      show_alert: true,
    });
    clearGameSession(ctx);
    return;
  }

  if (game.message_id !== ctx.callbackQuery.message?.message_id) {
    await ctx.answerCallbackQuery({
      text: "This game round has ended. Start a new one with /game.",
      show_alert: true,
    });
    return;
  }

  if (Date.now() > game.registration_deadline) {
    await ctx.answerCallbackQuery({
      text: "Registration time has expired. Start a new game with /game.",
      show_alert: true,
    });
    const timer = activeTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(gameId);
    }
    clearGameSession(ctx);
    await resolveGame(game, ctx.api);
    return;
  }

  if (game.players.includes(userId)) {
    await ctx.answerCallbackQuery({
      text: "You're already in this game!",
      show_alert: true,
    });
    return;
  }

  const user = await ensureUser(userId, ctx.from!.first_name ?? "Player");

  if (user.point_balance < JOIN_COST) {
    try {
      await ctx.api.sendMessage(
        userId,
        `You need 10 points to join the game. Your balance: ${user.point_balance}. Start a new game with /game to earn more.`,
      );
    } catch {
      // DM delivery is best-effort
    }
    await ctx.answerCallbackQuery({
      text: `You need 10 points to join. Your balance: ${user.point_balance}.`,
      show_alert: true,
    });
    return;
  }

  user.point_balance -= JOIN_COST;
  user.join_history.push(`join:${game.id}`);
  await saveUser(user);

  await addTransaction({
    user_id: userId,
    amount: -JOIN_COST,
    reason: `join:${game.id}`,
    timestamp: Date.now(),
  });

  game.players.push(userId);
  await saveGameRound(game);

  await ctx.editMessageText(gameStatusText(game), {
    reply_markup: registrationKeyboard(game.owner_id, userId),
  });
  await ctx.answerCallbackQuery();
});

// Start now (owner only)
composer.callbackQuery("game:start", async (ctx) => {
  const userId = ctx.from!.id;
  const gameId = ctx.session.activeGameId;

  if (!gameId) {
    await ctx.answerCallbackQuery({
      text: "No active game round.",
      show_alert: true,
    });
    return;
  }

  const game = await getGameRound(gameId);
  if (!game || game.status !== "open") {
    await ctx.answerCallbackQuery({
      text: "This game round has already ended.",
      show_alert: true,
    });
    clearGameSession(ctx);
    return;
  }

  if (game.owner_id !== userId) {
    await ctx.answerCallbackQuery({
      text: "Only the game owner can start the round.",
      show_alert: true,
    });
    return;
  }

  const timer = activeTimers.get(gameId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(gameId);
  }

  clearGameSession(ctx);

  await resolveGame(game, ctx.api);
  await ctx.answerCallbackQuery();
});

export default composer;