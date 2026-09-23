import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { OperationError } from "./errors.js";

const projectSchema = z.strictObject({
  domain: z.string().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().regex(/^[a-z]{2}$/),
});

export type Project = z.infer<typeof projectSchema>;

// Mirrors OpenSEO's project context: four prose sections, custom sections and
// curated competitor/key-page shortlists, with the same length and size caps.
const prose = z.string().max(4000).default("");
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase slug like 'launch-plan'").max(60);

const contextSchema = z.strictObject({
  businessOverview: prose,
  currentGoal: prose,
  positioning: prose,
  writingPreferences: prose,
  customSections: z.record(slug, z.strictObject({ title: z.string().trim().min(1).max(120), content: prose })).default({}),
  competitors: z.array(z.strictObject({
    domain: z.string().trim().min(1).max(255),
    name: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
  })).max(100).default([]),
  keyPages: z.array(z.strictObject({
    url: z.url({ protocol: /^https?$/ }).max(2048),
    role: z.enum(["hub", "spoke", "money", "other"]).optional(),
    topic: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
  })).max(100).default([]),
}).superRefine((context, issues) => {
  // Upstream upserts by domain/url; a hand-edited file must not hold two entries for one.
  const domain = firstDuplicate(context.competitors.map((entry) => entry.domain.toLowerCase()));
  if (domain) issues.addIssue({ code: "custom", path: ["competitors"], message: `Duplicate competitor domain ${domain}` });
  const url = firstDuplicate(context.keyPages.map((entry) => entry.url));
  if (url) issues.addIssue({ code: "custom", path: ["keyPages"], message: `Duplicate key page ${url}` });
});

function firstDuplicate(values: string[]) {
  return values.find((value, index) => values.indexOf(value) !== index);
}

const sectionFields = ["businessOverview", "currentGoal", "positioning", "writingPreferences"] as const;

const stateDirectory = (root: string) => join(root, ".agenticseo");
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

export async function initProject(root: string, input: { domain?: string; locationCode: number; languageCode?: string }) {
  const url = input.domain ? URL.parse(input.domain.includes("://") ? input.domain : `https://${input.domain}`) : null;
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new OperationError("input", "--domain must be a hostname, not a URL path or credential");
  }
  const project = validate(projectSchema, { ...input, domain: url.hostname }, "Project settings");
  await ensureEvidenceDirectory(root);
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

/** A missing context file is an empty context: every section is simply not written yet. */
export async function readContext(root: string) {
  const context = (await readState(contextFile(root), contextSchema)) ?? contextSchema.parse({});
  return {
    file: contextFile(root),
    context,
    missingSections: sectionFields.filter((field) => context[field].trim() === ""),
  };
}

async function ensureEvidenceDirectory(root: string) {
  const directory = join(stateDirectory(root), "evidence");
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, ".gitignore"), "*\n!.gitignore\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return directory;
}

/** Writes one evidence record atomically and returns its path. */
export async function saveEvidence(root: string, fetchedAt: string, record: object) {
  const directory = await ensureEvidenceDirectory(root);
  const file = join(directory, `${fetchedAt.replaceAll(":", "-")}-${randomUUID()}.json`);
  await writeFile(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  await rename(`${file}.tmp`, file);
  return file;
}
