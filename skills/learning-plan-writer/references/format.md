# plan/v1 format

The app's parser is strict and line-based. Every rule below is enforced; breaking one makes the import fail with a line-numbered error.

## Contents
1. File layout
2. Frontmatter
3. Sections and subsections
4. Focus and Listen items
5. Listen sources
6. Questions
7. Full example
8. Checklist

## 1. File layout

```
---
<YAML frontmatter>
---

## 1. <Section title>
### Focus
...
### Listen
...
### Questions
...

## 2. <Section title>
...
```

- The file starts with `---` on the first line, and the frontmatter ends at the next line that is exactly `---`.
- After the frontmatter, the first non-blank line must be a `## 1. Title` section heading. There is no place for introductory text, notes or tables: any other text anywhere in the body is an error.
- Blank lines are allowed anywhere.

## 2. Frontmatter

```yaml
format: plan/v1
id: counterfactual-models-2026
title: Generative Counterfactual Models
start: 2026-11-09
slots:                       # optional; either or both of focus/listen
  focus:  { days: [Mon, Wed, Fri], time: "07:00", minutes: 45 }
  listen: { days: [Tue, Thu], time: "17:30", minutes: 30 }
library:
  - group: Papers
    docs:
      - id: pawlowski-2020
        title: Pawlowski, Castro & Glocker (2020), Deep Structural Causal Models
        url: https://arxiv.org/pdf/2006.06485v2
```

| Key | Rule |
|---|---|
| `format` | exactly `plan/v1` |
| `id` | lowercase letters, digits and hyphens, starting with a letter or digit. Stable: re-importing a file with the same id updates that plan |
| `title` | any non-empty text |
| `start` | `YYYY-MM-DD` |
| `slots` | optional. Only the keys `focus` and `listen`, each optional. Leave a queue out if the user has no fixed time for it |
| slot `days` | non-empty list of `Mon` `Tue` `Wed` `Thu` `Fri` `Sat` `Sun` |
| slot `time` | `"HH:MM"`, 24-hour, **quoted** (unquoted `07:00` can be read by YAML as a number) |
| slot `minutes` | positive whole number |
| `library` | list of groups. Each group has `group` (free text) and `docs` |
| doc keys | only `id`, `title` and optional `url`. Any other key is an error |
| doc `id` | same pattern as the plan id. Must be unique in the file. The word `optional` is reserved and can't be an id |
| doc `url` | a direct link to a PDF. Leave it out rather than give a landing page |

A plan can refer to documents that are already in the app's library from an earlier plan without listing them again. Only rely on this if the user tells you the ids.

Quote YAML values that contain `: ` or start with a special character (`[`, `{`, `&`, `*`, `#`, `|`, `>`, `!`, `%`, `@`, a backtick). A title like `Doersch: Tutorial on VAEs` needs quotes.

## 3. Sections and subsections

- Section heading: `## N. Title`, where N is a whole number. Numbers must be unique; they're the stable ids used to match sections on re-import, so keep them when editing a plan.
- Subsection headings, each optional, exactly: `### Focus`, `### Listen`, `### Questions`.
- Every item or question must be under one of these subsections.

## 4. Focus and Listen items

One line each:

```
- [ ] Type: description (minutes) [doc-id p.A-B] [optional]
```

