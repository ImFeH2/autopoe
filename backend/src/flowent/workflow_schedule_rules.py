from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class CronField:
    values: frozenset[int]
    wildcard: bool


def parse_cron_field(
    field: str, minimum: int, maximum: int, *, weekday: bool = False
) -> CronField:
    values: set[int] = set()
    for part in field.split(","):
        pieces = part.split("/")
        if len(pieces) > 2:
            raise ValueError("Timer cron expression is invalid.")
        range_part = pieces[0]
        try:
            step = int(pieces[1]) if len(pieces) == 2 else 1
        except ValueError as error:
            raise ValueError("Timer cron expression is invalid.") from error
        if step < 1:
            raise ValueError("Timer cron expression is invalid.")
        if range_part == "*":
            start, end = minimum, maximum
        else:
            bounds = range_part.split("-")
            if len(bounds) > 2:
                raise ValueError("Timer cron expression is invalid.")
            try:
                start = int(bounds[0])
                end = int(bounds[1]) if len(bounds) == 2 else start
            except ValueError as error:
                raise ValueError("Timer cron expression is invalid.") from error
            if start < minimum or end > maximum or start > end:
                raise ValueError("Timer cron expression is invalid.")
        for value in range(start, end + 1, step):
            values.add(0 if weekday and value == 7 else value)
    if not values:
        raise ValueError("Timer cron expression is invalid.")
    complete_values = set(range(minimum, maximum + 1))
    if weekday:
        complete_values = {0 if value == 7 else value for value in complete_values}
    return CronField(frozenset(values), values == complete_values)


def next_cron_run_at(expression: str, now: datetime) -> datetime:
    parts = expression.strip().split()
    if len(parts) != 5:
        raise ValueError("Timer cron expression is invalid.")
    minute = parse_cron_field(parts[0], 0, 59)
    hour = parse_cron_field(parts[1], 0, 23)
    day = parse_cron_field(parts[2], 1, 31)
    month = parse_cron_field(parts[3], 1, 12)
    weekday = parse_cron_field(parts[4], 0, 7, weekday=True)
    allowed_times = [
        (hour_value, minute_value)
        for hour_value in sorted(hour.values)
        for minute_value in sorted(minute.values)
    ]
    for day_offset in range(146_097):
        candidate_date = now.date() + timedelta(days=day_offset)
        if candidate_date.month not in month.values:
            continue
        day_matches = candidate_date.day in day.values
        weekday_matches = (candidate_date.weekday() + 1) % 7 in weekday.values
        calendar_matches = (
            day_matches and weekday_matches
            if day.wildcard or weekday.wildcard
            else day_matches or weekday_matches
        )
        if not calendar_matches:
            continue
        for hour_value, minute_value in allowed_times:
            candidate = datetime(
                candidate_date.year,
                candidate_date.month,
                candidate_date.day,
                hour_value,
                minute_value,
                tzinfo=now.tzinfo,
            )
            if candidate > now:
                return candidate
    raise ValueError("Timer cron expression has no upcoming run.")
