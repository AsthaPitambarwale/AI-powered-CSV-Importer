import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error("[Startup] Configuration error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const app = createApp(config);

  const server = app.listen(config.port, () => {
    console.log(`\n🚀 GrowEasy CSV Importer API`);
    console.log(`   Port    : ${config.port}`);
    console.log(`   Model   : ${config.model}`);
    console.log(`   Batch   : ${config.batchSize} records/batch`);
    console.log(`   Retries : ${config.maxRetries}\n`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
    server.close(() => {
      console.log("[Server] HTTP server closed.");
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      console.error("[Server] Forced exit after timeout.");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    console.error("[Server] Unhandled rejection:", reason);
  });
}

main();
