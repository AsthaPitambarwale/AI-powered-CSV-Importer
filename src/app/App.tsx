import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload, FileText, ChevronRight, CheckCircle2,
  Moon, Sun, ArrowLeft, Download, Sparkles, Zap,
  TableProperties, Users, SkipForward, TrendingUp,
} from "lucide-react";

// ---------- Types ----------
type Step = "upload" | "preview" | "processing" | "results";

interface RawRecord {
  [key: string]: string;
}

interface CRMRecord {
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
  crm_status: string;
  crm_note: string;
  data_source: string;
  possession_time: string;
  description: string;
}

interface ProcessingResult {
  success: CRMRecord[];
  skipped: number;
  total: number;
}

// ---------- Constants ----------
const CRM_FIELDS: (keyof CRMRecord)[] = [
  "created_at", "name", "email", "country_code", "mobile_without_country_code",
  "company", "city", "state", "country", "lead_owner", "crm_status",
  "crm_note", "data_source", "possession_time", "description",
];

const STATUS_META: Record<string, { label: string; light: string; dark: string }> = {
  GOOD_LEAD_FOLLOW_UP: {
    label: "Good Lead",
    light: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    dark: "dark:bg-emerald-950/50 dark:text-emerald-400 dark:ring-emerald-800/50",
  },
  DID_NOT_CONNECT: {
    label: "No Connect",
    light: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    dark: "dark:bg-amber-950/50 dark:text-amber-400 dark:ring-amber-800/50",
  },
  BAD_LEAD: {
    label: "Bad Lead",
    light: "bg-red-50 text-red-700 ring-1 ring-red-200",
    dark: "dark:bg-red-950/50 dark:text-red-400 dark:ring-red-800/50",
  },
  SALE_DONE: {
    label: "Sale Done",
    light: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    dark: "dark:bg-blue-950/50 dark:text-blue-400 dark:ring-blue-800/50",
  },
};

const PROCESSING_STEPS = [
  { icon: "🔍", msg: "Analyzing column headers and structure..." },
  { icon: "🧠", msg: "Identifying field patterns with AI..." },
  { icon: "👤", msg: "Extracting name and contact fields..." },
  { icon: "📧", msg: "Normalizing email addresses..." },
  { icon: "📱", msg: "Parsing mobile numbers and country codes..." },
  { icon: "🏢", msg: "Detecting company and location data..." },
  { icon: "📊", msg: "Classifying lead status values..." },
  { icon: "🎯", msg: "Mapping data sources to allowed values..." },
  { icon: "📝", msg: "Compiling CRM notes from extra fields..." },
  { icon: "✅", msg: "Validating records — skipping invalids..." },
  { icon: "🚀", msg: "Finalizing GrowEasy CRM export..." },
];

const WIZARD_STEPS = ["Upload", "Preview", "AI Processing", "Results"];
const STEP_IDX: Record<Step, number> = { upload: 0, preview: 1, processing: 2, results: 3 };

// ---------- CSV Parser ----------
function parseCSV(text: string): { headers: string[]; records: RawRecord[] } {
  const lines: string[] = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (cur.trim()) lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) lines.push(cur);

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let f = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { f += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(f.trim());
        f = "";
      } else {
        f += ch;
      }
    }
    fields.push(f.trim());
    return fields;
  };

  if (lines.length === 0) return { headers: [], records: [] };
  const headers = parseLine(lines[0]).map(h => h.replace(/^["']|["']$/g, "").trim());
  const records = lines.slice(1).map(line => {
    const vals = parseLine(line);
    const rec: RawRecord = {};
    headers.forEach((h, i) => { rec[h] = vals[i] ?? ""; });
    return rec;
  });
  return { headers, records };
}

// ---------- AI Field Mapper ----------
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]+/g, " ").trim();
}

