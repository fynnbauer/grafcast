import { Readable } from "node:stream";
import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer";
import type { GrafanaAuth } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("kiosk");

export interface KioskBrowserOptions {
  grafanaUrl: string;
  playlistUid: string;
  auth: GrafanaAuth;
  theme?: "dark" | "light";
  width: number;
  height: number;
  fps: number;
  executablePath?: string;
}

/**
 * Renders a Grafana playlist in kiosk mode inside headless Chrome and exposes
 * the page as a constant-frame-rate MJPEG stream.
 *
 * Chrome's screencast only emits frames when the page actually repaints, so the
 * latest frame is re-emitted on a fixed interval to give FFmpeg a steady input.
 */
export class KioskBrowser {
  private browser?: Browser;
  private page?: Page;
  private cdp?: CDPSession;
  private latestFrame?: Buffer;
  private ticker?: NodeJS.Timeout;
  private stream?: Readable;

  constructor(private readonly options: KioskBrowserOptions) {}

  get playlistUrl(): string {
    const { grafanaUrl, playlistUid, theme } = this.options;
    const url = new URL(`${grafanaUrl}/playlists/play/${encodeURIComponent(playlistUid)}`);
    url.searchParams.set("kiosk", "");
    if (theme) url.searchParams.set("theme", theme);
    return url.toString();
  }

  async start(): Promise<void> {
    const { width, height, executablePath } = this.options;

    this.browser = await puppeteer.launch({
      headless: true,
      executablePath,
      defaultViewport: { width, height },
      args: [
        `--window-size=${width},${height}`,
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--mute-audio",
      ],
    });

    this.page = await this.browser.newPage();
    this.page.on("pageerror", (error) => log.debug(`Page error: ${error}`));
    this.page.on("close", () => log.warn("Kiosk page closed"));

    await this.authenticate(this.page);

    log.info(`Opening ${this.playlistUrl}`);
    await this.page.goto(this.playlistUrl, { waitUntil: "networkidle2", timeout: 60_000 });

    if (new URL(this.page.url()).pathname.endsWith("/login")) {
      throw new Error("Grafana redirected to the login page, check GRAFANA_AUTH settings");
    }

    this.latestFrame = Buffer.from(await this.page.screenshot({ type: "jpeg", quality: 80 }));
    await this.startScreencast(this.page);
  }

  /** Returns a readable MJPEG stream emitting `fps` JPEG frames per second. */
  frames(): Readable {
    if (this.stream) return this.stream;

    const stream = new Readable({ read() {} });
    const interval = Math.round(1000 / this.options.fps);

    this.ticker = setInterval(() => {
      if (!this.latestFrame || stream.destroyed) return;
      // Drop frames instead of buffering when the encoder falls behind.
      if (stream.readableLength > this.latestFrame.length * 4) return;
      stream.push(this.latestFrame);
    }, interval);

    this.stream = stream;
    return stream;
  }

  async stop(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;

    this.stream?.push(null);
    this.stream = undefined;

    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    this.cdp = undefined;

    await this.browser?.close().catch(() => {});
    this.browser = undefined;
    this.page = undefined;
    this.latestFrame = undefined;
  }

  private async startScreencast(page: Page): Promise<void> {
    const { width, height } = this.options;
    this.cdp = await page.createCDPSession();

    this.cdp.on("Page.screencastFrame", (event) => {
      this.latestFrame = Buffer.from(event.data, "base64");
      this.cdp?.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    });

    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 80,
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: 1,
    });
  }

  private async authenticate(page: Page): Promise<void> {
    const { auth, grafanaUrl } = this.options;

    switch (auth.type) {
      case "anonymous":
        return;

      case "token": {
        // Only attach the token to requests that go to Grafana itself, never to
        // third-party origins a dashboard might load resources from.
        const origin = new URL(grafanaUrl).origin;
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          if (request.isInterceptResolutionHandled()) return;
          if (new URL(request.url()).origin !== origin) {
            void request.continue();
            return;
          }
          void request.continue({
            headers: { ...request.headers(), authorization: `Bearer ${auth.token}` },
          });
        });
        return;
      }

      case "login": {
        log.info("Logging in to Grafana");
        await page.goto(`${grafanaUrl}/login`, { waitUntil: "networkidle2", timeout: 60_000 });
        await page.type('input[name="user"]', auth.username);
        await page.type('input[name="password"]', auth.password);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }),
          page.click('button[type="submit"]'),
        ]);
        if (new URL(page.url()).pathname.endsWith("/login")) {
          throw new Error("Grafana login failed, check GRAFANA_USERNAME and GRAFANA_PASSWORD");
        }
        return;
      }
    }
  }
}
