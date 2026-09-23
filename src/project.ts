import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { OperationError } from "./errors.js";
import {
  competitorInputSchema,
  customSectionSlugSchema,
  keyPageInputSchema,
  MAX_COMPETITORS,
  MAX_CUSTOM_SECTIONS,
  MAX_KEY_PAGES,
  normalizeKeyPageUrl,
  PROJECT_CONTEXT_SECTION_KEYS,
  PROSE_MAX_CHARS,
  RESEARCH_LOG_LIMIT,
  RESEARCH_LOG_RETENTION_DAYS,
  researchLogSummarySchema,
} from "./openseo/projectContext.js";
import { isLanguageServedForLocation, isSupportedLanguageCode, isSupportedLocationCode } from "./openseo/keyword-locations.js";
import { parseResearchTarget } from "./openseo/researchScope.js";

// The market is checked on every read too, since people edit project.json by hand.
const projectSchema = z.strictObject({
  domain: z.string().min(1),
  locationCode: z.number().int().refine(isSupportedLocationCode, "Unsupported DataForSEO location code"),
  languageCode: z.string().refine(isSupportedLanguageCode, "Unsupported language code"),
}).refine((project) => isLanguageServedForLocation(project.locationCode, project.languageCode), {
  message: "This language is not available for this location",
  path: ["languageCode"],
});

export type Project = z.infer<typeof projectSchema>;

// OpenSEO's project context as a hand-editable file. Names, caps and
// normalization come from the ported upstream vocabulary; see src/openseo/.
const prose = z.string().trim().max(PROSE_MAX_CHARS).default("");

const competitorDomain = z.string().transform((value, issues) => {
  // Same canonicalization as the project's own domain, so a URL, www or caps is one competitor.
  const parsed = parseResearchTarget(value, "domain");
  if (parsed.ok) return parsed.target.hostname;
  issues.addIssue({ code: "custom", message: parsed.message });
  return z.NEVER;
});

const keyPageUrl = z.string().transform((value, issues) => {
  const url = normalizeKeyPageUrl(value);
  if (url) return url;
  issues.addIssue({ code: "custom", message: `Not a valid page URL: ${value}` });
  return z.NEVER;
});

const contextSchema = z.strictObject({
  sections: z.strictObject({
    business_overview: prose,
    current_goal: prose,
    positioning: prose,
    writing_preferences: prose,
  }).prefault({}),
  customSections: z.record(customSectionSlugSchema, z.strictObject({
    title: z.string().trim().min(1).max(120).optional(),
    content: prose,
  })).refine((sections) => Object.keys(sections).length <= MAX_CUSTOM_SECTIONS, `A project can hold ${MAX_CUSTOM_SECTIONS} custom sections`).prefault({}),
  competitors: z.array(competitorInputSchema.extend({ domain: competitorInputSchema.shape.domain.pipe(competitorDomain) }).strict())
    .max(MAX_COMPETITORS).default([]),
  keyPages: z.array(keyPageInputSchema.extend({ url: keyPageInputSchema.shape.url.pipe(keyPageUrl) }).strict())
    .max(MAX_KEY_PAGES, "This is a shortlist, not a page inventory").default([]),
  // OpenSEO's server stamps entry dates; here the agent writes them, so refuse the
  // one mistake that is detectable: a date after today (for example a model's guess).
  researchLog: z.array(z.strictObject({
    entryDate: z.iso.date().refine((date) => date <= localDate(), { error: () => `is after today (${localDate()}); use \`today\` from agenticseo context` }),
    summary: researchLogSummarySchema,
  })).default([]),
}).superRefine((context, issues) => {
  // Upstream upserts by normalized domain/url; a hand-edited file must not hold two entries for one.
  const domain = firstDuplicate(context.competitors.map((entry) => entry.domain));
  if (domain) issues.addIssue({ code: "custom", path: ["competitors"], message: `Duplicate competitor domain ${domain}` });
  const url = firstDuplicate(context.keyPages.map((entry) => entry.url));
  if (url) issues.addIssue({ code: "custom", path: ["keyPages"], message: `Duplicate key page ${url}` });
});

