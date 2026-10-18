#!/usr/bin/env python3
"""Validate a quiz CSV for the QuizTime PWA "simple" import format.

Checks the file against the contract in ../SKILL.md: exact header, four
non-empty answers, a single in-range 1-based correct index, duplicate and
banned option patterns, explanation coverage, and correct-answer position
randomness (no position in more than half of the questions, never 3+ in a row).

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
    "deren", "denen", "deren", "diese", "dieser", "dieses", "this", "that", "which", "what",
    "where", "when", "why", "how", "does", "into", "about", "under", "über", "unter",
    "gegen", "zwischen", "innerhalb", "äquivalent", "bezüglich", "sogenannte", "eigentlich",
    "eigentliche", "eigentlichen", "folgende", "folgendes", "richtig", "falsch", "wahr",
    "stimmt", "bedeutet", "genau", "ebenso", "sondern", "manche", "einige", "bereits",
    "weiter", "später", "früher", "wieder", "immer", "meist", "oft", "immerhin", "ebens",
}
WORD = re.compile(r"[\wÄÖÜäöüßß-]+")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def lowered(text: str) -> str:
    return norm(text).lower()


def words_6plus(text: str) -> set[str]:
    return {w for w in WORD.findall(text.lower()) if len(w) >= 6 and w not in STOPWORDS}


def sentence_count(text: str) -> int:
    # Drop the source reference "(S. 4, Abs. 1)" first - its dots are not sentences.
    text = re.sub(r"\([^()]*\)", "", text)
    return len([p for p in re.split(r"[.!?…]+", text) if p.strip()])


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
            if len(explanation) > 240:
                w(f"row {line_no}: explanation is {len(explanation)} chars - keep it to 1-3 short sentences")
            if sentence_count(explanation) > 3:
                w(f"row {line_no}: explanation has more than 3 sentences")
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
