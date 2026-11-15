---
name: learning-plan-writer
description: Write learning plans as plan/v1 files (YAML frontmatter plus markdown sections) for import into the Learning Planner Android app, with a reading library, real PDF page ranges, Focus/Listen items and quiz questions with answers. Use this whenever the user asks for a learning plan, study plan, reading plan, syllabus or curriculum to import into their planner app, gives a goal like "learn X in N weeks", asks to convert an existing reading list or plan into the app's format, or mentions plan/v1, .plan.md or the Learning Planner, even if they don't name the format.
---

# Learning plan writer

The user has an Android app (Learning Planner) that imports a learning plan from a single markdown file in the `plan/v1` format. The app schedules the reading, opens each PDF at the right page, and quizzes the user after each section. Your job is to produce that file: correct enough that the app's strict parser accepts it on the first import, with page ranges that match the PDFs the user will actually open, and with questions that test real understanding.

The format is strict because the app parses it line by line. A file that looks right to a person but breaks one rule fails to import, and the user has to come back to you with line-numbered errors. The full rules are in `references/format.md`. Read it before writing any plan; the summary below is not enough on its own.

## Workflow

### 1. Gather what you need

You need:
- **Goal and level**: what the user wants to be able to do at the end (e.g. "read and work with generative counterfactual models").
- **Duration** in weeks, and roughly how many hours a week.
- **Focus slots**: days, start time and minutes for deep reading, or "none".
- **Listen slots**: the same for passive listening (NotebookLM audio overviews), or "none".
- **Existing material**: a reading list or draft plan to convert, PDFs they've attached, or document ids from earlier plans they want to reuse.

Ask only for what's missing, in one message. If the user says they don't have a fixed schedule for a queue, leave that queue's slots out of the frontmatter; the app treats it as an unscheduled queue. Don't invent a schedule.

If the user gives you an existing plan to convert, keep its structure, reading and exercises. Converting is not an invitation to redesign the plan. Anything the format has no place for (an introduction, a notation table, nested notes under items) must be either folded into item descriptions or left out; tell the user which, and what was lost.

### 2. Choose the reading

Prefer open-access sources that have a **direct PDF link**, because the app can download those itself:
- arXiv: `https://arxiv.org/pdf/<id>v<N>`. Pin the version (the `vN`) you looked at, so the page numbers you write match the file the app downloads later.
- Publisher or author PDFs that end in `.pdf` and actually return a PDF.

Only put a `url` on a document if you have confirmed it returns a PDF (you downloaded it, or fetched it and saw PDF content). A landing page or HTML version breaks the app's download. For books and paywalled papers, leave `url` out; the user attaches their own copy.

Give each document a short, stable, lowercase id (`pawlowski-2020`, `mml`, `pearl-primer`). Later plans reuse documents by id, so don't rename ids the user already has.

Group documents by type, with free-text group names (e.g. Textbooks, Tutorials and reviews, Papers).

### 3. Look up real page numbers

The reader opens a document at the page in the item's reference, so wrong pages send the user to the wrong place. Page numbers are **PDF page numbers** (1 = the first page of the file, as a PDF viewer shows it), not the numbers printed on the page. Books usually differ by the length of the front matter (in *Mathematics for Machine Learning*, printed p.173 is PDF p.179).

For each document with a PDF you can get (attached by the user, or downloadable):
1. Download it in the sandbox.
2. Run `scripts/pdf_pages.py` (see "Scripts" below) to list the bookmarks with their PDF pages. Most arXiv papers and many books have bookmarks.
3. If there are no bookmarks, or you need subsections the bookmarks don't list, search the page text for the heading with `find`.
4. A section's range runs from its heading's page to the page before the next section's heading (or that same page, if the next section starts partway down it).
5. For "read the full paper", end the range at the last page before the references.

If downloads fail (the sandbox may have no network access), don't guess pages. Use page-less references (`[doc-id]`), put the section in the description ("§2.1, VAEs"), and tell the user that turning on network access in the sandbox, or attaching the PDFs, would let you fill in real pages.

For documents you can't get at all (most textbooks), use page-less references.

### 4. Write the sections

