import { buildBot } from "./bot.js";
import { setDefaultCommands } from "./toolkit/index.js";
import { listOpenGames, saveGameRound, getUser, saveUser, addTransaction } from "./store.js";

const JOIN_COST = 10;

function startedRecoveryText(game: { players: number[] }, loserId: number): string {
  const players = game.players.map((pid, i) => {
    const marker = pid === loserId ? " 💀" : " ✅";
    return `${i + 1}. Player ${pid}${marker}`;
  }).join("\n");
  return `🎮 Game started!\n\nPlayers:\n${players}\n\n💀 Player ${loserId} lost! 10 points split among winners.`;
}

async function recoverStaleGames(token: string) {
  const openGames = await listOpenGames();
  if (openGames.length === 0) return;

  const now = Date.now();
  const stale = openGames.filter((g) => g.registration_deadline <= now);
  if (stale.length === 0) return;

  const bot = await buildBot(token);
  const api = bot.api;

  for (const game of stale) {
    if (game.players.length >= 2) {
      game.status = "started";
      await saveGameRound(game);

      const loserIndex = Math.floor(Math.random() * game.players.length);
      const loserId = game.players[loserIndex];
      const winners = game.players.filter((_, i) => i !== loserIndex);
      const sharePerWinner = Math.floor(JOIN_COST / winners.length);
      const remainder = JOIN_COST - sharePerWinner * winners.length;

      for (let i = 0; i < winners.length; i++) {
        const pid = winners[i];
        const extra = i === 0 ? remainder : 0;
        const user = await getUser(pid);
        if (user) {
          user.point_balance += JOIN_COST + sharePerWinner + extra;
          user.join_history.push(`win:${game.id}`);
          await saveUser(user);
          await addTransaction({
            user_id: pid,
            amount: JOIN_COST + sharePerWinner + extra,
            reason: `win:${game.id}`,
            timestamp: Date.now(),
          });
        }
      }

      const loser = await getUser(loserId);
      if (loser) {
        loser.join_history.push(`lose:${game.id}`);
        await saveUser(loser);
      }

      try {
        await api.editMessageText(
          game.group_chat_id,
          game.message_id,
          startedRecoveryText(game, loserId),
        );
      } catch {
        // Message may no longer exist
      }
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
            await api.sendMessage(
              pid,
              "A game round you joined was cancelled (bot restarted). Your 10 points have been refunded.",
            );
          } catch {
            // DM delivery is best-effort
          }
        }
      }
      try {
        await api.editMessageText(
          game.group_chat_id,
          game.message_id,
          "Game cancelled — need at least 2 players to start. All join fees have been refunded.",
        );
      } catch {
        // Message may no longer exist
      }
    }
  }

  await bot.stop();
}

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is required");
    process.exit(1);
  }

  await recoverStaleGames(token);

  const bot = await buildBot(token);
  await setDefaultCommands(bot);
  bot.start();
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});