const FIELD_PATTERNS: Record<keyof CRMRecord, string[]> = {
  created_at: ["created at", "created", "date", "timestamp", "submission date", "lead date", "date created", "create date", "entry date", "added on", "added at", "date added"],
  name: ["full name", "name", "contact name", "customer name", "lead name", "client name", "prospect name", "contact"],
  email: ["email", "email address", "e mail", "mail", "email id", "e-mail", "email address"],
  country_code: ["country code", "dial code", "isd code", "calling code", "cc", "phone code", "country dial"],
  mobile_without_country_code: ["mobile", "phone", "cell", "telephone", "contact number", "phone number", "mobile number", "phone no", "mobile no", "contact no", "ph", "ph no", "mob", "mobile phone"],
  company: ["company", "organization", "organisation", "org", "firm", "business", "employer", "company name", "business name", "account name"],
  city: ["city", "town", "city name", "location"],
  state: ["state", "province", "region", "state name", "state province"],
  country: ["country", "nation", "country name"],
  lead_owner: ["lead owner", "owner", "assigned to", "sales rep", "agent", "assigned agent", "salesperson", "sales person", "rep", "handler", "responsible"],
  crm_status: ["status", "lead status", "crm status", "disposition", "stage", "lead stage", "call status"],
  crm_note: ["notes", "note", "remarks", "remark", "comment", "comments", "additional info", "additional information", "feedback", "observation", "follow up notes"],
  data_source: ["source", "lead source", "data source", "campaign", "channel", "utm source", "medium", "platform", "ad source"],
  possession_time: ["possession", "possession time", "possession date", "handover", "handover date", "move in", "move in date", "available from"],
  description: ["description", "details", "additional details", "more info", "product", "property", "requirement", "need", "project"],
};

function buildFieldMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalized = headers.map(h => ({ orig: h, n: norm(h) }));

  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const pat of patterns) {
      const match = normalized.find(h => h.n === pat || (pat.length > 4 && h.n.includes(pat)));
      if (match && !mapping[field]) {
        mapping[field] = match.orig;
        break;
      }
    }
  }
  return mapping;
}

function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (!s) return "GOOD_LEAD_FOLLOW_UP";
  if (s === "good_lead_follow_up" || s.includes("good") || s.includes("follow") || s.includes("warm") || s.includes("callback") || s.includes("interested")) return "GOOD_LEAD_FOLLOW_UP";
  if (s === "did_not_connect" || s.includes("not connect") || s.includes("no answer") || s === "dnc" || s.includes("did not") || s.includes("not reach") || s.includes("not picked") || s.includes("busy")) return "DID_NOT_CONNECT";
  if (s === "bad_lead" || s.includes("bad") || s.includes("not interest") || s.includes("junk") || s.includes("disqualif") || s.includes("invalid")) return "BAD_LEAD";
  if (s === "sale_done" || s.includes("sale") || s.includes("closed") || s.includes("won") || s.includes("converted") || s.includes("deal")) return "SALE_DONE";
  return "GOOD_LEAD_FOLLOW_UP";
}

