import type { AppConfig } from "../types/index.js";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT || "3001", 10),

    openRouterApiKey: requireEnv("OPENROUTER_API_KEY"),

    model: process.env.AI_MODEL || "openai/gpt-oss-20b:free",

    batchSize: parseInt(process.env.BATCH_SIZE || "10", 10),

    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || "3", 10),

    maxRetries: parseInt(process.env.MAX_RETRIES || "1", 10),

    maxFileSize:
      parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10) * 1024 * 1024,

    corsOrigin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : ["http://localhost:5173"],
  };
}
