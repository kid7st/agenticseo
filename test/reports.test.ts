import assert from "node:assert/strict";
import { mkdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runCli, withProject } from "./helpers.js";

type Listing = {
  reports: Array<{ file: string; html: string | null; title: string; summary: string }>;
  templates: Array<{ file: string; title: string; summary: string }>;
};

const report = (title: string, summary: string) => `# ${title}\n\n${summary}\n\n## Findings\n\nDetails.\n`;

test("reports lists saved reports newest first with previews, HTML exports and templates", async () => {
  await withProject(async (root) => {
    const empty = runCli(root, ["reports"]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual((JSON.parse(empty.stdout) as Listing).reports, []);

    const reports = join(root, ".agenticseo", "reports");
    const templates = join(root, ".agenticseo", "templates");
    await mkdir(reports, { recursive: true });
    await mkdir(templates);
    await writeFile(join(reports, "audit.md"), report("Site Audit — Sep 1, 2026", "Verdict: fix canonicals first."));
    await writeFile(join(reports, "keywords.md"), report("Keyword Snapshot — Sep 23, 2026", "x".repeat(300)));
    await writeFile(join(reports, "keywords.html"), "<!doctype html><html><body>Report</body></html>\n");
    await writeFile(join(templates, "monthly.md"), "# Monthly client report\n\nOne verdict, three numbers, one action.\n");
    await utimes(join(reports, "audit.md"), new Date("2026-09-01"), new Date("2026-09-01"));

    const listed = runCli(root, ["reports"]);
    assert.equal(listed.status, 0, listed.stderr);
    const output = JSON.parse(listed.stdout) as Listing;
    assert.deepEqual(output.reports.map((entry) => entry.title), ["Keyword Snapshot — Sep 23, 2026", "Site Audit — Sep 1, 2026"]);
    assert.match(output.reports[0].html ?? "", /keywords\.html$/);
    assert.equal(output.reports[1].html, null);
    assert.equal(output.reports[0].summary.length, 241, "long summaries are cut to a preview");
    assert.equal(output.reports[1].summary, "Verdict: fix canonicals first.");
    assert.deepEqual(output.templates, [{ file: await realpath(join(templates, "monthly.md")), title: "Monthly client report", summary: "One verdict, three numbers, one action." }]);
  });
});

test("reports refuses malformed, duplicate and orphaned documents with the input exit code", async () => {
  await withProject(async (root) => {
    const reports = join(root, ".agenticseo", "reports");
    await mkdir(reports, { recursive: true });
    const cases: Array<[string, Record<string, string>, RegExp]> = [
      ["no title", { "a.md": "Just text\n" }, /must start with a '# Title'/],
      ["no summary", { "a.md": "# Title\n\n## Section\n" }, /needs a summary/],
      ["duplicate title", { "a.md": report("Audit", "One."), "b.md": report("audit", "Two.") }, /same title/],
      ["orphan html", { "a.md": report("Audit", "One."), "b.html": "<html></html>" }, /no Markdown report/],
      ["incomplete html", { "a.md": report("Audit", "One."), "a.html": "<html><body>" }, /ending in <\/html>/],
    ];
    for (const [name, files, message] of cases) {
      await rm(reports, { recursive: true, force: true });
      await mkdir(reports);
      for (const [file, text] of Object.entries(files)) await writeFile(join(reports, file), text);
      const result = runCli(root, ["reports"]);
      assert.equal(result.status, 2, `${name}: ${result.stderr}`);
      assert.match(result.stderr, message, name);
    }
  });
});