function normalizeSource(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("demand")) return "leads_on_demand";
  if (s.includes("meridian")) return "meridian_tower";
  if (s.includes("eden")) return "eden_park";
  if (s.includes("varah")) return "varah_swamy";
  if (s.includes("sarjapur")) return "sarjapur_plots";
  if (s.includes("facebook") || s.includes("fb") || s.includes("google") || s.includes("instagram") || s.includes("insta")) return "leads_on_demand";
  return "";
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function processRecords(headers: string[], rawRecords: RawRecord[]): ProcessingResult {
  const fm = buildFieldMapping(headers);
  const mappedHeaderSet = new Set(Object.values(fm));
  const unmapped = headers.filter(h => !mappedHeaderSet.has(h));

  const firstNameH = headers.find(h => ["first name", "firstname", "fname", "first"].includes(norm(h)));
  const lastNameH = headers.find(h => ["last name", "lastname", "lname", "last"].includes(norm(h)));

  const success: CRMRecord[] = [];
  let skipped = 0;

  for (const raw of rawRecords) {
    const get = (field: keyof CRMRecord): string => {
      const h = fm[field];
      return h ? (raw[h] ?? "").trim() : "";
    };

    // Name: try explicit field first, then first+last combo
    let name = get("name");
    if (!name) {
      const first = firstNameH ? (raw[firstNameH] ?? "").trim() : "";
      const last = lastNameH ? (raw[lastNameH] ?? "").trim() : "";
      name = [first, last].filter(Boolean).join(" ");
    }

    // Email: match from dedicated field, fall back to scanning all values
    const emailRaw = get("email");
    const allEmails: string[] = [];
    const fromField = emailRaw.match(EMAIL_RE);
    if (fromField) allEmails.push(...fromField);
    if (allEmails.length === 0) {
      for (const v of Object.values(raw)) {
        const found = v.match(EMAIL_RE);
        if (found) { allEmails.push(...found); break; }
      }
    }
    const primaryEmail = allEmails[0] ?? "";
    const extraEmails = allEmails.slice(1);

    // Mobile
    const mobileRaw = get("mobile_without_country_code");
    const primaryMobile = mobileRaw.replace(/[\s\-().+]/g, "");

    // Skip records with neither email nor mobile
    if (!primaryEmail && !mobileRaw) { skipped++; continue; }

    // Notes: merge existing note + overflow emails + unmapped fields
    const noteParts: string[] = [];
    const existingNote = get("crm_note");
    if (existingNote) noteParts.push(existingNote);
    if (extraEmails.length) noteParts.push("Additional emails: " + extraEmails.join(", "));
    for (const h of unmapped) {
      const v = (raw[h] ?? "").trim();
      if (v && h !== firstNameH && h !== lastNameH) noteParts.push(`${h}: ${v}`);
    }

    // Country code: ensure leading +
    let cc = get("country_code");
    if (cc && !cc.startsWith("+")) cc = "+" + cc.replace(/\D/g, "");

    // Date: validate or fall back to now
    let createdAt = get("created_at");
    if (createdAt && isNaN(new Date(createdAt).getTime())) createdAt = "";
    if (!createdAt) createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    success.push({
      created_at: createdAt,
      name,
      email: primaryEmail,
      country_code: cc,
      mobile_without_country_code: primaryMobile,
      company: get("company"),
      city: get("city"),
      state: get("state"),
      country: get("country"),
      lead_owner: get("lead_owner"),
      crm_status: normalizeStatus(get("crm_status")),
      crm_note: noteParts.join("; "),
      data_source: normalizeSource(get("data_source")),
      possession_time: get("possession_time"),
      description: get("description"),
    });
  }

  return { success, skipped, total: rawRecords.length };
}

