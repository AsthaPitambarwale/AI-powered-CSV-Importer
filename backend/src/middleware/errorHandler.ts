import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import multer from "multer";
import type { ApiErrorResponse } from "../types/index.js";

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Multer errors (file size, wrong type, etc.)
  if (err instanceof multer.MulterError) {
    const body: ApiErrorResponse = {
      error: "File upload error",
      details: multerMessage(err),
      code: err.code,
    };
    res.status(400).json(body);
    return;
  }

  // Known Error instances
  if (err instanceof Error) {
    const status = httpStatus(err.message);
    const body: ApiErrorResponse = {
      error: err.message,
      code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
    };
    res.status(status).json(body);
    return;
  }

  // Fallback
  res.status(500).json({
    error: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
  } satisfies ApiErrorResponse);
};

function multerMessage(err: multer.MulterError): string {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return "File is too large. Maximum allowed size exceeded.";
    case "LIMIT_UNEXPECTED_FILE":
      return "Unexpected field name. Use 'file' as the field name for CSV upload.";
    default:
      return err.message;
  }
}

function httpStatus(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("invalid api key") || lower.includes("authentication")) return 401;
  if (lower.includes("not found")) return 404;
  if (lower.includes("invalid file") || lower.includes("csv")) return 400;
  if (lower.includes("status: 429") || lower.includes("rate limit")) return 429;
  return 500;
}
