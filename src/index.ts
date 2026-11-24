import { loadConfig } from "./config.js";
import { ControlBot } from "./discord/bot.js";
import { StreamSession } from "./discord/stream-session.js";
import { createLogger, setLogLevel } from "./logger.js";

const log = createLogger("main");

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const session = new StreamSession(config);
  const bot = new ControlBot(config, session);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    await Promise.allSettled([session.destroy(), bot.destroy()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await session.login();
  await bot.start();
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
