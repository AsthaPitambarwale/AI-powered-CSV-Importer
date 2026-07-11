import type { RawRecord } from "../types/index.js";

export interface ParsedCSV {
  headers: string[];
  records: RawRecord[];
  rowCount: number;
}

export function parseCSV(text: string): ParsedCSV {
  const rawLines = splitIntoLines(text);
  if (rawLines.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const headers = parseRow(rawLines[0]).map((h) =>
    h.replace(/^["'\s]+|["'\s]+$/g, "").trim()
  );

  if (headers.length === 0 || headers.every((h) => h === "")) {
    throw new Error("CSV has no valid headers in the first row.");
  }

  const records: RawRecord[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    const values = parseRow(line);
    const record: RawRecord = {};
    headers.forEach((header, idx) => {
      record[header] = (values[idx] ?? "").trim();
    });

    // Skip rows that are entirely empty
    if (Object.values(record).every((v) => v === "")) continue;
    records.push(record);
  }

  return { headers, records, rowCount: records.length };
}

function splitIntoLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++; // CRLF
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) lines.push(current);
  return lines;
}

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }

  fields.push(field);
  return fields;
}

export function recordsToCSV(headers: string[], records: Record<string, string>[]): string {
  const escape = (val: string): string => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [
    headers.map(escape).join(","),
    ...records.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ];

  return rows.join("\n");
}
