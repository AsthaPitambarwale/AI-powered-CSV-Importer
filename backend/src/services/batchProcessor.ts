import type {
  RawRecord,
  IndexedRecord,
  CRMRecord,
  SkippedRecord,
  ImportResult,
  AppConfig,
} from "../types/index.js";
import { AIExtractor } from "./aiExtractor.js";

export interface BatchProgressEvent {
  batchIndex: number;
  totalBatches: number;
  processedRecords: number;
  totalRecords: number;
  successSoFar: number;
  skippedSoFar: number;
}

export type ProgressCallback = (event: BatchProgressEvent) => void;

export class BatchProcessor {
  private extractor: AIExtractor;
  private batchSize: number;
  private maxConcurrent: number;

  constructor(config: AppConfig) {
    this.extractor = new AIExtractor(config);
    this.batchSize = config.batchSize;
    this.maxConcurrent = config.maxConcurrent;
  }

  async process(
    records: RawRecord[],
    onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    const startTime = Date.now();

    const batches = this.chunk(records);
    const totalBatches = batches.length;

    let allSuccessful: CRMRecord[] = [];
    let allSkipped: SkippedRecord[] = [];
    let completed = 0;

    for (let start = 0; start < totalBatches; start += this.maxConcurrent) {
      const current = batches.slice(start, start + this.maxConcurrent);

      const results = await Promise.all(
        current.map(async (batch, index) => {
          const batchIndex = start + index;

          const indexedBatch: IndexedRecord[] = batch.map((rec, j) => ({
            ...rec,
            _idx: batchIndex * this.batchSize + j,
          }));

          try {
            const result = await this.extractor.extractBatch(indexedBatch);

            return {
              batchIndex,
              success: result.successful,
              skipped: result.skipped,
              count: batch.length,
            };
          } catch (err) {
            const reason = err instanceof Error ? err.message : "Batch failed";

            console.error(`[Batch ${batchIndex + 1}] Failed:`, reason);

            const skipped: SkippedRecord[] = indexedBatch.map((rec) => {
              const { _idx, ...raw } = rec;

              return {
                original_index: _idx,
                reason,
                raw_data: raw as RawRecord,
              };
            });

            return {
              batchIndex,
              success: [],
              skipped,
              count: batch.length,
            };
          }
        }),
      );

      results.forEach((result) => {
        allSuccessful.push(...result.success);
        allSkipped.push(...result.skipped);

        completed += result.count;

        onProgress?.({
          batchIndex: result.batchIndex + 1,
          totalBatches,
          processedRecords: completed,
          totalRecords: records.length,
          successSoFar: allSuccessful.length,
          skippedSoFar: allSkipped.length,
        });
      });
    }

    return {
      successful: allSuccessful,
      skipped: allSkipped,
      total_input: records.length,
      total_imported: allSuccessful.length,
      total_skipped: allSkipped.length,
      processing_time_ms: Date.now() - startTime,
    };
  }

  private chunk(records: RawRecord[]): RawRecord[][] {
    const chunks: RawRecord[][] = [];

    for (let i = 0; i < records.length; i += this.batchSize) {
      chunks.push(records.slice(i, i + this.batchSize));
    }

    return chunks;
  }
}
