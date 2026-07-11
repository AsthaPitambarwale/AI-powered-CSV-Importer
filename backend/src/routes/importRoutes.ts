import { Router, type Request, type Response, type NextFunction } from "express";
import type { AppConfig } from "../types/index.js";
import { parseCSV, recordsToCSV } from "../utils/csvParser.js";
import { BatchProcessor } from "../services/batchProcessor.js";
import { createUploadMiddleware } from "../middleware/upload.js";
import { CRM_FIELDS } from "../constants.js";

export function createImportRouter(config: AppConfig): Router {
  const router = Router();
  const upload = createUploadMiddleware(config);
  const processor = new BatchProcessor(config);

  /**
   * POST /api/import
   *
   * Accepts a CSV file upload, runs AI extraction batch-by-batch,
   * and returns structured CRM records.
   *
   * Content-Type: multipart/form-data
   * Field: file (CSV)
   */
  router.post(
    "/",
    upload.single("file"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "No file uploaded. Send a CSV as multipart field 'file'." });
          return;
        }

        const csvText = req.file.buffer.toString("utf-8");

        // --- Parse CSV ---
        const { headers, records, rowCount } = parseCSV(csvText);

        if (records.length === 0) {
          res.status(422).json({
            error: "CSV has no data rows.",
            details: `File '${req.file.originalname}' contained headers [${headers.join(", ")}] but no records.`,
          });
          return;
        }

        console.log(
          `[Import] File: ${req.file.originalname} | Headers: ${headers.length} | Rows: ${rowCount}`
        );

        // --- AI Extraction ---
        const result = await processor.process(records, (progress) => {
          console.log(
            `[Import] Batch ${progress.batchIndex}/${progress.totalBatches} done ` +
            `| ${progress.processedRecords}/${progress.totalRecords} records ` +
            `| ✓ ${progress.successSoFar} skipped ${progress.skippedSoFar}`
          );
        });

        console.log(
          `[Import] Done in ${result.processing_time_ms}ms ` +
          `| imported ${result.total_imported} | skipped ${result.total_skipped}`
        );

        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/import/preview
   *
   * Accepts a CSV file, parses it (NO AI), and returns raw headers + records.
   * Used by the frontend for the Preview step.
   */
  router.post(
    "/preview",
    upload.single("file"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "No file uploaded." });
          return;
        }

        const csvText = req.file.buffer.toString("utf-8");
        const { headers, records, rowCount } = parseCSV(csvText);

        res.json({
          headers,
          records: records.slice(0, 100), // Cap preview at 100 rows
          total_rows: rowCount,
          filename: req.file.originalname,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/import/download
   *
   * Accepts an ImportResult body and returns a CSV file download.
   */
  router.post("/download", (req: Request, res: Response) => {
    const { successful = [] } = req.body as { successful: Record<string, string>[] };

    if (!Array.isArray(successful)) {
      res.status(400).json({ error: "Expected { successful: CRMRecord[] }" });
      return;
    }

    const csv = recordsToCSV(CRM_FIELDS, successful);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="groweasy_crm_${Date.now()}.csv"`
    );
    res.send(csv);
  });

  return router;
}
