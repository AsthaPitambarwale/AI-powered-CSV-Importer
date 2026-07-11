import OpenAI from "openai";
import type {
  RawRecord,
  CRMRecord,
  SkippedRecord,
  BatchResult,
  AppConfig,
  CRMStatus,
  DataSource,
  ALLOWED_CRM_STATUSES,
  ALLOWED_DATA_SOURCES,
} from "../types/index.js";
import {
  ALLOWED_CRM_STATUSES as STATUS_VALUES,
  ALLOWED_DATA_SOURCES as SOURCE_VALUES,
} from "../types/index.js";
import { withRetry } from "../utils/retry.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a GrowEasy CRM data extraction specialist with deep expertise in lead management and CRM systems.

Your task: parse CSV records from ANY source format and map them precisely to the GrowEasy CRM schema.

## Target Schema

| Field | Description |
|-------|-------------|
| created_at | Lead creation timestamp. Must be parseable by \`new Date()\`. |
| name | Full name of the lead person. |
| email | Primary email address only. |
| country_code | Country calling code, e.g. "+91", "+1", "+44". Include "+" prefix. |
| mobile_without_country_code | Digits only, no country code, no spaces, no dashes. |
| company | Organization / company name. |
| city | City name. |
| state | State or province name. |
| country | Full country name. |
| lead_owner | Email or name of the assigned sales rep / agent. |
| crm_status | MUST be exactly one of the allowed values (see below). |
| crm_note | Catch-all for notes, remarks, extra phones, extra emails, follow-up info. |
| data_source | MUST be exactly one of the allowed values, or empty string. |
| possession_time | Property handover / possession timeline. |
| description | General description or property/product details. |

## Allowed crm_status Values (use EXACTLY as written)
- GOOD_LEAD_FOLLOW_UP  → interested, warm, follow up, callback, hot
- DID_NOT_CONNECT      → no answer, busy, unreachable, switch off, did not connect
- BAD_LEAD             → not interested, invalid number, wrong number, junk
- SALE_DONE            → closed, converted, booked, deal done, onboarding

## Allowed data_source Values (use EXACTLY as written, or leave "")
- leads_on_demand
- meridian_tower
- eden_park
- varah_swamy
- sarjapur_plots

## Column Mapping Intelligence

Column names vary wildly across sources. Apply semantic inference:

| Your field | Accept columns like... |
|------------|------------------------|
| name | Full Name, Contact, Contact Name, Lead Name, Customer, Prospect, Client |
| email | Email, Email Address, E-mail, Mail, Email ID |
| country_code | Country Code, Dial Code, ISD Code, CC, Phone Code |
| mobile_without_country_code | Phone, Mobile, Cell, Tel, Telephone, Contact No, Ph, WhatsApp |
| company | Company, Organization, Org, Firm, Business, Employer, Account |
| city | City, Town, Location, Area |
| state | State, Province, Region |
| country | Country, Nation |
| lead_owner | Owner, Assigned To, Agent, Sales Rep, Handler, Responsible |
| crm_status | Status, Stage, Disposition, Lead Status, Lead Stage, Call Status |
| crm_note | Notes, Remarks, Comment, Feedback, Observation, Follow Up Notes |
| data_source | Source, Lead Source, Campaign, Channel, Medium, Platform, Ad Source |
| possession_time | Possession, Handover Date, Move In, Available From |
| description | Description, Details, Requirements, Property, Product, Notes (if no crm_note column) |
| created_at | Date, Created, Timestamp, Submission Date, Added On, Date Added |

## Critical Rules

1. **Skip invalid records**: If a record has NEITHER a valid email NOR a mobile number, add it to "skipped" with a reason.
2. **Multiple emails**: Use the first as \`email\`. Append additional emails to \`crm_note\` with label "Additional emails: ...".
3. **Multiple phones**: Use the first as \`mobile_without_country_code\`. Strip country code prefix. Append extras to \`crm_note\`.
4. **Country code extraction**: If the phone number contains a country code (e.g., "+91 9876543210"), split them. Put "+91" in country_code and "9876543210" in mobile_without_country_code.
5. **crm_status**: If no explicit status column, infer from any notes or remarks columns. Default to "GOOD_LEAD_FOLLOW_UP" for leads with contact info but no status signals.
6. **data_source**: Only use the allowed list. If the source column contains a project/property name that closely matches (e.g., "Eden Park Project" → "eden_park"), map it. Otherwise leave "".
7. **Dates**: Convert to ISO format "YYYY-MM-DD HH:MM:SS" or leave the original if it's already parseable by \`new Date()\`.
8. **Empty fields**: Use "" (empty string), never null or undefined.
9. **No hallucination**: Do not invent values. If a field is absent, leave it "".
10. **crm_note overflow**: Any meaningful information from columns that don't map to other CRM fields should be appended to crm_note.

## Output Format

Return ONLY a valid JSON object — no markdown, no code blocks, no explanation:

{
  "successful": [ /* CRMRecord objects */ ],
  "skipped": [ { "original_index": <number>, "reason": "<string>" } ]
}`;

