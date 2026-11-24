# grafcast

Stream a Grafana playlist in kiosk mode into a Discord voice channel.

grafcast opens your Grafana playlist in headless Chrome, encodes the page
with FFmpeg and Go Lives with it in a voice channel. You control it with
slash commands.

> [!CAUTION]
> **Discord does not let bot accounts send video.** The only way to Go Live
> from code is through a regular **user account** (a "self-bot"). That breaks
> [Discord's Terms of Service](https://discord.com/terms), and Discord may ban
> the account. Use a dedicated throwaway account, never your personal one.
> You use this project at your own risk.

## How it works

```
 /grafcast start ──► Control bot (discord.js, bot token)
                            │
                            ▼
                     StreamSession
          ┌─────────────────┼──────────────────────────┐
          ▼                 ▼                          ▼
   Headless Chrome ──► MJPEG frames ──► FFmpeg (H.264) ──► Streamer account
   Grafana playlist                                        (user token, Go Live)
   ?kiosk
```

- **Control bot**: a normal Discord application. It registers `/grafcast` and
  handles permissions. It never touches voice.
- **Streamer account**: a user account that joins the voice channel and
  streams, using [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream).
- **Kiosk browser**: Puppeteer renders `/playlists/play/<uid>?kiosk` and
  captures frames through the Chrome DevTools screencast API.

## Requirements

- Node.js ≥ 22.18 (see `.nvmrc`) and pnpm
- FFmpeg on your `PATH`, ideally built with `libzmq`
  (macOS: `brew install ffmpeg`; Linux/Windows: [BtbN builds](https://github.com/BtbN/FFmpeg-Builds))
- A Grafana instance with a playlist
- A Discord bot application and a separate Discord user account for streaming

Or just use Docker, which bundles everything.

## Setup

1. **Create the control bot.** In the [Discord Developer Portal](https://discord.com/developers/applications),
   create an application, add a bot, and copy its token. Invite it to your
   server with the `bot` and `applications.commands` scopes.
2. **Prepare the streamer account.** Log in to a dedicated user account, join
   your server with it, and make sure it can connect to and stream in the
   target voice channels. Then get its token.
3. **Prepare Grafana.** Create a playlist and copy its UID from the URL
   (`/playlists/edit/<uid>`). Pick an auth mode:
   - `anonymous`: Grafana has anonymous access enabled
   - `token`: a [service account](https://grafana.com/docs/grafana/latest/administration/service-accounts/)
     token with the Viewer role (recommended). The token is only sent to
     the Grafana origin.
   - `login`: a local Grafana user (username and password)
4. **Configure.**

   ```sh
   cp .env.example .env
   # fill in the values
   ```

## Running

### Docker (recommended)

```sh
docker compose up -d --build
```

### Locally

```sh
pnpm install
pnpm dev          # watch mode
# or
pnpm build && pnpm start
```

## Usage

| Command                       | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| `/grafcast start [channel]`   | Start streaming into `channel`, or the voice channel you're in |
| `/grafcast stop`              | Stop the stream and leave the channel                         |
| `/grafcast status`            | Show where and since when it is streaming                     |

Set `DISCORD_ALLOWED_ROLE_IDS` to limit who can use the commands. You can
also restrict them under *Server Settings → Integrations*.

## Configuration

All settings are environment variables. See [`.env.example`](.env.example).

| Variable                   | Default     | Description                                       |
| -------------------------- | ----------- | ------------------------------------------------- |
| `DISCORD_BOT_TOKEN`        | –           | Control bot token                                 |
| `DISCORD_GUILD_ID`         | –           | Server to register slash commands in              |
| `DISCORD_ALLOWED_ROLE_IDS` | *(empty)*   | Comma-separated role IDs allowed to use commands  |
| `STREAMER_TOKEN`           | –           | User token of the streamer account                |
| `GRAFANA_URL`              | –           | Base URL of your Grafana instance                 |
| `GRAFANA_PLAYLIST_UID`     | –           | Playlist to play                                  |
| `GRAFANA_AUTH`             | `anonymous` | `anonymous`, `token` or `login`                   |
| `GRAFANA_TOKEN`            | –           | Service account token (`token` mode)              |
| `GRAFANA_USERNAME` / `GRAFANA_PASSWORD` | – | Credentials (`login` mode)                   |
| `GRAFANA_THEME`            | *(Grafana default)* | `dark` or `light`                         |
| `STREAM_WIDTH` / `STREAM_HEIGHT` | `1920` / `1080` | Browser viewport and output resolution    |
| `STREAM_FPS`               | `15`        | Output frame rate                                 |
| `STREAM_BITRATE_KBPS`      | `4000`      | Average video bitrate                             |
| `STREAM_CODEC`             | `H264`      | `H264` or `H265`                                  |
| `CHROME_EXECUTABLE_PATH`   | *(bundled)* | Use a system Chrome/Chromium                      |
| `LOG_LEVEL`                | `info`      | `debug`, `info`, `warn` or `error`                |

Dashboards are mostly static, so 10 to 15 FPS at 2 to 4 Mbps is usually plenty.

## Development

```sh
pnpm lint        # Biome lint + format check
pnpm format      # apply fixes
pnpm typecheck
```

## License

[MIT](LICENSE)
