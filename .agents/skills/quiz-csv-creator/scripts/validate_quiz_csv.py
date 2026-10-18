#!/usr/bin/env python3
"""Validate a quiz CSV for the QuizTime PWA "simple" import format.

Checks the file against the contract in ../SKILL.md: exact header, four
non-empty answers, a single in-range 1-based correct index, duplicate and
banned option patterns, explanation coverage (2-3 sentences), correct-answer
position randomness (no position in more than half of the questions, never 3+
in a row), and question independence (repeated stem templates, option sets
shared between questions, the same correct fact tested repeatedly).

Usage:
    python3 validate_quiz_csv.py QUIZ.csv [--strict]

Exit codes:
    0  ok (warnings allowed unless --strict)
    1  validation failed (errors, or warnings with --strict)
    2  input could not be read
"""
from __future__ import annotations

import argparse
import csv
import itertools
import re
import sys
from collections import Counter

REQUIRED = ["question", "answer1", "answer2", "answer3", "answer4", "correct", "explanation"]
OPTIONAL_OK = {"time_limit", "time", "time limit", "seconds", "title", "quiz", "quiz title"}

BANNED_ANSWER = re.compile(
    r"all of the above|none of the above"
    r"|alle[nr]? (oben|vorstehend|genannten)"
    r"|keine[rs]? (oben|vorstehend|genannten)"
    r"|sämtliche (oben|vorstehend|genannten)",
    re.IGNORECASE,
)
NEGATION_STEM = re.compile(r"\bNOT\b|\bnicht\b|\bnever\b|\bniemals\b")
ABSOLUTE_OPT = re.compile(r"\b(always|never|immer|niemals|ausschließlich|garantiert)\b", re.IGNORECASE)
REFERENCE = re.compile(r"\([^()]*\d[^()]*\)|¶")
STOPWORDS = {
    "welche", "welcher", "welches", "welchem", "welchen", "was", "wie", "warum", "weshalb",
    "womit", "wodurch", "worauf", "woran", "worin", "wann", "wer", "wem", "wen", "dessen",
    "deren", "diese", "dieser", "dieses", "this", "that", "which", "what",
    "where", "when", "why", "how", "does", "into", "about", "under", "über", "unter",
    "gegen", "zwischen", "innerhalb", "äquivalent", "bezüglich", "sogenannte", "eigentlich",
    "eigentliche", "eigentlichen", "folgende", "folgendes", "richtig", "falsch", "wahr",
    "stimmt", "bedeutet", "genau", "ebenso", "sondern", "manche", "einige", "bereits",
    "weiter", "später", "früher", "wieder", "immer", "meist", "oft", "immerhin", "ebens",
    "gilt", "entstanden", "verändert", "bedeutet", "unterscheiden", "verbindet",
}
ARTICLES = {
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
    "eines", "einem", "ein", "a", "an", "the", "ihr", "ihre", "ihren", "sein", "seine",
    "seinem", "seiner", "unser", "unsere", "ihr", "ihre",
}
WORD = re.compile(r"[\wÄÖÜäöüßß-]+")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def lowered(text: str) -> str:
    return norm(text).lower()


def words_6plus(text: str) -> set[str]:
    return {w for w in WORD.findall(text.lower()) if len(w) >= 6 and w not in STOPWORDS}


