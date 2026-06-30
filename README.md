# Doors Report Bot

Discord bot that posts Roblox bug reports with interactive buttons (Accept / In Progress / Fixed / Reject / Ban) and writes status + bans back to Roblox via Open Cloud DataStore. The Roblox game reads those statuses/bans.

## How it works

1. Player submits a report in-game -> Roblox saves it to DataStore `BugReports_V1` with `Posted = false`.
2. This bot polls the DataStore every `POLL_SECONDS`, finds unposted reports, posts them to your channel with buttons, marks `Posted = true`.
3. You click a button:
   - **Accept / In Progress / Fixed / Reject** -> writes new `Status` to the report in DataStore.
   - **Ban author** -> opens a modal (reason + days), writes a ban to `BugBans_V1`.
4. The Roblox game reads `Status` (shown to the player in the "My Reports" tab) and `BugBans_V1` (kicks/blocks banned players).

## Files to upload to GitHub

Upload the whole `report-bot` folder:

- `index.js`
- `datastore.js`
- `package.json`
- `.env.example` (do NOT upload a real `.env` with secrets)
- `README.md`

## Railway setup

1. Push this folder to a GitHub repo.
2. On Railway: New Project -> Deploy from GitHub repo -> pick the repo.
3. Railway auto-detects Node and runs `npm start`.
4. In Railway -> your service -> Variables, add these (from `.env.example`):
   - `DISCORD_TOKEN`
   - `REPORT_CHANNEL_ID`
   - `OPEN_CLOUD_KEY`
   - `UNIVERSE_ID`
   - `POLL_SECONDS` (optional, default 15)
5. Deploy. Check logs: you should see `Logged in as ...`.

## Discord bot setup

1. https://discord.com/developers/applications -> New Application.
2. Bot tab -> Reset Token -> copy into `DISCORD_TOKEN`.
3. Installation / OAuth2 -> scopes: `bot`, `applications.commands`. Bot permissions: `Send Messages`, `Embed Links`, `Read Message History`.
4. Invite the bot to your server, make sure it can see/post in your report channel.
5. No privileged intents are needed (we only use Guilds).

## Roblox Open Cloud setup

1. https://create.roblox.com -> Open Cloud -> API Keys -> Create API Key.
2. Add the **DataStores** API system. Scope it to your experience.
3. Permissions: `Read` and `Write` (and `List` for entries).
4. Copy the key into `OPEN_CLOUD_KEY`.
5. Get your **Universe ID** (Creator Dashboard -> your game -> three dots -> Copy Universe ID) into `UNIVERSE_ID`.
6. In Roblox Studio: Game Settings -> Security -> Enable Studio Access to API Services = ON (for testing).

## DataStore contract (already implemented on the Roblox side)

- `BugReports_V1` : key = reportId (GUID), value = full report record. Bot sets `Posted`, `MessageId`, `Status`, `StatusNote`.
- `BugReportsIndex_V1` : key = `AllReports`, value = array of `{id, userId, title, time, status}`.
- `BugBans_V1` : key = userId (string), value = `{Active, Reason, Until, BannedBy, Time, UserId, Username}`. `Until = 0` means permanent.

Statuses: `Pending`, `Accepted`, `InProgress`, `Fixed`, `Rejected`.

## Notes

- Status changes appear in-game within ~10s (player's "My Reports" cache TTL).
- Bans apply on the banned player's next join, and within ~15s if they're already online (BanGuard poll).
- The bot edits the original Discord message to reflect the new status after each action.
