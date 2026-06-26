# Group Game Bot — Bot specification

**Archetype:** community

A Telegram group chat game bot where users earn and spend points to participate in timed rounds. Users start with 100 points and can join games by spending 10 points. The game owner initiates rounds and can start them early. If fewer than two players join, the round is canceled and points are refunded.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Small to medium-sized Telegram groups
- Casual social players
- Group admins looking for interactive activities

## Success criteria

- Users can start and join games within 30 seconds
- Points are deducted and refunded accurately
- Game rounds are resolved with clear status updates

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu or initialize a new user with 100 points
- **/game** (command, actor: user, command: /game) — Start a new game round in the group chat
- **Join** (button, actor: user, callback: game:join) — Join the current game round by spending 10 points
- **Start now** (button, actor: user, callback: game:start) — Start the current game round (only available to the owner)

## Flows

### Start a game round
_Trigger:_ /game

1. Bot posts a message with 'Join' and 'Start now' buttons
2. 30-second countdown begins for registration
3. Owner can press 'Start now' at any time during the countdown

_Data touched:_ Game round, User profile

### Join a game round
_Trigger:_ game:join

1. Check user's point balance
2. Deduct 10 points if sufficient
3. Add user to the player list
4. Update the registration message with current participants

_Data touched:_ User profile, Game round, Transaction log

### Start or cancel a game round
_Trigger:_ game:start or 30s timeout

1. Check if at least two players have joined
2. If yes, mark the round as 'started' and post the game-start message
3. If no, cancel the round and refund all join fees to participants

_Data touched:_ Game round, User profile, Transaction log

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User profile** _(retention: persistent)_ — Tracks each user's Telegram ID, display name, point balance, and join history
  - fields: telegram_id, display_name, point_balance, join_history
- **Game round** _(retention: persistent)_ — Tracks each game's ID, group chat ID, owner ID, start timestamp, registration deadline, status, and list of players
  - fields: id, group_chat_id, owner_id, start_timestamp, registration_deadline, status, players
- **Transaction log** _(retention: persistent)_ — Tracks all point deductions and refunds with user ID, amount, reason, and timestamp
  - fields: user_id, amount, reason, timestamp

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Start a new game round with /game
- See the list of active and recent game rounds
- View transaction logs for point deductions and refunds

## Notifications

- Group chat message when a new game starts
- Direct message to users for insufficient balance or join failures
- Group chat message when a game is canceled and refunds are issued

## Permissions & privacy

- User data (Telegram ID, display name, point balance) is stored securely and not shared with third parties
- Only the owner can start a game round via the 'Start now' button
- Join actions are visible to all group members in the registration message

## Edge cases

- Multiple users attempt to join simultaneously and all have sufficient points
- Owner starts a game round with only one participant, triggering a cancellation and refund
- User attempts to join a game with insufficient points and receives an error message
- User tries to start a game round but is not the owner and receives an access-denied alert

## Required tests

- Verify that a new user receives 100 points on first interaction
- Confirm that the 'Join' button deducts 10 points and adds the user to the player list
- Ensure that the 'Start now' button is only visible to the owner
- Test that a game round is canceled and all join fees are refunded if fewer than two players join
- Validate that the game round status is updated correctly in the group chat

## Assumptions

- All game mechanics beyond registration and start are to be added later
- No external payment systems are required
- All point transactions are internal and do not involve real money
