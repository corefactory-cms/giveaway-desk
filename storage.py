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
MONEY_FIELDS = ("award_cash", "award_voucher")
LIST_PRIZES = ("award_items", "award_vouchers")
PRIZE_FIELDS = (*MONEY_FIELDS, *LIST_PRIZES)
VOUCHER_KINDS = ("지역상품권", "쿠폰", "기타")
PRIVATE_FIELDS = ("status", *PRIZE_FIELDS, "memo")
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
        raise ValueError("JSON 파일은 최대 5 MiB입니다.")
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
        columns = {column["name"] for column in db.execute("PRAGMA table_info(giveaways)")}
        for field in LIST_PRIZES:
            if field not in columns:
                db.execute(f"ALTER TABLE giveaways ADD COLUMN {field} TEXT NOT NULL DEFAULT '[]'")
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
                for field in LIST_PRIZES:
                    item[field] = json.loads(row[field])
            result.append(item)
    return result


def validate_prize_list(items, *, voucher):
    if not isinstance(items, list) or len(items) > 100:
        raise ValueError("권종과 실물 경품 목록은 각각 한 행사에 최대 100종까지 입력할 수 있습니다.")
    normalized = []
    seen = set()
    required = {"name", "quantity", "kind"} if voucher else {"name", "quantity"}
    allowed = required | {"face_value"} if voucher else required
    for item in items:
        if not isinstance(item, dict) or not required <= item.keys() <= allowed:
            raise ValueError("경품의 이름(name), 수량(quantity), 상품권·쿠폰의 분류(kind)를 확인해 주세요.")
        name, quantity = item["name"], item["quantity"]
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 200:
            raise ValueError("경품 이름을 1~200자로 입력하세요.")
        if type(quantity) is not int or not 1 <= quantity <= 999999:
            raise ValueError("경품 수량을 1~999999 사이의 정수로 입력하세요.")
        entry = {"name": name.strip(), "quantity": quantity}
        if voucher:
            kind, value = item["kind"], item.get("face_value")
            if kind not in VOUCHER_KINDS:
                raise ValueError("권종 분류는 지역상품권, 쿠폰, 기타 중 하나여야 합니다.")
            entry["kind"] = kind
            if value is not None:
                if type(value) is not int or not 0 < value < 2**53:
                    raise ValueError("액면가는 한 장당 1원 이상의 정수로 입력하고 모르면 비워 주세요.")
                entry["face_value"] = value
        key = (entry.get("kind"), normalize(name), entry.get("face_value"))
        if key in seen:
            raise ValueError(f"같은 경품은 수량을 합쳐 한 번만 입력하세요: {entry['name']}")
        seen.add(key)
        normalized.append(entry)
    return normalized


def validate_prizes(fields):
    for key in MONEY_FIELDS:
        if key in fields and (type(fields[key]) is not int or not 0 <= fields[key] < 2**53):
            raise ValueError("당첨 금액은 0원 이상의 원 단위 정수로 입력하세요.")
    for key in LIST_PRIZES:
        if key in fields:
            fields[key] = validate_prize_list(fields[key], voucher=key == "award_vouchers")


def merge_vouchers(saved, incoming):
    # Group first so a multi-denomination upload gives the same result in any row order.
    groups = {}
    for new in incoming:
        groups.setdefault((new["kind"], normalize(new["name"])), []).append(new)
    merged = list(saved)
    for group, additions in groups.items():
        old = {v.get("face_value"): i for i, v in enumerate(merged)
               if (v["kind"], normalize(v["name"])) == group}
        denominations = {v.get("face_value") for v in additions}
        for new in additions:
            face = new.get("face_value")
            index = old.get(face)
            if index is None and old:
                if face is None or None in old:
                    if len(old) != 1 or len(denominations) != 1:
                        raise ValueError(f"{new['name']}의 액면가가 불분명합니다. 행사 상세에서 권종을 확인해 주세요.")
                    index = next(iter(old.values()))
            if index is None:
                merged.append(new)
            else:
                match = merged[index]
                if match["quantity"] != new["quantity"]:
                    raise ValueError(f"{new['name']}의 기존 수량과 다릅니다. 행사 상세에서 확인해 주세요.")
                if face is not None and "face_value" not in match:
                    merged[index] = {**match, "face_value": face}
    if len(merged) > 100:
        raise ValueError("한 행사에 등록할 수 있는 권종은 최대 100종입니다.")
    return merged


def save_record(change):
    if not isinstance(change, dict) or not isinstance(change.get("id"), str):
        raise ValueError("수정할 행사의 id가 필요합니다.")
    updates = {key: change[key] for key in PRIVATE_FIELDS if key in change}
    if set(change) - {"id", *PRIVATE_FIELDS} or not updates:
        raise ValueError("응모 상태, 당첨 경품, 메모를 수정할 수 있습니다.")
    if "status" in updates and updates["status"] not in STATUSES:
        raise ValueError("응모 상태를 확인해 주세요.")
    if "memo" in updates and (not isinstance(updates["memo"], str) or len(updates["memo"]) > 8000):
        raise ValueError("메모는 8,000자 이내로 입력하세요.")
    validate_prizes(updates)
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT status FROM giveaways WHERE id=?", (change["id"],)).fetchone()
        if row is None:
            raise ValueError("수정할 행사를 찾을 수 없습니다.")
        if updates.get("status", row["status"]) != "당첨":
            if any(updates.get(k) for k in PRIZE_FIELDS):
                raise ValueError("당첨된 행사의 경품만 기록할 수 있습니다.")
            if "status" in updates:
                updates.update(award_cash=0, award_voucher=0, award_items=[], award_vouchers=[])
        for key in LIST_PRIZES:
            if key in updates:
                updates[key] = json.dumps(updates[key], ensure_ascii=False)
        setters = ", ".join(f"{key}=?" for key in updates)
        db.execute(f"UPDATE giveaways SET {setters} WHERE id=?", (*updates.values(), change["id"]))
    return {"saved": True}


