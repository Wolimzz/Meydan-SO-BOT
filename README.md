# Discord + Roblox Live Stats

Cloud-first live statistics system:

- Discord total member count
- Discord active member count
- Roblox concurrent player count across all live game servers
- Roblox heartbeats with stale-server cleanup
- Shared Supabase state (no local/VDS data storage)
- Discord bot runs as an always-on Railway service
- GitHub -> Railway automatic deployment

## Architecture

Roblox Servers -> Railway API -> Supabase -> Discord Bot -> Voice Channels

## Environment variables

Copy `.env.example` to your deployment variables. Never commit the real `.env` file or Discord token.

## Discord intents

Enable `SERVER MEMBERS INTENT` and `PRESENCE INTENT` in the Discord Developer Portal for the bot. The bot needs permission to manage the three voice channels.

## Supabase

Run `supabase.sql` in the Supabase SQL editor.

## Railway

Connect this GitHub repo to a Railway persistent service. Set the environment variables from `.env.example`. Railway can deploy directly from GitHub and keeps the service running continuously.

Generate a public Railway domain and put it into `roblox.server.lua` as the API URL. Enable HTTP Requests in Roblox Game Settings > Security.

## Local testing

`npm install`

`npm start`
