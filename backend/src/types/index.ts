// ─── Raw CSV ───────

export type RawRecord = Record<string, string>;

export type IndexedRecord = RawRecord & {
  _idx: number;
};

// ─── CRM Schema ──────

export interface CRMRecord {
  created_at: string;
  name: string;
  email: string;
  country_code: string;
  mobile_without_country_code: string;
  company: string;
  city: string;
  state: string;
  country: string;
  lead_owner: string;
  crm_status: CRMStatus | "";
  crm_note: string;
  data_source: DataSource | "";
  possession_time: string;
  description: string;
}

export type CRMStatus =
  | "GOOD_LEAD_FOLLOW_UP"
  | "DID_NOT_CONNECT"
  | "BAD_LEAD"
  | "SALE_DONE";

export type DataSource =
  | "leads_on_demand"
  | "meridian_tower"
  | "eden_park"
  | "varah_swamy"
  | "sarjapur_plots";

export const ALLOWED_CRM_STATUSES: CRMStatus[] = [
  "GOOD_LEAD_FOLLOW_UP",
  "DID_NOT_CONNECT",
  "BAD_LEAD",
  "SALE_DONE",
];

export const ALLOWED_DATA_SOURCES: DataSource[] = [
  "leads_on_demand",
  "meridian_tower",
  "eden_park",
  "varah_swamy",
  "sarjapur_plots",
];

// ─── Processing ───────────
export interface SkippedRecord {
  original_index: number;
  reason: string;
  raw_data: RawRecord;
}

export interface BatchResult {
  successful: CRMRecord[];
  skipped: SkippedRecord[];
}

export interface BatchInput {
  batchIndex: number;
  records: IndexedRecord[];
}

// ─── API Response ────────

export interface ImportResult {
  successful: CRMRecord[];
  skipped: SkippedRecord[];
  total_input: number;
  total_imported: number;
  total_skipped: number;
  processing_time_ms: number;
}

export interface ApiErrorResponse {
  error: string;
  details?: string;
  code?: string;
}

// ─── Config ───────

export interface AppConfig {
    port:number;
    openRouterApiKey:string;
    model:string;
    batchSize:number;
    maxRetries:number;
    maxConcurrent: number;
    maxFileSize:number;
    corsOrigin:string|string[];
}