- `Type` is one of `Read`, `Watch`, `Do`, `Listen`. Under `### Listen`, only `Listen`. Under `### Focus`, anything except `Listen`.
- `description`: free text. Put the chapter or section here ("Ch. 6, §6.1–6.5, probability spaces to the Gaussian").
- `(minutes)`: optional whole number in parentheses, directly before the reference (or at the end if there's no reference).
- Reference, optional, one of:
  - `[doc-id p.A-B]`: pages A to B of a library document. Always a range: a single page is `p.14-14`. A ≥ 1 and B ≥ A.
  - `[doc-id]`: the document with no page range (opens where the user last was).
  - `<https://...>`: a link instead of a document.
- `[optional]`: optional, always last. The item doesn't block the section's quiz.
- The order of the parts is fixed: description, minutes, reference, `[optional]`, each separated by one space.

Because minutes are recognised as a parenthesised number before the reference, **a description must not end with a parenthesised number** unless minutes follow it. `- [ ] Read: Castro (2020) [castro-2020 p.1-9]` reads 2020 as minutes. Write `Read: Castro et al. 2020, full paper (60) [castro-2020 p.1-9]` instead.

Items can't have nested bullet lists under them, except Listen sources (next section). Put extra notes into the description.

Valid examples:

```
- [ ] Read: Ch. 1, conditional probability (40) [think-bayes p.1-24]
- [ ] Read: §2.1 only (15) [ribeiro-2023 p.2-2]
- [ ] Read: Pearl Primer Ch. 1 (60) [pearl-primer]
- [ ] Do: exercise. If x ~ N(0, 1) and y = 2x + 1, show y ~ N(1, 4) (20)
- [ ] Do: try the demos (45) <https://github.com/biomedia-mira/causal-gen> [optional]
- [ ] Read: free alternative, Elements of Causal Inference Ch. 3 and 6 (120) [peters-elements] [optional]
```

## 5. Listen sources

A Listen item can be followed by indented lines listing sources for NotebookLM:

```
### Listen
- [ ] Listen: NotebookLM overview of normalising flows (20) [optional]
  - [papamakarios-2021 p.1-9]
  - <https://en.wikipedia.org/wiki/Flow-based_generative_model>
```

- Each source line is indented and is `- [doc-id p.A-B]`, `- [doc-id]` or `- <url>`.
- Sources are only allowed directly under a Listen item.

## 6. Questions

A question is either **multiple choice** (has options) or **open** (no options; the user reveals the answer and grades themselves).

```
### Questions
1. [hard] Multiple-choice question on one line?
   - [ ] a wrong option
   - [x] the right option
   - [ ] another wrong option
   - [ ] another wrong option
   Answer: why the right option is right, and why the most tempting wrong one is wrong.
   Ref: doc-id p.14
   Concepts: concept one, concept two
2. Open question on one line?
   Answer: answer on one line.
   Concepts: ...
```

- Numbered `1.`, `2.`, … in order, restarting at 1 in each section.
- `[hard] ` directly after the number marks a harder question.
- Options (multiple choice only): indented lines `- [ ] text` or `- [x] text`, directly after the question. At least two, and exactly one marked `[x]`. The app shuffles them, so don't write "both of the above" or refer to options by letter.
- Then the indented `Answer:` line. It is required. For multiple choice it is the explanation shown after the user answers.
- Then, optionally and in either order, indented `Ref:` and `Concepts:` lines.
- `Ref: doc-id p.N` is a single page (no range), and the doc must be in the library.
- `Concepts:` is a comma-separated list.
- Every part is one line. Multi-line questions or answers are errors.

## 7. Full example

```markdown
---
format: plan/v1
id: bayes-stats-2026
title: Bayesian Statistics for Reading Papers
start: 2026-11-09
slots:
  focus:  { days: [Mon, Wed, Fri], time: "07:00", minutes: 45 }
library:
  - group: Textbooks
    docs:
      - id: think-bayes
        title: Think Bayes (2nd ed.)
        url: https://example.org/think-bayes.pdf
  - group: Papers
    docs:
      - id: gelman-shalizi-2013
        title: Gelman & Shalizi, Philosophy and the practice of Bayesian statistics
---

## 1. Probability refresher

### Focus
- [ ] Read: Ch. 1, conditional probability (40) [think-bayes p.1-24]
- [ ] Do: Ch. 1 exercises (30) [think-bayes p.25-27]
- [ ] Read: Gelman & Shalizi, introduction (30) [gelman-shalizi-2013] [optional]

### Listen
- [ ] Listen: NotebookLM audio overview of conditional probability (20) [optional]
  - [think-bayes p.1-24]
  - <https://en.wikipedia.org/wiki/Bayes%27_theorem>

### Questions
1. A test is 99% sensitive and 95% specific for a condition with 1% prevalence. Roughly what is P(condition | positive)?
   - [ ] About 95%
   - [ ] About 99%
   - [x] About 17%
   - [ ] About 5%
   Answer: Per 100 people about 1 true positive (0.99 × 1) and about 5 false positives (0.05 × 99), so roughly 1 in 6 positives has the condition. 95% is the specificity, P(negative | no condition), not the answer.
   Ref: think-bayes p.14
   Concepts: conditional probability, base rates
2. [hard] Why can two people with the same data reach different posteriors, and when does the difference shrink?
   Answer: They used different priors. The difference shrinks as data accumulates, because the likelihood comes to dominate the prior.
   Concepts: priors, likelihood
```

## 8. Checklist

Go through this before delivering the file.

- [ ] Line 1 is `---`; the frontmatter closes with `---`.
- [ ] `format: plan/v1`; `id` and doc ids are lowercase-hyphenated; no doc id is `optional`; no duplicate doc ids.
- [ ] `start` is `YYYY-MM-DD`; slot times are quoted `"HH:MM"`; slots only where the user has a fixed time.
- [ ] Docs have only `id`, `title`, `url`; every `url` was confirmed to return a PDF; arXiv URLs pinned to a version.
- [ ] YAML values containing `: ` are quoted.
- [ ] The first body line is `## 1. ...`; no other text outside subsections.
- [ ] Section numbers are unique.
- [ ] Every item line matches `- [ ] Type: description (minutes) [ref] [optional]` with parts in that order.
- [ ] No `Listen` items under Focus, only `Listen` items under Listen.
- [ ] Item page references are ranges (`p.A-B`), A ≤ B, within the PDF's page count.
- [ ] No description ends in a parenthesised number unless minutes follow.
- [ ] Indented source lines only under Listen items.
- [ ] Questions numbered from 1 in each section, each followed by its options (if any) and then an indented `Answer:` line.
- [ ] Multiple-choice questions have at least two options and exactly one `[x]`; no option refers to another by position.
- [ ] `Ref:` lines are `doc-id p.N` with a single verified page.
- [ ] Every referenced doc id is in the library (or is one the user said is already in their app).
- [ ] Concept names are consistent across sections.
