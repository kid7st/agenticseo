---
name: seo-report
description: Save a finished SEO finding as a project report the user and other agents can find later, with an optional self-contained HTML export. Use after an audit, keyword, competitor or other SEO task produced a result worth keeping, or when the user asks for a report.
---

# SEO report

A report is a Markdown file in the project. The CLI only indexes and validates reports; you write, replace and delete them with your file tools.

1. Run `agenticseo reports`. It returns `reportsDirectory` and existing reports, newest first with a summary preview. If a report covers the same job, replace that file instead of adding a near-duplicate; a second report with the same title is refused. `agenticseo context` lists `reportTemplates`; if one fits the task, read its file and follow it.
2. Write `REPORTS_DIRECTORY/<short-slug>.md`:
   - First line: `# <report type or subject> — <full date>`, for example `# Keyword Snapshot — Sep 23, 2026`. Omit the project's own domain. At most 120 characters.
   - Then the summary, before any other heading: the verdict, the single top action and the key numbers, under 2,500 characters. `agenticseo reports` shows this part to later readers, so it must stand alone.
   - Then `##` sections with the evidence: market, lookup dates, sources, and paths to evidence files. Keep unknown values unknown.
3. Only when the user wants a shareable or printable document, also write `<short-slug>.html` next to it: one complete, self-contained HTML document ending in `</html>`, with CSS inline and no external scripts, fonts or images, under 500 KB. It is an export of the same report, so keep the title and verdict identical.
4. Run `agenticseo reports` again. Exit code 2 names the file and the problem; fix it and rerun.
5. The skill that produced the finding appends its own research-log line. Add one only if it did not: `{ "entryDate": "<today from agenticseo context>", "summary": "Report: <title>. Verdict: <conclusion>" }` in `researchLog` of the context file.
6. Reply with the report path, a one-line verdict and the single top action. Do not paste the report into the chat.

To remove a report, delete its `.md` file and any `.html` export with the same name. Templates are Markdown files in `.agenticseo/templates/` with the same shape: a `# Title` (the template name) and a short description of what the report must contain.
