# Hangout Haven Economy Bot

A starter Discord economy bot using Node.js + Supabase and slash commands. Deployable to Railway and hosted on GitHub.

Features implemented (commands 1–18):
1. `/work` — earn wages
2. `/idle` — toggle idle passive earnings
3. `/daily` — daily claim with streaks
4. `/minigame` — simple dice/trivia stub
5. `/quest` — list / complete quests
6. `/shop` — view and buy items
7. `/auction` — create/list bid (simple)
8. `/lottery` — buy ticket and draw (admin)
9. `/trade` — propose trade to another user
10. `/craft` — craft items from resources
11. `/bank` — deposit/withdraw
12. `/stock` — simulated stock buy/sell
13. `/gamble` — gamble mini-game
14. `/currency` — convert between currencies
15. `/event` — server-wide event trigger (admin)
16. `/guild` — create/join guilds
17. `/leaderboard` — top players
18. `/collectible` — mint/list collectibles

## Setup
1. Create a Supabase project and run the SQL in `supabase_schema.sql` (included below).
2. Create a Discord application & bot, enable "MESSAGE CONTENT INTENT" if needed, get token and client ID.
3. Copy `.env.example` to `.env` and fill values or set Railway environment variables.
4. `npm install` then `npm start` locally or deploy to Railway (see section Deploy).

## Deploy to Railway
1. Create a new project on Railway and connect your GitHub repo.
2. Add environment variables (DISCORD_TOKEN, DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
3. Set start command `npm start`.
4. Deploy.