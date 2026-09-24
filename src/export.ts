import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { stateDirectory } from "./project.js";

export type CsvValue = string | number | boolean | null;

// OpenSEO's CSV rules (src/client/lib/csv.ts): every field quoted, numbers rounded to
// two decimals, and formula-injection prefixes neutralized.
function csvField(value: CsvValue) {
  const rounded = typeof value === "number" && Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : value;
  let text = rounded == null ? "" : String(rounded);
  if (typeof rounded === "string" && text.length > 0 && ["=", "+", "-", "@", "\t", "\r", "\n"].includes(text[0])) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(headers: string[], rows: CsvValue[][]) {
  return `${[headers, ...rows].map((row) => row.map(csvField).join(",")).join("\n")}\n`;
}

export const toJsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

/** Writes an export to --out, or to a timestamped file in .agenticseo/exports/. */
export async function writeExport(root: string, input: { name: string; format: string; content: string; out?: string }) {
  const file = input.out ? resolve(input.out) : join(stateDirectory(root), "exports", `${input.name}-${new Date().toISOString().replaceAll(":", "-")}.${input.format}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, input.content);
  return file;
}
