const { join } = require("node:path");

/**
 * Keep the downloaded browser inside the project instead of ~/.cache, so it
 * lives next to the code and is easy to clean up.
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
