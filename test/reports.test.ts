import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runCli, withProject } from "./helpers.js";

type Listing = {
  reports: Array<{ file: string; html: string | null; title: string; summary: string }>;
};

const report = (title: string, summary: string) => `# ${title}\n\n${summary}\n\n## Findings\n\nDetails.\n`;

test("reports lists saved reports newest first with previews and HTML exports", async () => {
  await withProject(async (root) => {
    const empty = runCli(root, ["reports"]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual((JSON.parse(empty.stdout) as Listing).reports, []);

    const reports = join(root, ".agenticseo", "reports");
    await mkdir(reports, { recursive: true });
    await writeFile(join(reports, "audit.md"), report("Site Audit — Sep 1, 2026", "Verdict: fix canonicals first."));
    await writeFile(join(reports, "keywords.md"), report("Keyword Snapshot — Sep 23, 2026", "x".repeat(300)));
    // Links to other sites are fine; only loading resources from them is refused.
    await writeFile(join(reports, "keywords.html"), '<!doctype html><html><body><a href="https://kua.ai/" target="_blank">Report</a><svg viewBox="0 0 1 1"></svg><a href="#how">x</a></body></html>\n');
    await utimes(join(reports, "audit.md"), new Date("2026-09-01"), new Date("2026-09-01"));

    const listed = runCli(root, ["reports"]);
    assert.equal(listed.status, 0, listed.stderr);
    const output = JSON.parse(listed.stdout) as Listing;
    assert.deepEqual(output.reports.map((entry) => entry.title), ["Keyword Snapshot — Sep 23, 2026", "Site Audit — Sep 1, 2026"]);
    assert.match(output.reports[0].html ?? "", /keywords\.html$/);
    assert.equal(output.reports[1].html, null);
    assert.equal(output.reports[0].summary.length, 241, "long summaries are cut to a preview");
    assert.equal(output.reports[1].summary, "Verdict: fix canonicals first.");
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
      ["script", { "a.md": report("Audit", "One."), "a.html": "<html><script>alert(1)</script></html>" }, /contains a <script>/],
      ["web font", { "a.md": report("Audit", "One."), "a.html": '<html><link rel="stylesheet" href="https://fonts.googleapis.com/css"></html>' }, /stylesheet or font from another site/],
      ["css import", { "a.md": report("Audit", "One."), "a.html": "<html><style>@import 'x.css';</style></html>" }, /@import/],
      ["remote image", { "a.md": report("Audit", "One."), "a.html": '<html><img src="//cdn.example.com/a.png"></html>' }, /image or media file from another site/],
      ["css url", { "a.md": report("Audit", "One."), "a.html": "<html><style>b{background:url(https://x.com/a.png)}</style></html>" }, /CSS resource from another site/],
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
