import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";
import type { AppConfig } from "../types/index.js";

export function createUploadMiddleware(config: AppConfig) {
  const storage = multer.memoryStorage();

  const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
  ) => {
    const allowedMimeTypes = [
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];

    const isCSVByMime = allowedMimeTypes.includes(file.mimetype);
    const isCSVByName = file.originalname.toLowerCase().endsWith(".csv");

    if (isCSVByMime || isCSVByName) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Expected a CSV file, got: ${file.mimetype}`));
    }
  };

  return multer({
    storage,
    limits: { fileSize: config.maxFileSize },
    fileFilter,
  });
}
