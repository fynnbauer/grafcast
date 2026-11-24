import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
    DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required"),
    DISCORD_ALLOWED_ROLE_IDS: csv,

    STREAMER_TOKEN: z.string().min(1, "STREAMER_TOKEN is required"),

    GRAFANA_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
    GRAFANA_PLAYLIST_UID: z.string().min(1, "GRAFANA_PLAYLIST_UID is required"),
    GRAFANA_AUTH: z.enum(["anonymous", "token", "login"]).default("anonymous"),
    GRAFANA_TOKEN: optionalString,
    GRAFANA_USERNAME: optionalString,
    GRAFANA_PASSWORD: optionalString,
    GRAFANA_THEME: z.enum(["dark", "light"]).optional(),

    STREAM_WIDTH: z.coerce.number().int().positive().default(1920),
    STREAM_HEIGHT: z.coerce.number().int().positive().default(1080),
    STREAM_FPS: z.coerce.number().int().min(1).max(60).default(15),
    STREAM_BITRATE_KBPS: z.coerce.number().int().positive().default(4000),
    STREAM_CODEC: z.enum(["H264", "H265"]).default("H264"),

    CHROME_EXECUTABLE_PATH: optionalString,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.GRAFANA_AUTH === "token" && !env.GRAFANA_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["GRAFANA_TOKEN"],
        message: "GRAFANA_TOKEN is required when GRAFANA_AUTH=token",
      });
    }
    if (env.GRAFANA_AUTH === "login" && (!env.GRAFANA_USERNAME || !env.GRAFANA_PASSWORD)) {
      ctx.addIssue({
        code: "custom",
        path: ["GRAFANA_USERNAME"],
        message: "GRAFANA_USERNAME and GRAFANA_PASSWORD are required when GRAFANA_AUTH=login",
      });
    }
  });

export type Env = z.infer<typeof schema>;

export type GrafanaAuth =
  | { type: "anonymous" }
  | { type: "token"; token: string }
  | { type: "login"; username: string; password: string };

export interface Config {
  discord: {
    botToken: string;
    guildId: string;
    allowedRoleIds: string[];
  };
  streamer: {
    token: string;
  };
  grafana: {
    url: string;
    playlistUid: string;
    auth: GrafanaAuth;
    theme?: "dark" | "light";
  };
  stream: {
    width: number;
    height: number;
    fps: number;
    bitrateKbps: number;
    codec: "H264" | "H265";
  };
  chromeExecutablePath?: string;
  logLevel: Env["LOG_LEVEL"];
}

function toGrafanaAuth(env: Env): GrafanaAuth {
  switch (env.GRAFANA_AUTH) {
    case "token":
      return { type: "token", token: env.GRAFANA_TOKEN as string };
    case "login":
      return {
        type: "login",
        username: env.GRAFANA_USERNAME as string,
        password: env.GRAFANA_PASSWORD as string,
      };
    default:
      return { type: "anonymous" };
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const env = result.data;
  return {
    discord: {
      botToken: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      allowedRoleIds: env.DISCORD_ALLOWED_ROLE_IDS,
    },
    streamer: {
      token: env.STREAMER_TOKEN,
    },
    grafana: {
      url: env.GRAFANA_URL,
      playlistUid: env.GRAFANA_PLAYLIST_UID,
      auth: toGrafanaAuth(env),
      theme: env.GRAFANA_THEME,
    },
    stream: {
      width: env.STREAM_WIDTH,
      height: env.STREAM_HEIGHT,
      fps: env.STREAM_FPS,
      bitrateKbps: env.STREAM_BITRATE_KBPS,
      codec: env.STREAM_CODEC,
    },
    chromeExecutablePath: env.CHROME_EXECUTABLE_PATH,
    logLevel: env.LOG_LEVEL,
  };
}
