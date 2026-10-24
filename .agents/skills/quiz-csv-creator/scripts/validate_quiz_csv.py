#!/usr/bin/env python3
"""Validate a quiz CSV for the QuizTime PWA "simple" import format.

Checks the file against the contract in ../SKILL.md: exact header, four
non-empty answers, `correct` matching the question `type` (single: one 1-based
index; multi: 2+ indices, at least one wrong; order: the full tap sequence as a
permutation that differs from the listed order), duplicate and banned option
patterns, explanation coverage (2-3 sentences), correct-answer position
randomness for single-choice questions (no position in more than half, never 3+
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
OPTIONAL_OK = {"time_limit", "time", "time limit", "seconds", "title", "quiz", "quiz title", "type", "question type"}
VALID_TYPES = {"", "single", "multi", "order"}
TYPE_TIME_FLOOR = 20  # the app gives multi/order 30 s by default; below this is suspicious

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


def parse_indices(raw: str) -> list[int] | None:
    """Parse a 1-based index list like '2' or '2,4' ('2;4' tolerated). None if malformed."""
    parts = [p.strip() for p in re.split(r"[,;]+", (raw or "").strip()) if p.strip()]
    if not parts:
        return None
    nums: list[int] = []
    for p in parts:
        if not re.fullmatch(r"\d+", p):
            return None
        nums.append(int(p))
    return nums



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
        report(args.file, 0, Counter(), [], errors, warnings, args.strict)
        return 1

    questions: list[tuple[int, str, list[str], list[int], str, str]] = []  # (line, prompt, answers, keys, expl, type)

    for line_no, row in enumerate(rows[1:], start=2):
        cells = {name: norm(row[idx[name]]) if idx[name] < len(row) else "" for name in idx}
        qnum = line_no - 1
        prompt = cells.get("question", "")
        answers = [cells.get(f"answer{i}", "") for i in range(1, 5)]
        correct_raw = cells.get("correct", "")
        explanation = cells.get("explanation", "")
        time_raw = next((cells[n] for n in ("time_limit", "time", "time limit", "seconds") if cells.get(n)), "")
        title_raw = next((cells[n] for n in ("title", "quiz", "quiz title") if cells.get(n)), "")
        type_raw = next((lowered(cells.get(n, "")) for n in ("type", "question type") if cells.get(n)), "")

        if not prompt:
            if any(answers) or correct_raw or explanation or time_raw or title_raw:
                w(f"row {line_no}: empty question but other cells present - row skipped by the app")
            continue

        if type_raw not in VALID_TYPES:
            e(f"row {line_no}: type='{type_raw}' - use single, multi or order (or leave it empty)")

        empty = [i + 1 for i, a in enumerate(answers) if not a]
        if type_raw == "order":
            # order may use 3 or 4 answers, but only answer4 may be empty
            if empty and set(empty) != {4}:
                e(f"row {line_no}: answer{', answer'.join(map(str, empty))} is empty - order questions fill answer1..answer3 (answer4 optional)")
        elif empty:
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

        keys: list[int] = []
        qtype = type_raw if type_raw in VALID_TYPES else ""
        nums = parse_indices(correct_raw)
        if nums is None:
            e(f"row {line_no}: correct='{correct_raw}' - 1-based index or index list like 2 or 2,4")
        else:
            oob = [v for v in nums if not 1 <= v <= len(filled)]
            dup = len(set(nums)) != len(nums)
            if oob:
                e(f"row {line_no}: correct={correct_raw} out of range (1-{len(filled)}) - points to an empty or missing answer slot")
            elif dup:
                e(f"row {line_no}: correct='{correct_raw}' repeats an index")
            elif qtype == "multi":
                if len(nums) < 2:
                    e(f"row {line_no}: type=multi needs at least two correct indices")
                elif len(nums) >= len(filled):
                    e(f"row {line_no}: type=multi needs at least one wrong answer")
                else:
                    keys = nums
            elif qtype == "order":
                if len(filled) < 3:
                    e(f"row {line_no}: order questions need at least three answers")
                elif sorted(nums) != list(range(1, len(filled) + 1)):
                    e(f"row {line_no}: order correct='{correct_raw}' must list every answer exactly once (a full sequence of 1-{len(filled)})")
                elif nums == list(range(1, len(filled) + 1)):
                    e(f"row {line_no}: order answers are listed in the correct order - shuffle the answer columns so the key does not leak")
                else:
                    keys = nums
            elif len(nums) == 1:
                keys = nums
            elif qtype == "single":
                e(f"row {line_no}: type=single needs exactly one correct index")
            else:
                qtype = "multi"  # legacy row: several correct indices play as multi-select
                w(f"row {line_no}: several correct indices without a type column - write type=multi")
                keys = nums
        efftype = qtype or ("multi" if len(keys) > 1 else "single")
        if efftype == "order" and len(filled) == 3:
            w(f"row {line_no}: order with 3 answers has only 6 permutations - prefer 4 answers (24 orders to guess through)")
        questions.append((line_no, prompt, filled, keys, explanation, efftype))

        stem_tokens = words_6plus(prompt)
        if stem_tokens and keys and efftype != "order" and len(keys) < len(filled):
            keyset = set(keys)
            for tok in sorted(stem_tokens):
                hits = {i + 1 for i, a in enumerate(filled) if tok in lowered(a)}
                if hits == keyset:
                    w(f"row {line_no}: stem word '{tok}' reappears only in the correct answer{'s' if len(keyset) > 1 else ''} - this clues the key")

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
                elif efftype != "single" and t < TYPE_TIME_FLOOR:
                    w(f"row {line_no}: time_limit={t} is short for a {efftype}-type question - the app gives 30 s; omit time_limit to use it")
            except ValueError:
                w(f"row {line_no}: time_limit='{time_raw}' is not a whole number")

    if not questions:
        e("no question rows found below the header")
        report(args.file, 0, Counter(), [], errors, warnings, args.strict)
        return 1

    prompts: dict[str, int] = {}
    for line_no, prompt, *_ in questions:
        if lowered(prompt) in prompts:
            e(f"row {line_no}: duplicate question (same stem as row {prompts[lowered(prompt)]})")
        prompts.setdefault(lowered(prompt), line_no)

    type_counts = Counter(t for *_, t in questions)
    positions = [keys[0] for _, _, _, keys, _, t in questions if t == "single" and keys]
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

    # multi-select: the same correct-position set over and over is guessable
    multi_sets: dict[tuple[int, ...], list[int]] = {}
    for line_no, _, _, keys, _, t in questions:
        if t == "multi" and keys:
            multi_sets.setdefault(tuple(sorted(keys)), []).append(line_no)
    for key_pos, lines in multi_sets.items():
        if len(lines) >= 2:
            w(f"correct positions ({','.join(map(str, key_pos))}) repeat in {len(lines)} multi questions ({', '.join(map(str, lines))}) - vary which options are correct")

    for line_no, prompt, filled, keys, _, t in questions:
        if t == "order" or not keys or len(filled) < 2:
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
    for line_no, _, filled, _, _, _ in questions:
        opt_lines.setdefault(frozenset(lowered(a) for a in filled), []).append(line_no)
    for lines in opt_lines.values():
        if len(lines) >= 2:
            e(f"rows {', '.join(map(str, lines))}: identical option set - answering one solves the other(s)")

    pair_shared: dict[tuple[int, int], int] = Counter()
    for (l1, _, f1, _, _, _), (l2, _, f2, _, _, _) in itertools.combinations(questions, 2):
        shared = sum(1 for a in f2 if lowered(a) in {lowered(x) for x in f1})
        if shared:
            pair_shared[(l1, l2)] = shared
    for (l1, l2), shared in sorted(pair_shared.items()):
        if shared >= 3:
            e(f"rows {l1} & {l2}: share {shared} of their options - items are correlated, rewrite distractors")
        elif shared == 2:
            w(f"rows {l1} & {l2}: share 2 options - check that neither gives the other away")

    key_lines: dict[str, list[int]] = {}
    for line_no, _, filled, keys, _, t in questions:
        tested = keys if t != "order" else list(range(1, len(filled) + 1))
        for i in tested:
            if 1 <= i <= len(filled):
                key_lines.setdefault(lowered(filled[i - 1]), []).append(line_no)
    for text, lines in key_lines.items():
        if len(lines) >= 3:
            e(f"'{text}' is the correct answer in {len(lines)} questions ({', '.join(map(str, lines))}) - one fact per question")
        elif len(lines) == 2:
            w(f"'{text}' is the correct answer in both rows {lines[0]} and {lines[1]} - make the second item test something else")

    report(args.file, len(questions), type_counts, [counts.get(p, 0) for p in (1, 2, 3, 4)], errors, warnings, args.strict)
    if errors or (args.strict and warnings):
        return 1
    return 0


def report(path: str, n: int, type_counts: Counter, counts: list[int], errors: list[str], warnings: list[str], strict: bool) -> None:
    for msg in errors:
        print(f"error:   {msg}")
    for msg in warnings:
        print(f"warning: {msg}")
    if n:
        dist = " ".join(f"pos{i}={c}" for i, c in enumerate(counts, start=1))
        tc = " · ".join(f"{type_counts[t]} {t}" for t in ("single", "multi", "order") if type_counts.get(t))
        print(f"{n} questions ({tc}) · correct positions of single-choice: {dist}")
    verdict = "OK" if not errors and not (strict and warnings) else "FAILED"
    print(f"{verdict}: {len(errors)} error(s), {len(warnings)} warning(s) in {path}")


if __name__ == "__main__":
    sys.exit(main())
