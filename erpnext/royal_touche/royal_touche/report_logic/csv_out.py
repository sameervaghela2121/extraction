"""CSV the way the Node reports write it: a byte-order mark, CRLF lines, a guard against
spreadsheet formulas, and numbers printed as JavaScript prints them."""

import math
import re
from decimal import Decimal

# Excel reads UTF-8 without it as the local code page and garbles Hindi and Gujarati text.
BOM = "﻿"

_FORMULA = re.compile(r"^[=+\-@\t\r]")
_NEEDS_QUOTES = re.compile(r'[",\r\n]')


def js_number(value) -> str:
    """String(value) in JavaScript: 100.0 prints 100, 0.3 prints 0.3, 1e-7 prints 1e-7."""
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    # repr gives the shortest digits that read back as the same double, as JavaScript does.
    _, digit_tuple, exponent = Decimal(repr(abs(value))).as_tuple()
    digits = "".join(map(str, digit_tuple))
    point = len(digits) + exponent  # where the decimal point falls, counted from the first digit
    digits = digits.rstrip("0")
    k = len(digits)
    if k <= point <= 21:
        text = digits + "0" * (point - k)
    elif 0 < point <= 21:
        text = f"{digits[:point]}.{digits[point:]}"
    elif -6 < point <= 0:
        text = f"0.{'0' * -point}{digits}"
    else:
        e = point - 1
        mantissa = digits[0] + (f".{digits[1:]}" if k > 1 else "")
        text = f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + text


def csv_cell(value) -> str:
    """Quotes what CSV needs quoted, and stops a spreadsheet running a typed value as a
    formula: remarks and notes are free text from the floor. Numbers pass through as numbers."""
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return js_number(value)
    text = str(value)
    safe = f"'{text}" if _FORMULA.match(text) else text
    if _NEEDS_QUOTES.search(safe):
        return '"' + safe.replace('"', '""') + '"'
    return safe


def to_csv(header, lines) -> str:
    """The header and lines, each cell through csv_cell, BOM first and CRLF after every line."""
    body = [",".join(csv_cell(cell) for cell in header)]
    body.extend(",".join(csv_cell(cell) for cell in line) for line in lines)
    return BOM + "\r\n".join(body) + "\r\n"
