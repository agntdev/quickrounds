import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { listGameRounds, listTransactions, type GameRound, type TransactionLog } from "../store.js";

registerMainMenuItem({ label: "📋 Rounds", data: "rounds:list", order: 20 });
registerMainMenuItem({ label: "📊 Log", data: "txn:list", order: 30 });

const composer = new Composer<Ctx>();

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

function formatRound(r: GameRound): string {
  const statusIcon = r.status === "open" ? "🟢" : r.status === "started" ? "▶️" : "❌";
  const date = new Date(r.start_timestamp).toLocaleString();
  const players = r.players.length > 0 ? r.players.map((p) => `Player ${p}`).join(", ") : "none";
  return `${statusIcon} Round ${r.id.slice(0, 8)}\n   ${date}\n   Status: ${r.status}\n   Players: ${players}`;
}

function formatTx(tx: TransactionLog): string {
  const sign = tx.amount >= 0 ? "+" : "";
  const date = new Date(tx.timestamp).toLocaleString();
  return `${sign}${tx.amount} pts — ${tx.reason}\n   ${date}`;
}

composer.callbackQuery("rounds:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.editMessageText("Rounds are only available in group chats.", { reply_markup: backToMenu });
    return;
  }
  const rounds = await listGameRounds(chatId, 10);
  if (rounds.length === 0) {
    await ctx.editMessageText("No game rounds yet — start one with 🎮 New Game.", { reply_markup: backToMenu });
    return;
  }
  const text = `📋 Recent rounds:\n\n${rounds.map(formatRound).join("\n\n")}`;
  await ctx.editMessageText(text, { reply_markup: backToMenu });
});

composer.callbackQuery("txn:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from!.id;
  const txs = await listTransactions(userId, 10);
  if (txs.length === 0) {
    await ctx.editMessageText("No transactions yet.", { reply_markup: backToMenu });
    return;
  }
  const text = `📊 Your recent transactions:\n\n${txs.map(formatTx).join("\n\n")}`;
  await ctx.editMessageText(text, { reply_markup: backToMenu });
});

export default composer;