// ─── AI Extractor Class ───────────────────────────────────────────────────────

export class AIExtractor {
  private client: OpenAI;
  private model: string;
  private maxRetries: number;

  constructor(config: AppConfig) {
    this.client = new OpenAI({
      apiKey: config.openRouterApiKey,

      baseURL: "https://openrouter.ai/api/v1",
    });
    this.model = config.model;
    this.maxRetries = config.maxRetries;
  }

  async extractBatch(
    records: Array<{ _idx: number } & RawRecord>,
  ): Promise<BatchResult> {
    const prompt = this.buildUserPrompt(records);

    const rawResponse = await withRetry(() => this.callAI(prompt), {
      maxAttempts: this.maxRetries,
      baseDelayMs: 1500,
      maxDelayMs: 20000,
      onRetry: (attempt, err) => {
        console.warn(
          `[AIExtractor] Retry ${attempt}/${this.maxRetries}: ${err.message}`,
        );
      },
    });

    return this.parseResponse(rawResponse, records);
  }

  private buildUserPrompt(
    records: Array<{ _idx: number } & RawRecord>,
  ): string {
    return `Extract GrowEasy CRM fields from these ${records.length} CSV records.

INPUT RECORDS:
${JSON.stringify(records, null, 2)}

REMINDER:
- _idx is a tracking field — DO NOT include it in output records
- Return valid JSON only: { "successful": [...], "skipped": [...] }
- Each successful record must include ALL 15 CRM fields (use "" for missing ones)
- Skip records without email AND without mobile number`;
  }

  private async callAI(userPrompt: string): Promise<string> {
    console.log("Using model:", this.model);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0,
      max_tokens: 2000
    });

    console.log(response);

    return response.choices[0].message.content || "";
  }

  private parseResponse(
    rawText: string,
    originalRecords: Array<{ _idx: number } & RawRecord>,
  ): BatchResult {
    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = rawText;
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1];

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(
        `Could not extract JSON from AI response. Raw: ${rawText.slice(0, 200)}`,
      );
    }

    let parsed: { successful?: unknown[]; skipped?: unknown[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error(
        `Invalid JSON in AI response: ${jsonMatch[0].slice(0, 200)}`,
      );
    }

    const successful = (parsed.successful ?? []).map((r) =>
      this.sanitizeCRMRecord(r as Record<string, unknown>),
    );

    const skipped = (parsed.skipped ?? []).map((s) => {
      const sk = s as Record<string, unknown>;
      const origIdx = Number(sk.original_index ?? -1);
      const origRecord = originalRecords.find((r) => r._idx === origIdx);
      return {
        original_index: origIdx,
        reason: String(sk.reason || "Skipped by AI"),
        raw_data: origRecord ? this.stripIdx(origRecord) : {},
      } satisfies SkippedRecord;
    });

    return { successful, skipped };
  }

  private sanitizeCRMRecord(raw: Record<string, unknown>): CRMRecord {
    const str = (v: unknown) => String(v ?? "").trim();

    const status = str(raw.crm_status);
    const crm_status = STATUS_VALUES.includes(status as CRMStatus)
      ? (status as CRMStatus)
      : "";

    const source = str(raw.data_source);
    const data_source = SOURCE_VALUES.includes(source as DataSource)
      ? (source as DataSource)
      : "";

    return {
      created_at: str(raw.created_at),
      name: str(raw.name),
      email: str(raw.email),
      country_code: str(raw.country_code),
      mobile_without_country_code: str(raw.mobile_without_country_code),
      company: str(raw.company),
      city: str(raw.city),
      state: str(raw.state),
      country: str(raw.country),
      lead_owner: str(raw.lead_owner),
      crm_status,
      crm_note: str(raw.crm_note),
      data_source,
      possession_time: str(raw.possession_time),
      description: str(raw.description),
    };
  }

  private stripIdx(record: Record<string, string | number>): RawRecord {
    const { _idx, ...rest } = record;
    return rest as RawRecord;
  }
}
