"""Giveaway catalog and private records for the local desktop application."""

from contextlib import closing
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import unicodedata
from urllib.parse import urlsplit
import uuid


ROOT = Path(__file__).resolve().parent
SEED = ROOT / "data" / "seed.json"
MAX_BYTES = 5 * 1024 * 1024
PUBLIC_FIELDS = (
    "name", "organizer", "category", "description", "prize", "deadline",
    "announcement", "announcement_note", "url", "result_url", "eligibility",
    "how_to", "checked_on",
)
REQUIRED = ("name", "organizer", "url", "checked_on")
PRIVATE_FIELDS = ("status", "award_cash", "award_voucher", "memo")
STATUSES = ("미응모", "응모", "당첨", "미당첨", "관심 없음")
ID_PATTERN = re.compile(r"[a-zA-Z0-9_-]{1,100}")


def app_home():
    override = os.environ.get("GIVEAWAY_DESK_HOME")
    if override:
        return Path(override).expanduser().resolve()
    if os.name == "nt":
        parent = os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
        return Path(parent) / "GiveawayDesk"
    parent = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(parent) / "giveaway-desk"


def paths():
    return {"data_dir": str(app_home()), "database": str(app_home() / "giveaways.sqlite3")}


def today():
    return datetime.now(timezone(timedelta(hours=9))).date().isoformat()


def connect():
    app_home().mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(paths()["database"], timeout=15)
    connection.row_factory = sqlite3.Row
    return connection


def normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def load_file(path):
    with path.open("rb") as source:
        raw = source.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("리서치 파일은 최대 5 MiB입니다.")
    return json.loads(raw.decode("utf-8-sig"))


def valid_url(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme in ("https", "http") and parsed.hostname
        and port != 0
        and parsed.username is None and parsed.password is None
        and not any(char.isspace() or ord(char) < 32 or char == "\\" for char in value)
    )


def validate_row(row):
    if not isinstance(row, dict) or row.get("entry_type") != "giveaway":
        raise ValueError("entry_type이 giveaway인 응모·추첨 행사만 가져올 수 있습니다.")
    allowed = {"entry_type", "id", *PUBLIC_FIELDS}
    extra = row.keys() - allowed
    if extra:
        raise ValueError("공개 행사 양식에 없는 필드입니다: " + ", ".join(sorted(extra)))
    if "id" in row and (not isinstance(row["id"], str) or not ID_PATTERN.fullmatch(row["id"])):
        raise ValueError("id에는 영문, 숫자, 밑줄과 하이픈을 쓸 수 있습니다.")
    values = {}
    for key in PUBLIC_FIELDS:
        value = row.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > 8000:
            raise ValueError(f"{key}에는 8,000자 이내의 텍스트를 입력하세요.")
        value = value.strip()
        if not value:
            continue
        if key in ("deadline", "announcement", "checked_on"):
            try:
                parsed_date = date.fromisoformat(value)
            except ValueError:
                raise ValueError(f"{key} 날짜는 YYYY-MM-DD 형식이어야 합니다.") from None
            if parsed_date.isoformat() != value:
                raise ValueError(f"{key} 날짜는 YYYY-MM-DD 형식이어야 합니다.")
        if key in ("url", "result_url") and not valid_url(value):
            raise ValueError(f"{key}에 공개 웹 주소를 입력하세요.")
        values[key] = value
    missing = [key for key in REQUIRED if key not in values]
    if missing:
        raise ValueError("필수 필드가 비어 있습니다: " + ", ".join(missing))
    return row.get("id"), values


def validate_payload(payload):
    if not isinstance(payload, dict) or set(payload) != {"items"}:
        raise ValueError("파일은 items 배열 하나를 담은 JSON 객체여야 합니다.")
    rows = payload["items"]
    if not isinstance(rows, list) or len(rows) > 3000:
        raise ValueError("items에는 한 번에 최대 3,000건을 넣을 수 있습니다.")
    values = []
    for i, row in enumerate(rows, 1):
        try:
            values.append(validate_row(row))
        except ValueError as exc:
            raise ValueError(f"{i}번째 행사 · {exc}") from exc
    return values


