import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "./run-cli.js";

async function withProject(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "agenticseo-"));
  try {
    const init = runCli(root, ["init", "--domain", "https://example.com/", "--location", "2840", "--language", "en"]);
    assert.equal(init.status, 0, init.stderr);
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("init rejects bad input and a second initialization with the input exit code", async () => {
  await withProject(async (root) => {
    const empty = join(root, "empty");
    await mkdir(empty);
    for (const args of [
      ["init", "--domain", "example.com/pricing", "--location", "2840", "--language", "en"],
      ["init", "--domain", "example.com", "--location", "US", "--language", "en"],
      ["init", "--domain", "example.com", "--location", "2840", "--language", "en", "--extra"],
      ["unknown-command"],
    ]) {
      const result = runCli(empty, args);
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    }
    await assert.rejects(access(join(empty, ".agenticseo")), "rejected input must not create project state");
    const again = runCli(root, ["init", "--domain", "example.com", "--location", "2840", "--language", "en"]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already has a project/);
  });
});

test("context reads an absent file as empty and validates hand edits", async () => {
  await withProject(async (root) => {
    const empty = runCli(root, ["context"]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(JSON.parse(empty.stdout).missingSections, ["businessOverview", "currentGoal", "positioning", "writingPreferences"]);

    const file = join(root, ".agenticseo", "context.json");
    await writeFile(file, JSON.stringify({
      currentGoal: "Rank top 10 for buying-intent audit terms by Q4.",
      competitors: [{ domain: "rival.com", notes: "owns comparison pages" }],
      keyPages: [{ url: "https://example.com/pricing", role: "money" }],
      customSections: { "launch-plan": { title: "Launch plan", content: "Ship docs first." } },
    }));
    const edited = runCli(root, ["context"]);
    assert.equal(edited.status, 0, edited.stderr);
    const output = JSON.parse(edited.stdout) as { file: string; context: { competitors: unknown[] }; missingSections: string[] };
    assert.equal(output.file, await realpath(file));
    assert.equal(output.context.competitors.length, 1);
    assert.deepEqual(output.missingSections, ["businessOverview", "positioning", "writingPreferences"]);

    for (const invalid of [
      "{ not json",
      JSON.stringify({ currentGoals: "typo" }),
      JSON.stringify({ competitors: [{ domain: "rival.com" }, { domain: "RIVAL.com" }] }),
      JSON.stringify({ keyPages: [{ url: "https://example.com/", role: "landing" }] }),
    ]) {
      await writeFile(file, invalid);
      const result = runCli(root, ["context"]);
      assert.equal(result.status, 2, `${invalid}: ${result.stderr}`);
      assert.match(result.stderr, /context\.json/);
    }
  });
});
