import { Encoders, playStream, prepareStream, Streamer } from "@dank074/discord-video-stream";
import { Client } from "@lng2004/discord.js-selfbot-v13";
import type { Config } from "../config.js";
import { KioskBrowser } from "../grafana/kiosk-browser.js";
import { createLogger } from "../logger.js";

const log = createLogger("stream");

export interface ActiveStream {
  guildId: string;
  channelId: string;
  startedAt: Date;
}

/**
 * Owns the streamer (user) account and the lifecycle of a single Go Live
 * session: join voice → render Grafana → encode → send → tear everything down.
 */
export class StreamSession {
  private readonly streamer: Streamer;
  private current?: {
    info: ActiveStream;
    browser: KioskBrowser;
    abort: AbortController;
    done: Promise<void>;
  };

  constructor(private readonly config: Config) {
    this.streamer = new Streamer(new Client());
  }

  get active(): ActiveStream | undefined {
    return this.current?.info;
  }

  get streamerUserId(): string | undefined {
    return this.streamer.client.user?.id;
  }

  async login(): Promise<void> {
    await this.streamer.client.login(this.config.streamer.token);
    log.info(`Streamer account logged in as ${this.streamer.client.user?.tag}`);
  }

  async start(guildId: string, channelId: string): Promise<void> {
    if (this.current) await this.stop();

    const { grafana, stream, chromeExecutablePath } = this.config;
    const browser = new KioskBrowser({
      grafanaUrl: grafana.url,
      playlistUid: grafana.playlistUid,
      auth: grafana.auth,
      theme: grafana.theme,
      width: stream.width,
      height: stream.height,
      fps: stream.fps,
      executablePath: chromeExecutablePath,
    });
    const abort = new AbortController();

    try {
      await browser.start();
      await this.streamer.joinVoice(guildId, channelId);
    } catch (error) {
      await browser.stop();
      this.streamer.leaveVoice();
      throw error;
    }

    const { command, output } = prepareStream(
      browser.frames(),
      {
        encoder: Encoders.software({ x264: { preset: "veryfast", tune: "stillimage" } }),
        width: stream.width,
        height: stream.height,
        frameRate: stream.fps,
        bitrateVideo: stream.bitrateKbps,
        bitrateVideoMax: Math.round(stream.bitrateKbps * 1.5),
        videoCodec: stream.codec,
        includeAudio: false,
        customInputOptions: ["-f", "image2pipe", "-framerate", String(stream.fps), "-c:v", "mjpeg"],
      },
      abort.signal,
    );

    command.on("error", (error: Error) => {
      if (!abort.signal.aborted) log.error(`FFmpeg failed: ${error.message}`);
    });

    const done = playStream(output, this.streamer, { type: "go-live" }, abort.signal)
      .catch((error: unknown) => {
        if (!abort.signal.aborted) log.error("Stream stopped unexpectedly", error);
      })
      .finally(() => {
        if (this.current?.abort === abort) void this.stop();
      });

    this.current = {
      info: { guildId, channelId, startedAt: new Date() },
      browser,
      abort,
      done,
    };
    log.info(`Streaming playlist ${grafana.playlistUid} to channel ${channelId}`);
  }

  async stop(): Promise<void> {
    const current = this.current;
    if (!current) return;
    this.current = undefined;

    log.info(`Stopping stream in channel ${current.info.channelId}`);
    current.abort.abort();
    await current.browser.stop();
    this.streamer.stopStream();
    this.streamer.leaveVoice();
    await current.done;
  }

  async destroy(): Promise<void> {
    await this.stop();
    await this.streamer.client.destroy();
  }
}