- Usually one section per week. The section number is a stable id: when the user re-imports an edited plan, sections are matched by number.
- **Focus items** are the deep reading and exercises, in the order the user should do them. Estimate minutes for each so that a section's required Focus items add up to about the user's weekly budget. Use `Read` for reading, `Do` for exercises and hands-on work, `Watch` for videos.
- Mark items that aren't required with `[optional]`: alternatives, extensions, "if you have time" reading. Optional items don't block the section's quiz.
- **Listen items** go under `### Listen`, with an indented list of sources to load into NotebookLM: the section's open-access PDFs with their page ranges, and any good public web pages. Listening is passive and may not happen; if the user has no reliable listen time, mark Listen items `[optional]`.
- An exercise that has a definite answer should appear twice: as a `Do` item (so time is set aside for it) and as a question (so the quiz checks it).

### 5. Write the questions

The app shows one question at a time on a phone and tracks a score for each concept. Questions are the user's main feedback on whether they understood the reading, so they deserve care.

**They must be answerable on a phone, in your head.** The user answers on the bus, not at a desk, so no question may need pen and paper: no derivations, no multi-step algebra, no arithmetic beyond what's easy mentally. "Derive Bayes' theorem" is out; "which step of the derivation uses the product rule?" is in. They should still be hard: test whether the user can tell apart ideas that are easy to confuse, apply an idea to a new small case, or predict what happens when an assumption changes.

- 3 to 5 per section. Mark the one or two hardest with `[hard]`.
- **Prefer multiple choice**, with four options. The quality of a multiple-choice question is in its wrong options: each should be a mistake a person who half-understood the reading would actually make (a confused definition, a reversed conditional, the right idea applied to the wrong case). Avoid options that are obviously wrong, joke options, "all of the above", and options that differ only in length or wording style. Keep options short enough to read on a phone, and make sure exactly one is right.
- For multiple choice, the `Answer:` line explains why the right option is right and why the most tempting wrong one is wrong, in one or two sentences.
- An open question is fine when the answer is a short thing to recall or state (a definition, a name, a one-line reason) that the user can check against the `Answer:` line.
- Answers must be correct and self-contained, in one line.
- For claims about a specific paper, check the answer against the paper's text (search the PDF) instead of writing from memory. Papers are easy to misremember in the details, and a wrong answer key teaches the wrong thing.
- `Concepts:` tags drive the app's per-concept scores, so reuse the same concept names across sections when the same idea comes back ("approximate abduction" in week 4 and week 9, not "approx. abduction" in one of them).
- Add `Ref: doc-id p.N` when there's a specific page where the answer is explained, and only with a page you verified.

### 6. Check the file against the rules

There's no validator, so before handing the file over, go through the checklist at the end of `references/format.md` line by line. The most common ways a file fails to import:
- text between the frontmatter and the first `## 1.` heading (an intro paragraph);
- extra keys on a document (only `id`, `title`, `url` are allowed);
- a description ending in a parenthesised number, like `(2020)`, which gets read as minutes;
- a single page written as `p.14` in an item reference (it must be `p.14-14`; only `Ref:` lines use a single page);
- a question whose `Answer:` line is missing, not indented, or not directly after the question;
- a document reference to an id that isn't in the library.

### 7. Deliver

Write the plan to a file named `<plan-id>.plan.md` and give it to the user as a downloadable file, not only inline, because they import it from their phone.

After the file, tell the user briefly:
- which documents have no URL (they'll need to attach their own PDF) and which have no page ranges;
- anything from their own material that you changed, folded into descriptions or left out;
- which answers you checked against the source text and which you wrote from general knowledge.

## Scripts

`scripts/pdf_pages.py` needs `pypdf` (`pip install pypdf`).

```bash
python scripts/pdf_pages.py info paper.pdf            # page count, arXiv version stamp if present
python scripts/pdf_pages.py outline paper.pdf         # bookmarks with PDF page numbers
python scripts/pdf_pages.py find book.pdf "^6\.[0-9]+ [A-Z]" --from 170 --to 240
                                                      # lines matching a regex, with page numbers
```

`find` matches against each line of page text, so anchor heading patterns with `^`. Headings that repeat as running headers (at the top of every page of a section) show up on every page; the first match is the section start.