def confirmed_record(kind, record, db):
    if not isinstance(record, dict) or "status" not in record:
        raise ValueError("행사 id와 확인된 상태(status)가 필요합니다.")
    row_id = record.get("id")
    if not isinstance(row_id, str) or not ID_PATTERN.fullmatch(row_id):
        raise ValueError("기존 행사 목록의 id를 넣어 주세요.")
    allowed = {"id", "status"}
    if kind == "results":
        allowed.update(PRIZE_FIELDS)
    extra = record.keys() - allowed
    if extra:
        raise ValueError("개인 기록 양식에 없는 필드입니다: " + ", ".join(sorted(extra)))
    status = record["status"]
    statuses = ("응모",) if kind == "applications" else ("당첨", "미당첨")
    if status not in statuses:
        raise ValueError("이 파일의 status에는 " + " 또는 ".join(statuses) + "를 입력하세요.")
    prizes = {key: record[key] for key in PRIZE_FIELDS if record.get(key) is not None}
    validate_prizes(prizes)
    if status != "당첨" and any(prizes.values()):
        raise ValueError("당첨된 행사의 경품만 기록할 수 있습니다.")
    row = db.execute(
        "SELECT public_info,status,award_cash,award_voucher,award_items,award_vouchers FROM giveaways WHERE id=?",
        (row_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"목록에 없는 행사 id입니다: {row_id}. 공개 행사부터 추가해 주세요.")
    name = json.loads(row["public_info"])["name"]
    previous = row["status"]
    saved = {"status": previous, "award_cash": row["award_cash"], "award_voucher": row["award_voucher"],
             **{key: json.loads(row[key]) for key in LIST_PRIZES}}
    after = dict(saved)
    if previous in ("당첨", "미당첨") and previous != status:
        if kind == "results":
            raise ValueError(f"{name}의 기존 결과({previous})와 다릅니다. 행사 상세에서 먼저 확인해 주세요.")
        status = previous  # An older application receipt is compatible with a later result.
    after["status"] = status
    if kind == "results" and status == "당첨":
        # Older versions could leave hidden prize amounts behind on a non-winning record.
        if previous != "당첨":
            after.update(award_cash=0, award_voucher=0, award_items=[], award_vouchers=[])
        for key in MONEY_FIELDS:
            if not prizes.get(key):
                continue
            if after[key] and prizes[key] != after[key]:
                raise ValueError(f"{name}의 기존 당첨 금액과 다릅니다. 행사 상세에서 금액을 확인해 주세요.")
            after[key] = prizes[key]
        if prizes.get("award_vouchers"):
            after["award_vouchers"] = merge_vouchers(after["award_vouchers"], prizes["award_vouchers"])
        if prizes.get("award_items"):
            existing = {normalize(item["name"]): item for item in after["award_items"]}
            for item in prizes["award_items"]:
                key = normalize(item["name"])
                if key in existing and item["quantity"] != existing[key]["quantity"]:
                    raise ValueError(f'{name}의 기존 {item["name"]} 수량과 다릅니다. 행사 상세에서 확인해 주세요.')
                existing.setdefault(key, item)
            if len(existing) > 100:
                raise ValueError(f"{name}의 실물 경품이 최대 100종을 초과합니다.")
            after["award_items"] = list(existing.values())
    return {"id": row_id, "name": name, "previous_status": previous, **after, "changed": saved != after}


def import_records(payload, *, preview=False):
    if not isinstance(payload, dict) or payload.keys() != {"kind", "records"}:
        raise ValueError("개인 기록 파일에는 kind와 records 배열이 필요합니다.")
    kind, records = payload["kind"], payload["records"]
    if kind not in ("applications", "results"):
        raise ValueError("kind는 applications(신청) 또는 results(결과)여야 합니다.")
    if not isinstance(records, list) or not 1 <= len(records) <= 3000:
        raise ValueError("기록은 한 번에 1~3,000건을 넣을 수 있습니다.")
    seen = set()
    reviewed = []
    with closing(connect()) as db, db:
        db.execute("BEGIN" if preview else "BEGIN IMMEDIATE")
        for number, record in enumerate(records, 1):
            try:
                item = confirmed_record(kind, record, db)
                if item["id"] in seen:
                    raise ValueError("같은 행사 id는 한 파일에 한 번만 넣어 주세요.")
            except ValueError as exc:
                raise ValueError(f"{number}번째 기록 · {exc}") from exc
            seen.add(item["id"])
            reviewed.append(item)
            if item["changed"] and not preview:
                db.execute(
                    "UPDATE giveaways SET status=?,award_cash=?,award_voucher=?,award_items=?,award_vouchers=? WHERE id=?",
                    (item["status"], item["award_cash"], item["award_voucher"],
                     json.dumps(item["award_items"], ensure_ascii=False),
                     json.dumps(item["award_vouchers"], ensure_ascii=False), item["id"]),
                )
    changed = sum(item["changed"] for item in reviewed)
    return {"changed": changed, "unchanged": len(reviewed) - changed, "records": reviewed}