def sentence_count(text: str) -> int:
    # Drop the source reference "(S. 4, Abs. 1)" - its dots are not sentences.
    # Count terminators only when followed by whitespace + capital/digit, so
    # abbreviations ("ca.", "S.") and decimals ("23,5°.") are not over-counted.
    text = re.sub(r"\([^()]*\)", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return 0
    ends = len(re.findall(r"[.!?…](?![:;])(?=\s+[A-ZÄÖÜ0-9]|$)", text))
    return max(1, ends)


def stem_template(prompt: str) -> str:
    """Normalise a stem so 'Zu welcher Art gehort der Buchel?' and '... die Zither?'
    collapse to the same template: keep function words, mask content words/articles."""
    words = re.sub(r"[^\wäöüÄÖÜß]+", " ", prompt.lower()).split()
    return " ".join(
        w if (w in STOPWORDS or (len(w) <= 3 and w not in ARTICLES)) else "_"
        for w in words
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate a QuizTime quiz CSV.")
    ap.add_argument("file", help="CSV file to validate")
    ap.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = ap.parse_args()

    try:
        with open(args.file, newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.reader(fh))
    except OSError as exc:
        print(f"error: cannot read {args.file}: {exc}")
        return 2
    except UnicodeDecodeError:
        print("error: file is not valid UTF-8")
        return 2

    rows = [r for r in rows if any(norm(c) for c in r)]
    if not rows:
        print("error: file contains no rows")
        return 1

    errors: list[str] = []
    warnings: list[str] = []
    e = errors.append
    w = warnings.append

    header = [lowered(c) for c in rows[0]]
    idx = {name: header.index(name) for name in header if name}
    for name in REQUIRED:
        if name not in idx:
            e(f"header: missing required column '{name}'")
    for name in header:
        if name and name not in REQUIRED and name not in OPTIONAL_OK:
            w(f"header: unknown column '{name}' (the app will ignore it)")
    if errors:
        report(args.file, 0, [], errors, warnings, args.strict)
        return 1

    questions: list[tuple[int, str, list[str], int, str]] = []  # (line, prompt, answers, key, expl)

    for line_no, row in enumerate(rows[1:], start=2):
        cells = {name: norm(row[idx[name]]) if idx[name] < len(row) else "" for name in idx}
        qnum = line_no - 1
        prompt = cells.get("question", "")
        answers = [cells.get(f"answer{i}", "") for i in range(1, 5)]
        correct_raw = cells.get("correct", "")
        explanation = cells.get("explanation", "")
        time_raw = next((cells[n] for n in ("time_limit", "time", "time limit", "seconds") if cells.get(n)), "")
        title_raw = next((cells[n] for n in ("title", "quiz", "quiz title") if cells.get(n)), "")

        if not prompt:
            if any(answers) or correct_raw or explanation or time_raw or title_raw:
                w(f"row {line_no}: empty question but other cells present - row skipped by the app")
            continue

        empty = [i + 1 for i, a in enumerate(answers) if not a]
        if empty:
            e(f"row {line_no}: answer{', answer'.join(map(str, empty))} is empty - fill all four options")

        filled = [a for a in answers if a]
        seen: dict[str, int] = {}
        for i, a in enumerate(filled, start=1):
            key = lowered(a)
            if key in seen:
                e(f"row {line_no}: duplicate answer text ('{a}') - distractors must differ from the key")
            seen[key] = i

        for i, a in enumerate(filled, start=1):
            if BANNED_ANSWER.search(a):
                e(f"row {line_no}: answer{i} uses a banned 'all/none of the above' pattern")
            if ABSOLUTE_OPT.search(a):
                w(f"row {line_no}: answer{i} contains an absolute word (always/never/...) - rewrite it")

        if NEGATION_STEM.search(prompt):
            w(f"row {line_no}: stem is negative (NOT/nicht) - prefer positive stems")
        if len(prompt) > 120:
            w(f"row {line_no}: question is {len(prompt)} chars - aim under 120 so it fits on a phone")

        if not re.fullmatch(r"[1-4]", correct_raw):
            e(f"row {line_no}: correct='{correct_raw}' - must be exactly one digit 1-4")
            questions.append((line_no, prompt, filled, 0, explanation))
            continue
        key = int(correct_raw)
        if key > len(filled):
            e(f"row {line_no}: correct={key} points to an empty answer slot")
        questions.append((line_no, prompt, filled, key, explanation))

        stem_tokens = words_6plus(prompt)
        if stem_tokens and 2 <= len(filled) and key:
            for tok in sorted(stem_tokens):
                hits = [i + 1 for i, a in enumerate(filled) if tok in lowered(a)]
                if hits == [key]:
                    w(f"row {line_no}: stem word '{tok}' reappears only in the correct answer - this clues the key")

        if not explanation:
            e(f"row {line_no}: explanation is missing - required for every question")
        else:
            sc = sentence_count(explanation)
            if sc < 2:
                e(f"row {line_no}: explanation is {sc} sentence - use 2-3 sentences (the '(S. n)' reference does not count)")
            elif sc > 3:
                w(f"row {line_no}: explanation has more than 3 sentences")
            if len(explanation) > 260:
                w(f"row {line_no}: explanation is {len(explanation)} chars - keep it to 2-3 short sentences")
            if not REFERENCE.search(explanation):
                w(f"row {line_no}: explanation has no source reference like '(S. 3, Abs. 2)' or '(Fig. 2)'")

        if time_raw:
            try:
                t = int(time_raw)
                if not 5 <= t <= 120:
                    w(f"row {line_no}: time_limit={t} outside 5-120 seconds")
            except ValueError:
                w(f"row {line_no}: time_limit='{time_raw}' is not a whole number")

    if not questions:
        e("no question rows found below the header")
        report(args.file, 0, [], errors, warnings, args.strict)
        return 1

    prompts: dict[str, int] = {}
    for line_no, prompt, *_ in questions:
        if lowered(prompt) in prompts:
            e(f"row {line_no}: duplicate question (same stem as row {prompts[lowered(prompt)]})")
        prompts.setdefault(lowered(prompt), line_no)

    positions = [key for _, _, _, key, _ in questions if key]
    n = len(positions)
    counts = Counter(positions)
    for pos in sorted(counts):
        if counts[pos] * 2 > n:
            e(f"position {pos} is correct in {counts[pos]} of {n} questions (>50%) - re-shuffle answer order")
    if n >= 5:
        unused = [p for p in (1, 2, 3, 4) if counts.get(p, 0) == 0]
        if unused:
            w(f"position(s) {', '.join(map(str, unused))} are never correct across {n} questions")
    run_val, run_len, run_start = 0, 0, 0
    for i, pos in enumerate(positions + [None]):
        if pos == run_val:
            run_len += 1
        else:
            if run_val and run_len >= 3:
                e(f"position {run_val} correct {run_len}x in a row (rows {run_start}-{run_start + run_len - 1}) - re-shuffle")
            run_val, run_len, run_start = pos, 1, i + 1

    for line_no, prompt, filled, key, _ in questions:
        if key == 0 or len(filled) < 2:
            continue
        lens = [len(a) for a in filled]
        if min(lens) > 0 and max(lens) / min(lens) >= 3:
            w(f"row {line_no}: answer lengths differ a lot ({min(lens)} vs {max(lens)} chars) - the longest option often clues the key")

    # Question independence: correlated items let pupils answer by elimination.
    templates: dict[str, list[int]] = {}
    for line_no, prompt, *_ in questions:
        templates.setdefault(stem_template(prompt), []).append(line_no)
    for tpl, lines in templates.items():
        if len(lines) >= 3:
            e(f"rows {', '.join(map(str, lines))}: same stem template used {len(lines)}x ('{tpl}') - such items are correlated and give answers away by elimination")

    opt_lines: dict[frozenset[str], list[int]] = {}
    for line_no, _, filled, _, _ in questions:
        opt_lines.setdefault(frozenset(lowered(a) for a in filled), []).append(line_no)
    for lines in opt_lines.values():
        if len(lines) >= 2:
            e(f"rows {', '.join(map(str, lines))}: identical option set - answering one solves the other(s)")

    pair_shared: dict[tuple[int, int], int] = Counter()
    for (l1, _, f1, _, _), (l2, _, f2, _, _) in itertools.combinations(questions, 2):
        shared = sum(1 for a in f2 if lowered(a) in {lowered(x) for x in f1})
        if shared:
            pair_shared[(l1, l2)] = shared
    for (l1, l2), shared in sorted(pair_shared.items()):
        if shared >= 3:
            e(f"rows {l1} & {l2}: share {shared} of their options - items are correlated, rewrite distractors")
        elif shared == 2:
            w(f"rows {l1} & {l2}: share 2 options - check that neither gives the other away")

    key_lines: dict[str, list[int]] = {}
    for line_no, _, filled, key, _ in questions:
        if key and key <= len(filled):
            key_lines.setdefault(lowered(filled[key - 1]), []).append(line_no)
    for text, lines in key_lines.items():
        if len(lines) >= 3:
            e(f"'{text}' is the correct answer in {len(lines)} questions ({', '.join(map(str, lines))}) - one fact per question")
        elif len(lines) == 2:
            w(f"'{text}' is the correct answer in both rows {lines[0]} and {lines[1]} - make the second item test something else")

    report(args.file, n, [counts.get(p, 0) for p in (1, 2, 3, 4)], errors, warnings, args.strict)
    if errors or (args.strict and warnings):
        return 1
    return 0


def report(path: str, n: int, counts: list[int], errors: list[str], warnings: list[str], strict: bool) -> None:
    for msg in errors:
        print(f"error:   {msg}")
    for msg in warnings:
        print(f"warning: {msg}")
    if n:
        dist = " ".join(f"pos{i}={c}" for i, c in enumerate(counts, start=1))
        print(f"{n} questions · correct positions: {dist}")
    verdict = "OK" if not errors and not (strict and warnings) else "FAILED"
    print(f"{verdict}: {len(errors)} error(s), {len(warnings)} warning(s) in {path}")


if __name__ == "__main__":
    sys.exit(main())
