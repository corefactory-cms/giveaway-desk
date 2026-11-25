"""Review public giveaways or import personal receipts on the user's PC."""

import argparse
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import storage


def main():
    parser = argparse.ArgumentParser(description="응모수첩 공개 행사·개인 기록 도구")
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("paths", help="사용자 PC의 자료 폴더와 데이터베이스 경로")
    catalog = commands.add_parser("catalog", help="기존 공개 행사 목록")
    catalog.add_argument("--output", type=Path, help="UTF-8 JSON 파일로 내보내기")
    for command, help_text in (
        ("validate", "공개 행사 변경 미리보기"), ("import", "공개 행사 조사 결과 반영"),
        ("personal-validate", "개인 신청·당첨 기록의 변경 미리보기"),
        ("personal-import", "개인 신청·당첨 기록을 내 PC에 반영"),
    ):
        sub = commands.add_parser(command, help=help_text)
        sub.add_argument("file", type=Path)
    args = parser.parse_args()
    if args.action == "paths":
        result = storage.paths()
    else:
        storage.initialize()
        if args.action == "catalog":
            result = {"items": storage.catalog()}
        elif args.action.startswith("personal-"):
            result = storage.import_records(storage.load_file(args.file), preview=args.action == "personal-validate")
        else:
            result = storage.import_events(storage.load_file(args.file), preview=args.action == "validate")
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if getattr(args, "output", None):
        args.output.write_text(output + "\n", encoding="utf-8")
        return
    sys.stdout.reconfigure(encoding="utf-8")
    print(output)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, RecursionError) as exc:
        sys.stderr.reconfigure(encoding="utf-8")
        sys.exit(str(exc))
