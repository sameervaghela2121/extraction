"""The business day is the India day (IST), whatever time zone a device or server is in.
Naive datetimes are read as IST: the site's system time zone is Asia/Kolkata."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from royal_touche.errors import RTValidation

IST = ZoneInfo("Asia/Kolkata")


def as_ist(value: datetime | date | str) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value.strip().replace(" ", "T", 1))
    elif isinstance(value, date) and not isinstance(value, datetime):
        value = datetime(value.year, value.month, value.day)
    return value.replace(tzinfo=IST) if value.tzinfo is None else value.astimezone(IST)


def as_system(value: datetime | date | str) -> datetime:
    """For storing in a Frappe Datetime field: IST wall-clock time, without a zone."""
    return as_ist(value).replace(tzinfo=None)


def ist_day(value: datetime | date | str) -> date:
    return as_ist(value).date()


def check_operator_date(transaction_date, recorded_at, now: datetime | None = None) -> None:
    """Today or yesterday, never ahead. "Today" is the day the movement was saved on the
    tablet (recorded_at); the future check is against the server's own today, so a tablet
    clock running ahead cannot get past it (backend/src/validators/stock.validators.ts)."""
    day = ist_day(transaction_date)
    if day > ist_day(now or datetime.now(IST)):
        raise RTValidation("The date cannot be in the future")
    if recorded_at:
        saved_on = ist_day(recorded_at)
        if day not in (saved_on, saved_on - timedelta(days=1)):
            raise RTValidation("The date must be today or yesterday")
