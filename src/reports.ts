import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { OperationError } from "./errors.js";
import { stateDirectory } from "./project.js";

// Caps from OpenSEO's src/types/schemas/reports.ts.
const maxTitleChars = 120;
const maxSummaryChars = 2_500;
const maxHtmlBytes = 500_000;
const previewChars = 240;

const invalid = (file: string, problem: string) => new OperationError("input", `${file} ${problem}`);

async function fileNames(directory: string) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The first line is a `# Title` heading; the lead text before the next heading is the summary. */
function parseMarkdown(file: string, text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() !== "");
  const title = lines[start]?.match(/^#\s+(.+)$/)?.[1]?.trim();
  if (!title) throw invalid(file, "must start with a '# Title' heading");
  if (title.length > maxTitleChars) throw invalid(file, `has a title longer than ${maxTitleChars} characters`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line));
  const summary = rest.slice(0, end < 0 ? undefined : end).join("\n").trim();
  if (!summary) throw invalid(file, "needs a summary between the title and the first section");
  if (summary.length > maxSummaryChars) throw invalid(file, `has a summary longer than ${maxSummaryChars} characters`);
  return { title, summary };
}

/** Reads every Markdown document in a directory, refusing two with the same title. */
async function readDocuments(directory: string, names: string[]) {
  const documents = await Promise.all(names.filter((name) => name.endsWith(".md")).map(async (name) => {
    const file = join(directory, name);
    const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { name, file, ...parseMarkdown(file, text), updatedAt: info.mtime.toISOString(), bytes: info.size };
  }));
  const seen = new Map<string, string>();
  for (const document of documents) {
    const other = seen.get(document.title.toLowerCase());
    if (other) throw invalid(document.file, `has the same title as ${other}; replace that report instead of adding a near-duplicate`);
    seen.set(document.title.toLowerCase(), document.file);
  }
  return documents;
}

async function checkHtml(file: string) {
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > maxHtmlBytes) throw invalid(file, `is larger than ${maxHtmlBytes} bytes`);
  if (!/<\/html>\s*$/i.test(text)) throw invalid(file, "is not a complete HTML document ending in </html>");
  return file;
}

const preview = (summary: string) => (summary.length > previewChars ? `${summary.slice(0, previewChars).trimEnd()}…` : summary);

// ponytail: lists every report with a short preview and no paging; add --limit/--offset when projects hold hundreds.
export async function listReports(root: string) {
  const reportsDirectory = join(stateDirectory(root), "reports");
  const reportNames = await fileNames(reportsDirectory);

  const orphan = reportNames.find((name) => name.endsWith(".html") && !reportNames.includes(name.replace(/\.html$/, ".md")));
  if (orphan) throw invalid(join(reportsDirectory, orphan), "has no Markdown report with the same name");

  const reports = await Promise.all((await readDocuments(reportsDirectory, reportNames)).map(async ({ name, file, title, summary, updatedAt, bytes }) => {
    const htmlName = name.replace(/\.md$/, ".html");
    const html = reportNames.includes(htmlName) ? await checkHtml(join(reportsDirectory, htmlName)) : null;
    return { file, html, title, summary: preview(summary), updatedAt, bytes };
  }));
  reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { reportsDirectory, reports };
}

/**
 * Report templates in OpenSEO's shape (name and description). Like upstream, they are
 * listed with the project context, the one block every skill reads first.
 */
export async function listTemplates(root: string) {
  const directory = join(stateDirectory(root), "templates");
  const templates = await readDocuments(directory, await fileNames(directory));
  return templates.map(({ file, title, summary }) => ({ name: title, description: preview(summary), file }));
}
