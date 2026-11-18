import { parse } from "csv-parse/sync";
import { normalizePhone } from "./phone.js";

export const MAX_UPLOAD_ROWS = 5000;

export interface ParsedLead {
  row: number; // line number in the file; the header is row 1
  name: string; // may be empty: only the phone is mandatory
  company: string;
  phone: string; // E.164
  source: string;
  community: string;
  flatNumber: string;
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

const COLUMNS = ["name", "company", "phone", "source", "community", "flatNumber"] as const;
type Column = (typeof COLUMNS)[number];

/** Header spellings accepted for each column (compared after lower-casing and dropping spaces, _ - and .). */
const ALIASES: Record<Column, string[]> = {
  name: ["name", "customername", "fullname"],
  company: ["company"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "contact", "contactnumber"],
  source: ["source"],
  community: ["community", "society", "project", "apartment"],
  flatNumber: ["flatnumber", "flatno", "flat", "unit", "unitnumber", "houseno"],
};
const squash = (h: string) => h.toLowerCase().replace(/[\s_\-.]/g, "");

/**
 * Parses an uploaded lead list. Only the phone is required; name, community, flat number, company
 * and source are optional. Columns may be in any order and case; extra columns are ignored.
 * Accepts , ; or tab as separator, quoted fields, CRLF and a UTF-8 BOM. Phones are normalized to
 * E.164 using `defaultCountry`.
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

  const header = (records[0] as string[]).map(squash);
  const col = Object.fromEntries(
    COLUMNS.map((c) => [c, header.findIndex((h) => ALIASES[c].includes(h))]),
  ) as Record<Column, number>;
  if (col.phone === -1)
    throw new CsvFileError("The header row must include a phone (or mobile) column");

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
    const get = (c: Column) => (col[c] === -1 ? "" : (cells[col[c]] ?? "").trim());
    const name = get("name");
    const rawPhone = get("phone");
    const issue = (reason: string) => out.invalid.push({ row, name, phone: rawPhone, reason });

    if (!rawPhone) return issue("Phone is missing");
    const phone = normalizePhone(rawPhone, defaultCountry);
    if (!phone) return issue("Phone number is not valid");
    const company = get("company");
    const source = get("source") || "Other";
    const community = get("community");
    const flatNumber = get("flatNumber");
    if (name.length > 200) return issue("Name is longer than 200 characters");
    if (company.length > 200) return issue("Company is longer than 200 characters");
    if (source.length > 100) return issue("Source is longer than 100 characters");
    if (community.length > 200) return issue("Community is longer than 200 characters");
    if (flatNumber.length > 50) return issue("Flat number is longer than 50 characters");

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
    out.valid.push({ row, name, company, phone, source, community, flatNumber });
  });
  return out;
}