/** The user's local calendar date as YYYY-MM-DD; research-log dates follow their calendar. */
function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function firstDuplicate(values: string[]) {
  return values.find((value, index) => values.indexOf(value) !== index);
}

export const stateDirectory = (root: string) => join(root, ".agenticseo");
const projectFile = (root: string) => join(stateDirectory(root), "project.json");
const contextFile = (root: string) => join(stateDirectory(root), "context.json");

function validate<T extends z.ZodType>(schema: T, value: unknown, label: string): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new OperationError("input", `${label} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Reads a JSON state file; returns undefined only when the file does not exist. */
async function readState<T extends z.ZodType>(file: string, schema: T): Promise<z.output<T> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new OperationError("input", `${file} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  return validate(schema, json, file);
}

export async function findProjectRoot(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit);
  for (let current = process.cwd(); ; current = dirname(current)) {
    try {
      await access(projectFile(current));
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) {
      throw new OperationError("input", "No AgenticSEO project found; run 'agenticseo init' or pass --project");
    }
  }
}

export async function readProject(root: string): Promise<Project> {
  const project = await readState(projectFile(root), projectSchema);
  if (!project) throw new OperationError("input", `No AgenticSEO project at ${root}; run 'agenticseo init' there`);
  return project;
}

export async function initProject(root: string, input: { domain?: string; locationCode: number; languageCode: string }) {
  // OpenSEO canonicalizes a project domain to the bare host (www, scheme and path stripped).
  const target = parseResearchTarget(input.domain ?? "", "domain");
  if (!target.ok) throw new OperationError("input", `--domain: ${target.message}`);
  const project = validate(projectSchema, { ...input, domain: target.target.hostname }, "Project settings");
  await ensureIgnoredDirectory(root, "evidence");
  try {
    await writeFile(projectFile(root), `${JSON.stringify(project, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new OperationError("input", `${root} already has a project; edit ${projectFile(root)} to change it`);
    }
    throw error;
  }
  return { project: root, ...project };
}

/**
 * A missing context file is an empty context: every section is simply not written yet.
 * The research log shows OpenSEO's window: the newest entries from the last 90 days.
 */
export async function readContext(root: string) {
  const context = (await readState(contextFile(root), contextSchema)) ?? contextSchema.parse({});
  const since = localDate(-RESEARCH_LOG_RETENTION_DAYS);
  const researchLog = context.researchLog
    .filter((entry) => entry.entryDate >= since)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
    .slice(0, RESEARCH_LOG_LIMIT);
  return {
    file: contextFile(root),
    // Agents copy this into new research-log entries instead of guessing the date.
    today: localDate(),
    context: { ...context, researchLog },
    researchLogOmitted: context.researchLog.length - researchLog.length,
    missingSections: PROJECT_CONTEXT_SECTION_KEYS.filter((key) => context.sections[key] === ""),
  };
}

/** A directory of generated data under .agenticseo that Git ignores by default. */
async function ensureIgnoredDirectory(root: string, name: "evidence" | "cache" | "data") {
  const directory = join(stateDirectory(root), name);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, ".gitignore"), "*\n!.gitignore\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return directory;
}

/** Where the project database lives (saved keywords, metrics and later history). */
export function dataDirectory(root: string) {
  return ensureIgnoredDirectory(root, "data");
}

/** Where provider responses are cached, as OpenSEO caches them in R2. */
export function cacheDirectory(root: string) {
  return ensureIgnoredDirectory(root, "cache");
}

/** Writes one evidence record atomically and returns its path. */
export async function saveEvidence(root: string, fetchedAt: string, record: object) {
  const directory = await ensureIgnoredDirectory(root, "evidence");
  const file = join(directory, `${fetchedAt.replaceAll(":", "-")}-${randomUUID()}.json`);
  await writeFile(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  await rename(`${file}.tmp`, file);
  return file;
}
