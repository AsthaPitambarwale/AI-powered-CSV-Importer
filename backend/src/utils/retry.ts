export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, baseDelayMs = 1000, maxDelayMs = 30000, onRetry } = options;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts) break;

      // Don't retry on client errors (4xx except 429)
      if (isNonRetryableError(lastError)) throw lastError;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.random() * 200;

      onRetry?.(attempt, lastError);
      await sleep(delay + jitter);
    }
  }

  throw lastError;
}

function isNonRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  // 400 bad request, 401 auth, 403 forbidden — don't retry
  return (
    msg.includes("status: 400") ||
    msg.includes("status: 401") ||
    msg.includes("status: 403") ||
    msg.includes("invalid api key") ||
    msg.includes("authentication")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