def initialize():
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute(
            """CREATE TABLE IF NOT EXISTS giveaways (
               id TEXT PRIMARY KEY, title_key TEXT NOT NULL, organizer_key TEXT NOT NULL,
               public_info TEXT NOT NULL, status TEXT NOT NULL DEFAULT '미응모',
               award_cash INTEGER NOT NULL DEFAULT 0, award_voucher INTEGER NOT NULL DEFAULT 0,
               memo TEXT NOT NULL DEFAULT '')"""
        )
        db.execute("CREATE INDEX IF NOT EXISTS identity_idx ON giveaways(title_key, organizer_key)")
        if SEED.is_file() and not db.execute("SELECT 1 FROM meta WHERE key='seed'").fetchone():
            merge(db, validate_payload(load_file(SEED)))
            db.execute("INSERT INTO meta VALUES ('seed', '1')")


def find_match(db, row_id, info):
    if row_id:
        match = db.execute("SELECT id, public_info FROM giveaways WHERE id=?", (row_id,)).fetchone()
        if match:
            return match
    matches = db.execute(
        "SELECT id, public_info FROM giveaways WHERE title_key=? AND organizer_key=?",
        (normalize(info["name"]), normalize(info["organizer"])),
    )
    candidates = []
    for row in matches:
        old = json.loads(row["public_info"])
        old_deadline, new_deadline = old.get("deadline"), info.get("deadline")
        if old_deadline and new_deadline:
            same_edition = old_deadline == new_deadline
        else:
            same_edition = old["url"] == info["url"]
        if same_edition:
            candidates.append(row)
    if len(candidates) > 1:
        raise ValueError(f'{info["name"]}과 일치하는 행사가 여러 건입니다. catalog의 id를 지정하세요.')
    return candidates[0] if candidates else None


def merge(db, rows):
    summary = {"added": 0, "updated": 0, "unchanged": 0}
    for proposed_id, info in rows:
        prior = find_match(db, proposed_id, info)
        if prior:
            saved = json.loads(prior["public_info"])
            combined = {**saved, **info}
            if info["checked_on"] < saved["checked_on"] or combined == saved:
                summary["unchanged"] += 1
                continue
            db.execute(
                "UPDATE giveaways SET title_key=?, organizer_key=?, public_info=? WHERE id=?",
                (normalize(combined["name"]), normalize(combined["organizer"]),
                 json.dumps(combined, ensure_ascii=False), prior["id"]),
            )
            summary["updated"] += 1
        else:
            db.execute(
                "INSERT INTO giveaways(id,title_key,organizer_key,public_info) VALUES(?,?,?,?)",
                (proposed_id or uuid.uuid4().hex, normalize(info["name"]),
                 normalize(info["organizer"]), json.dumps(info, ensure_ascii=False)),
            )
            summary["added"] += 1
    return summary


def import_events(payload, *, preview=False):
    rows = validate_payload(payload)
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        counts = merge(db, rows)
        if preview:
            db.rollback()
        return counts


def catalog(*, personal=False):
    projection = "id,public_info" + ("," + ",".join(PRIVATE_FIELDS) if personal else "")
    with closing(connect()) as db:
        result = []
        for row in db.execute(f"SELECT {projection} FROM giveaways ORDER BY rowid"):
            info = json.loads(row["public_info"])
            item = {key: info.get(key) for key in PUBLIC_FIELDS}
            item.update(id=row["id"], entry_type="giveaway")
            if personal:
                item.update({key: row[key] for key in PRIVATE_FIELDS})
            result.append(item)
    return result


def save_record(change):
    if not isinstance(change, dict) or not isinstance(change.get("id"), str):
        raise ValueError("수정할 행사의 id가 필요합니다.")
    updates = {key: change[key] for key in PRIVATE_FIELDS if key in change}
    if set(change) - {"id", *PRIVATE_FIELDS} or not updates:
        raise ValueError("응모 상태, 당첨 금액, 메모를 수정할 수 있습니다.")
    if "status" in updates and updates["status"] not in STATUSES:
        raise ValueError("응모 상태를 확인해 주세요.")
    if "memo" in updates and (not isinstance(updates["memo"], str) or len(updates["memo"]) > 8000):
        raise ValueError("메모는 8,000자 이내로 입력하세요.")
    for key in ("award_cash", "award_voucher"):
        if key in updates and (type(updates[key]) is not int or not 0 <= updates[key] < 2**53):
            raise ValueError("당첨 금액은 0원 이상의 원 단위 정수로 입력하세요.")
    setters = ", ".join(f"{key}=?" for key in updates)
    with closing(connect()) as db, db:
        cur = db.execute(f"UPDATE giveaways SET {setters} WHERE id=?", (*updates.values(), change["id"]))
        if not cur.rowcount:
            raise ValueError("수정할 행사를 찾을 수 없습니다.")
    return {"saved": True}
