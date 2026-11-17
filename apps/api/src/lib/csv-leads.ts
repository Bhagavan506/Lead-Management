import { parse } from "csv-parse/sync";
import { normalizePhone } from "./phone.js";

export const MAX_UPLOAD_ROWS = 5000;

export interface ParsedLead {
  row: number; // line number in the file; the header is row 1
  name: string;
  company: string;
  phone: string; // E.164
  source: string;
}
export interface RowIssue {
  row: number;
  name: string;
  phone: string;
  reason: string;
}
export interface ParsedCsv {
  valid: ParsedLead[];
  invalid: RowIssue[];
  /** Same phone (after normalizing) as an earlier row of the same file. */
  duplicatesInFile: RowIssue[];
}

/** Thrown for problems with the file as a whole (not a single row). Rendered as a 422. */
export class CsvFileError extends Error {}

const COLUMNS = ["name", "company", "phone", "source"] as const;

/**
 * Parses an uploaded lead list. Columns: name, phone (required), company, source (optional), in any
 * order and case; extra columns are ignored. Accepts , ; or tab as separator, quoted fields, CRLF
 * and a UTF-8 BOM. Phones are normalized to E.164 using `defaultCountry`.
 */
export function parseLeadCsv(text: string, defaultCountry: string): ParsedCsv {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      delimiter: [",", ";", "\t"],
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch (e) {
    throw new CsvFileError(`Could not read the file as CSV: ${(e as Error).message}`);
  }
  if (records.length === 0) throw new CsvFileError("The file is empty");

  const header = (records[0] as string[]).map((h) => h.toLowerCase());
  const col = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof COLUMNS)[number],
    number
  >;
  const missing = (["name", "phone"] as const).filter((c) => col[c] === -1);
  if (missing.length > 0)
    throw new CsvFileError(`The header row must include: ${missing.join(", ")}`);

  const data = records.slice(1);
  if (data.length === 0) throw new CsvFileError("The file has a header but no leads");
  if (data.length > MAX_UPLOAD_ROWS)
    throw new CsvFileError(
      `Too many rows (${data.length}). Upload at most ${MAX_UPLOAD_ROWS} at a time.`,
    );

  const out: ParsedCsv = { valid: [], invalid: [], duplicatesInFile: [] };
  const firstSeen = new Map<string, number>();

  data.forEach((cells, i) => {
    const row = i + 2;
    const get = (c: (typeof COLUMNS)[number]) =>
      col[c] === -1 ? "" : (cells[col[c]] ?? "").trim();
    const name = get("name");
    const rawPhone = get("phone");
    const issue = (reason: string) => out.invalid.push({ row, name, phone: rawPhone, reason });

    if (!name) return issue("Name is missing");
    if (name.length > 200) return issue("Name is longer than 200 characters");
    if (!rawPhone) return issue("Phone is missing");
    const phone = normalizePhone(rawPhone, defaultCountry);
    if (!phone) return issue("Phone number is not valid");
    const company = get("company");
    const source = get("source") || "Other";
    if (company.length > 200) return issue("Company is longer than 200 characters");
    if (source.length > 100) return issue("Source is longer than 100 characters");

    const first = firstSeen.get(phone);
    if (first !== undefined) {
      out.duplicatesInFile.push({
        row,
        name,
        phone,
        reason: `Same phone number as row ${first} in this file`,
      });
      return;
    }
    firstSeen.set(phone, row);
    out.valid.push({ row, name, company, phone, source });
  });
  return out;
}