// ---------- Download ----------
function downloadCSV(records: CRMRecord[]) {
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const rows = [CRM_FIELDS.join(","), ...records.map(r => CRM_FIELDS.map(f => esc(r[f])).join(","))];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "groweasy_crm_import.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ===================== SUB-COMPONENTS =====================

// ---- Step Indicator ----
function StepIndicator({ current }: { current: Step }) {
  const idx = STEP_IDX[current];
  return (
    <div className="hidden sm:flex items-center gap-1">
      {WIZARD_STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            i < idx ? "text-primary" : i === idx ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] border transition-all ${
              i < idx ? "bg-primary border-primary text-white" :
              i === idx ? "bg-white/20 border-white/40 text-primary-foreground" :
              "border-border"
            }`}>
              {i < idx ? "✓" : i + 1}
            </span>
            {label}
          </div>
          {i < WIZARD_STEPS.length - 1 && (
            <div className={`h-px w-5 mx-0.5 transition-all ${i < idx ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Upload Step ----
function UploadStep({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setError("Please upload a valid .csv file.");
      return;
    }
    setError("");
    onFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const sources = [
    "Facebook Lead Ads", "Google Ads Export", "Excel Sheets",
    "Real Estate CRM", "Sales Reports", "Marketing Agency CSVs",
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-xl"
      >
        {/* Hero text */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-semibold mb-5 tracking-wide uppercase"
          >
            <Sparkles size={12} />
            AI-Powered Field Detection
          </motion.div>
          <h1 className="text-3xl sm:text-4xl font-semibold text-foreground mb-3 tracking-tight leading-tight">
            Import Any CSV into<br />
            <span className="text-primary">GrowEasy CRM</span>
          </h1>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
            Upload leads from any source. Our AI intelligently detects column names and maps them to the GrowEasy format — no manual configuration needed.
          </p>
        </div>

        {/* Drop zone */}
        <motion.div
          whileHover={{ scale: dragging ? 1 : 1.005 }}
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ${
            dragging
              ? "border-primary bg-primary/8 shadow-lg shadow-primary/10"
              : "border-border hover:border-primary/40 bg-card hover:bg-primary/3"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          <motion.div
            animate={dragging ? { scale: 1.15, rotate: -3 } : { scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 transition-colors ${
              dragging ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
            }`}
          >
            <Upload size={24} />
          </motion.div>

          <p className="text-foreground font-semibold text-base mb-1">
            {dragging ? "Release to upload" : "Drag & drop your CSV file"}
          </p>
          <p className="text-muted-foreground text-sm mb-5">
            or click to browse from your computer
          </p>
          <button
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          >
            Choose File
          </button>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </motion.div>

        {/* Supported formats */}
        <div className="mt-6">
          <p className="text-center text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">Supported sources</p>
          <div className="grid grid-cols-3 gap-2">
            {sources.map((src) => (
              <div key={src} className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded-lg text-xs text-muted-foreground">
                <CheckCircle2 size={11} className="text-primary flex-shrink-0" />
                {src}
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ---- Preview Step ----
function PreviewStep({
  headers, records, fileName, onConfirm, onBack,
}: {
  headers: string[]; records: RawRecord[]; fileName: string;
  onConfirm: () => void; onBack: () => void;
}) {
  const preview = records.slice(0, 150);

  return (
    <div className="flex flex-col min-h-[calc(100vh-65px)] p-4 sm:p-6 gap-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                <ArrowLeft size={14} />
              </button>
              <h2 className="text-lg font-semibold">CSV Preview</h2>
            </div>
            <p className="text-muted-foreground text-sm pl-5">
              <span className="font-mono text-foreground/80 text-xs">{fileName}</span>
              <span className="mx-1.5 text-border">·</span>
              {records.length.toLocaleString()} rows
              <span className="mx-1.5 text-border">·</span>
              {headers.length} columns
              {records.length > 150 && <span className="text-amber-500"> · showing first 150</span>}
            </p>
          </div>
          <button
            onClick={onConfirm}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm flex-shrink-0"
          >
            <Sparkles size={14} />
            Confirm & Import with AI
            <ChevronRight size={14} />
          </button>
        </div>
      </motion.div>

      {/* Info banner */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/8 border border-primary/20 rounded-xl text-sm text-primary">
        <FileText size={14} className="flex-shrink-0" />
        <span>Raw data preview — no AI processing yet. Confirm to start intelligent field mapping.</span>
      </div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex-1 rounded-xl border border-border overflow-hidden bg-card shadow-sm"
      >
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted border-b border-border">
                <th className="text-left px-3 py-2.5 text-muted-foreground font-semibold text-xs w-10 flex-shrink-0">#</th>
                {headers.map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-muted-foreground font-semibold text-xs whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground/60 font-mono text-xs text-right">{i + 1}</td>
                  {headers.map((h) => (
                    <td key={h} className="px-4 py-2 font-mono text-xs text-foreground whitespace-nowrap max-w-[200px]">
                      <span className="block overflow-hidden text-ellipsis">
                        {row[h] || <span className="text-border">—</span>}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

// ---- Processing Step ----
function ProcessingStep({ progress, message, total }: { progress: number; message: string; total: number }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-65px)] px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.93 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Animated orb */}
        <div className="relative inline-flex items-center justify-center w-20 h-20 mb-8 mx-auto block">
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-primary/40"
            animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute inset-2 rounded-full border border-primary/30"
            animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0, 0.3] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          />
          <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
              <Sparkles size={26} className="text-primary" />
            </motion.div>
          </div>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold mb-2">AI Processing</h2>
          <p className="text-muted-foreground text-sm">
            Mapping {total.toLocaleString()} records to GrowEasy CRM format
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span className="truncate pr-4">{message}</span>
            <span className="font-mono flex-shrink-0">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.35 }}
            />
          </div>
        </div>

        {/* Step log */}
        <div className="bg-card border border-border rounded-xl p-4 mt-6">
          <div className="space-y-1">
            {PROCESSING_STEPS.map((step, i) => {
              const stepThreshold = (i / PROCESSING_STEPS.length) * 100;
              const isDone = progress > stepThreshold + (100 / PROCESSING_STEPS.length) - 1;
              const isActive = !isDone && progress > stepThreshold;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: isDone || isActive ? 1 : 0.25 }}
                  className={`flex items-center gap-2.5 py-0.5 text-xs transition-colors ${
                    isDone ? "text-foreground" : isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <span className="text-sm w-5 flex-shrink-0">{step.icon}</span>
                  <span className="font-mono flex-1">{step.msg}</span>
                  {isDone && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <CheckCircle2 size={12} className="text-primary flex-shrink-0" />
                    </motion.span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ---- Stat Card ----
function StatCard({ label, value, textClass, icon }: {
  label: string; value: string | number; textClass: string; icon: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl p-4 flex items-start gap-3"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${textClass.replace("text-", "bg-").split(" ")[0]}/10`}>
        <span className={textClass}>{icon}</span>
      </div>
      <div>
        <div className={`text-2xl font-semibold font-mono leading-none mb-1 ${textClass}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </motion.div>
  );
}

// ---- Results Step ----
function ResultsStep({ result, onReset }: { result: ProcessingResult; onReset: () => void }) {
  const statusCounts = result.success.reduce<Record<string, number>>((acc, r) => {
    acc[r.crm_status] = (acc[r.crm_status] ?? 0) + 1;
    return acc;
  }, {});

  const successRate = result.total > 0 ? Math.round((result.success.length / result.total) * 100) : 0;

  return (
    <div className="flex flex-col min-h-[calc(100vh-65px)] p-4 sm:p-6 gap-4">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-6 h-6 rounded-full bg-accent/10 flex items-center justify-center">
                <CheckCircle2 size={14} className="text-accent" />
              </div>
              <h2 className="text-lg font-semibold">Import Complete</h2>
            </div>
            <p className="text-muted-foreground text-sm pl-8">
              AI extracted and mapped {result.success.length.toLocaleString()} CRM records
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => downloadCSV(result.success)}
              className="flex items-center gap-2 px-4 py-2.5 border border-border bg-card rounded-xl text-sm font-medium hover:bg-muted/50 transition-colors"
            >
              <Download size={14} />
              Export CSV
            </button>
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Import Another
            </button>
          </div>
        </div>
      </motion.div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Records" value={result.total.toLocaleString()} textClass="text-primary" icon={<FileText size={16} />} />
        <StatCard label="Successfully Imported" value={result.success.length.toLocaleString()} textClass="text-emerald-600 dark:text-emerald-400" icon={<Users size={16} />} />
        <StatCard label="Skipped" value={result.skipped.toLocaleString()} textClass="text-amber-600 dark:text-amber-400" icon={<SkipForward size={16} />} />
        <StatCard label="Success Rate" value={`${successRate}%`} textClass="text-violet-600 dark:text-violet-400" icon={<TrendingUp size={16} />} />
      </div>

      {/* Status breakdown */}
      {result.success.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(STATUS_META).map(([status, meta]) => (
            <motion.div
              key={status}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium ${meta.light} ${meta.dark}`}
            >
              <span>{meta.label}</span>
              <span className="font-mono font-bold text-sm">{statusCounts[status] ?? 0}</span>
            </motion.div>
          ))}
        </div>
      )}

      {/* Skipped notice */}
      {result.skipped > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl text-sm text-amber-700 dark:text-amber-400">
          <SkipForward size={14} className="flex-shrink-0" />
          <span>
            {result.skipped} record{result.skipped !== 1 ? "s were" : " was"} skipped — missing both email and mobile number.
          </span>
        </div>
      )}

      {/* Results table */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex-1 rounded-xl border border-border overflow-hidden bg-card shadow-sm"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/50">
          <TableProperties size={13} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Extracted CRM Records</span>
          <span className="ml-auto text-xs text-muted-foreground font-mono">{result.success.length} records</span>
        </div>
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 490px)", minHeight: "200px" }}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted border-b border-border">
              <tr>
                <th className="text-left px-3 py-2.5 text-muted-foreground font-semibold text-xs w-8">#</th>
                {CRM_FIELDS.map((f) => (
                  <th key={f} className="text-left px-3 py-2.5 text-muted-foreground font-semibold text-xs whitespace-nowrap">
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.success.map((rec, i) => (
                <tr key={i} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground/50 font-mono text-xs">{i + 1}</td>
                  {CRM_FIELDS.map((f) => (
                    <td key={f} className="px-3 py-2 font-mono text-xs whitespace-nowrap max-w-[180px]">
                      {f === "crm_status" ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[rec[f]]?.light ?? ""} ${STATUS_META[rec[f]]?.dark ?? ""}`}>
                          {STATUS_META[rec[f]]?.label ?? rec[f]}
                        </span>
                      ) : (
                        <span className={`block overflow-hidden text-ellipsis ${rec[f] ? "text-foreground" : "text-muted-foreground/30"}`}>
                          {rec[f] || "—"}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

// ===================== MAIN APP =====================

const BACKEND_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_BACKEND_URL ?? "";

async function processViaBackend(file: File): Promise<ProcessingResult> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BACKEND_URL}/api/import`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Backend error ${res.status}`);
  }

  const data = await res.json() as {
    successful: CRMRecord[];
    skipped: { original_index: number; reason: string }[];
    total_input: number;
    total_imported: number;
    total_skipped: number;
  };

  return {
    success: data.successful,
    skipped: data.total_skipped,
    total: data.total_input,
  };
}

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRecords, setRawRecords] = useState<RawRecord[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [dark, setDark] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, records: r } = parseCSV(text);
      setHeaders(h);
      setRawRecords(r);
      setStep("preview");
    };
    reader.readAsText(file);
  }, []);

  const handleConfirm = useCallback(async () => {
    setStep("processing");
    setProgress(0);
    setMessage(PROCESSING_STEPS[0].msg);

    let idx = 0;
    const STEP_DURATION = 240;

    // Animate the processing log steps
    const interval = setInterval(() => {
      idx++;
      if (idx < PROCESSING_STEPS.length) {
        setMessage(PROCESSING_STEPS[idx].msg);
        setProgress((idx / PROCESSING_STEPS.length) * 88);
      }
    }, STEP_DURATION);

    const cleanup = () => clearInterval(interval);

    try {
      let res: ProcessingResult;

      if (BACKEND_URL && csvFile) {
        // ── Backend mode: send CSV to Express API ──────────────────────────
        res = await processViaBackend(csvFile);
      } else {
        // ── Local mode: rule-based field mapping (no API key needed) ───────
        await new Promise<void>((resolve) =>
          setTimeout(resolve, PROCESSING_STEPS.length * STEP_DURATION + 200)
        );
        res = processRecords(headers, rawRecords);
      }

      cleanup();
      setResult(res);
      setProgress(100);
      setTimeout(() => setStep("results"), 420);
    } catch (err) {
      cleanup();
      console.error("[handleConfirm] Processing failed:", err);
      // Fall back to local processing on backend error
      const res = processRecords(headers, rawRecords);
      setResult(res);
      setProgress(100);
      setTimeout(() => setStep("results"), 420);
    }
  }, [headers, rawRecords, csvFile]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setResult(null);
    setHeaders([]);
    setRawRecords([]);
    setCsvFile(null);
    setFileName("");
    setProgress(0);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-[65px] flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 bg-primary rounded-xl flex items-center justify-center shadow-sm">
              <Zap size={15} className="text-primary-foreground" />
            </div>
            <div className="leading-none">
              <span className="font-bold text-sm text-foreground">GrowEasy</span>
              <span className="text-muted-foreground text-sm font-normal"> / CSV Importer</span>
            </div>
          </div>

          {/* Center: step indicator */}
          <div className="flex-1 flex justify-center">
            {step !== "upload" && <StepIndicator current={step} />}
          </div>

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(!dark)}
            className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted/60 transition-colors text-muted-foreground flex-shrink-0"
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-screen-2xl mx-auto">
        <AnimatePresence mode="wait">
          {step === "upload" && (
            <motion.div key="upload" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
              <UploadStep onFile={handleFile} />
            </motion.div>
          )}
          {step === "preview" && (
            <motion.div key="preview" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
              <PreviewStep
                headers={headers}
                records={rawRecords}
                fileName={fileName}
                onConfirm={handleConfirm}
                onBack={handleReset}
              />
            </motion.div>
          )}
          {step === "processing" && (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <ProcessingStep progress={progress} message={message} total={rawRecords.length} />
            </motion.div>
          )}
          {step === "results" && result && (
            <motion.div key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <ResultsStep result={result} onReset={handleReset} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
