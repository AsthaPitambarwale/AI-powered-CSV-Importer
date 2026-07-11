import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import type { AppConfig } from "./types/index.js";
import { createImportRouter } from "./routes/importRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp(config: AppConfig): express.Application {
  const app = express();

  // ── Security & CORS ────
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // ── Logging ───────
  app.use(morgan("dev"));

  // ── Body Parsing ────────
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  // ── Routes ────────────

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "groweasy-csv-importer",
      timestamp: new Date().toISOString(),
      model: config.model,
    });
  });

  app.use("/api/import", createImportRouter(config));

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  // ── Error Handler (must be last) ────────────
  app.use(errorHandler);

  return app;
}
