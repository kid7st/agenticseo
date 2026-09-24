---
name: seo-report
description: Write and save an SEO report in the project as Markdown plus one self-contained HTML page. Use when a skill has finished its research, and whenever the user asks for a report, check-in or summary, or names a report template.
---

<!-- Adapted from OpenSEO plugins/openseo/skills/seo-report/SKILL.md (https://github.com/every-app/open-seo, MIT, Copyright (c) 2026 Ben Senescu) for the AgenticSEO CLI. -->

# SEO report

## Goal

Turn finished research into a report saved in the project, so anyone on the team, and any later agent, can open it, read it on a phone and print it to PDF.

Every AgenticSEO skill that produces a recommendation delivers through this skill. Chat gets the path, the verdict and the leading recommendation with its expected benefit, if there is one. The report gets everything else.

A report is two files with the same name in the project's reports directory:

- `<slug>.md`: the title, the summary and the full report in Markdown. It is what `agenticseo reports` indexes and what agents read.
- `<slug>.html`: the same report as one self-contained page built from [template.html](template.html). It is what people open.

## Before you write

1. Run `agenticseo reports`. It returns `reportsDirectory` and each report's title and summary preview, newest first. If a report already covers the same subject for the same period, you are correcting your own run: overwrite both of its files. A new month, a new competitor or a different skill is a new report. Never save a near-duplicate.
2. Titles are unique within a project; `agenticseo reports` refuses a second report with the same title. Either replace the existing files or change the title to name the new subject or period.
3. To revise an existing report, work from its Markdown file. Open the HTML only to edit a specific passage.

## Following a template

A project can carry report templates: named, reusable briefs saying who a report is for, which sections it has in what order, how it should sound and how to sign off. `agenticseo context` lists them under `reportTemplates` with the file holding each one's full instructions. Templates are Markdown files in `.agenticseo/templates/`, shaped like reports: a `# Name` and a description.

Use a template only when the user names it, or asks for the kind of report a template's name or description names. A plain skill run ("audit this site") uses the skill's default format. If two match, ask in one line. A template's sections, audience and tone replace the skill's Output format list; the HTML constraints and writing rules never change. The project's `writing_preferences` always apply; a template's tone wins only where they conflict.

## Writing rules

When the producing skill specifies a recommendation format, use that format instead of the generic Problem / Change / Expected effect structure below. For example, an SEO audit can use short Do this / Why bullet lists. Keep the same requirements for concrete actions, supporting evidence, business benefit and honest uncertainty. The template's finding markup is an example, not an override of that skill's format.

- **Write notes, not essays.** The reader scans. A recommendation is a heading and three short bullets: Problem (what is true, with evidence), Change (the step and how it addresses the problem) and Expected effect (what could improve, why the business cares, and the likely scale and uncertainty). For descriptive findings, use the relevant subset; do not invent a fix. No paragraph runs past two sentences. A section opens with one sentence or none. A summary section (a verdict, a snapshot, a market read) is a bullet list, one fact per line, never prose. How the data was gathered goes in the closing "How this report was made" section, not in the finding.
- **Make the reasoning visible.** Use numbers and specific pages to support observations. Explain the mechanism and expected benefit of recommendations in plain language; do not omit that explanation for brevity or replace it with generic claims such as "builds trust". Distinguish measured outcomes, estimates and hypotheses. A supported qualitative assessment is better than invented precision.
- **Be honest about confidence.** Say which numbers came from a tool and which you verified yourself. When you could not check something, put it in a `.note` and say so.
- **Plain language.** Gloss every term of art on first use: canonical, meta description, crawler, 301, structured data. No drama words, no exclamation points, no filler.
- **One report, one spine.** Lead with the verdict and its business implication, then the material findings and worthwhile recommendations. If the research does not establish a worthwhile action, state that conclusion and the relevant limits. A report with twenty findings has failed.
- **Print the numbers.** A chart never carries a value that is not also written out in text.
- **Write in the user's language.** Keep commands, URLs, keywords and identifiers as they are.

## Title and summary

- Title: names the report type or specific subject and the full report date, under 120 characters, for example "Competitive Landscape — Sep 17, 2026" or "Keyword Research — Sep 17, 2026". Use the actual report date, including the day and four-digit year; put the data coverage period in the report body. Never a generic "SEO Report" or "Analysis".
- Omit the website from the title when the report is about the project's domain (`agenticseo context` shows it). Compare hostnames, ignoring the protocol, `www.` and a trailing slash. If the subject is a different website, include its bare hostname, for example "Competitor Analysis: example.com — Sep 17, 2026". Never put `https://` or a full URL in the title.
- Use the same title as the Markdown `# Title`, the HTML `<title>` and the visible `<h1>`, so the report list and both files agree.
- Summary: the text between the `# Title` line and the first `##` heading of the Markdown file, under 2,500 characters, in this order: the verdict, the leading recommendation and expected benefit (or why no material action is established), then the key evidence. This is what `agenticseo reports` shows and what you or another agent read instead of the full report, so write it for a reader who will never open the page.

## The closing section: how this report was made

Every report ends with a section titled "How this report was made" (HTML id `how-this-report-was-made`). When "What to do next" is included, place it immediately before this section. It opens with one fixed line naming the skill that produced the report and linking its file, so a reader who was handed the report can learn what the workflow does and rerun it:

```html
<p>Generated by the <a href="https://github.com/kid7st/agenticseo/blob/main/.agents/skills/seo-audit/SKILL.md" target="_blank" rel="noopener">AgenticSEO SEO Audit skill</a>, run by AGENT NAME on MONTH D, YYYY.</p>
```

The URL is always `https://github.com/kid7st/agenticseo/blob/main/.agents/skills/` followed by the skill's directory name and `/SKILL.md`, exactly as named in that skill's Output format list. Then the rest of the section as the skill describes it: which commands reported what, the evidence files behind paid lookups, and what you verified by hand. A report written from a template keeps this section too, as its last one.

## HTML constraints

`agenticseo reports` rejects an HTML export that breaks the first three rules, and names the problem.

- **No external resources of any kind.** No web fonts, no CDN scripts or stylesheets, no images by URL, no `@import`. Inline all CSS in one `<style>` block, and inline images as SVG or data URLs.
- **No `<script>`.** Anything interactive has to be static.
- **Finish the document.** It must end with `</html>`, and it stays under 500,000 bytes; aim under 80 KB. A filled report is normally 10–30 KB, and inlined images are the usual way people blow the limit. Write the whole page in one go rather than trailing off mid-section.
- **Links open in a new tab.** Write every link as `<a href="..." target="_blank" rel="noopener">`. The exception is an in-page anchor (`href="#id"`, as in the contents rail), which stays in the document.
- **Charts are inline SVG or CSS bars**, with real `<text>` labels and a `viewBox`. Always print the numbers next to the chart too.
- **Keep the doctype, `<html>`, `<head>` and `<title>`.** The file is a whole document, not a fragment.

## Writing the files

1. Write `<slug>.md` in the reports directory: `# Title`, the summary, then the report's sections as `##` headings in the order the producing skill gives.
2. Copy [template.html](template.html) to `<slug>.html`, keep its CSS as it is, and replace the ALL-CAPS placeholders with the same content. Each primitive shows one example row; repeat the ones you need and delete the ones you do not.
3. Run `agenticseo reports`. Exit code 2 names the file and the problem; fix that one thing and run it again.

## The primitives

- **Header**: `h1` (the report title) and `.byline` (who it is for and the date): "Prepared for kua.ai · September 24, 2026".
- **`.rail` contents**: the table of contents, sticky to the right of the text on a wide screen, dropped on a phone and in print. Every `h2` has an id, and the contents list links to each one with a plain `href="#id"`. Ids are the kebab-case of the heading text.
- **`h2` / `h3`**: `h2` opens a section, `h3` names one finding. Do not skip levels.
- **Finding**: use the producing skill's recommendation structure when specified; otherwise `h3`, then a `.finding` list with Problem, Change and Expected effect, each one or two sentences. Keep the expected benefit visible beside the proposed work, including when it is uncertain or limited. Descriptive findings can use only the relevant bullets.
- **`.note`**: one left-ruled callout for a caveat, a confidence limit or something you could not verify. Two or three in a report, never a row of them.
- **`.tw` table**: every numeric column gets `class="n"` on both the `th` and the `td` so the digits line up. Keep tables to five columns or fewer, put the long-text column last, and keep cell text short; a wide table scrolls on a phone and clips in print.
- **`figure` + `.bars`**: one small bar chart where a comparison reads faster than a sentence. One row per item: `.label`, a `.track` holding a `.bar` whose inline width is the value as a percentage of the largest, and `.value`. Inline SVG is fine for anything that is not a bar chart; give it a `viewBox` and real `<text>` labels.
- **`hr` then a closing `h2`**: the "What to do next" list, ordered, shortest useful.
- **How this report was made**: the last `h2`: the skill link line, then Tools and Verified bullets. See the section above.
- **`footer`**: one line: the sign-off and the data date. Method detail belongs in the closing section, not here.

## After you save

- The whole reply is at most three short bullets, then the report's HTML path last on its own line as `Read the full report: <path>`. The bullets: the verdict, the leading recommendation and expected benefit if supported, and anything the user has to act on (a question you need answered, a setting only they can change). Nothing else: no account of the run, no reviewer notes, no list of what worked, no restating the report.
- The skill you are running appends its own research-log line; add one only if it did not: `{ "entryDate": "<today from agenticseo context>", "summary": "Report: <title>. Verdict: <conclusion>" }` in `researchLog` of `.agenticseo/context.json`.
- If `agenticseo reports` rejects the files, fix the named problem and run it again. Never paste the report into chat instead.

## Guardrails

- Do not narrate the run in chat. Three bullets and the path is the ceiling, not the floor.
- Do not restyle the template per report. One look, kept good, is the point. A report template may set `--accent`, the byline (for example `Prepared for NAME` or a `Prepared by` sign-off) and the footer; nothing else in the CSS changes.
- Do not paste the report body into chat. The report lives in the project.
- Do not save a report into a project you were not asked about.
- Do not invent a number to fill a table cell. Write `unknown` and say why in a `.note`.
- To remove a report, delete both of its files.
