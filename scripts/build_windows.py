"""Build the offline Windows x64 release from public source files."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "GiveawayDesk-Windows-x64.zip"
PYTHON_URL = "https://www.python.org/ftp/python/3.14.9/python-3.14.9-embed-amd64.zip"
# SHA-256 from the official release's .zip.sigstore messageSignature.messageDigest.
PYTHON_SHA256 = "3c01d7cfc666f746a6f064f60fb2156ab0ec464d3d738ab796371a46a9bb24a2"
PUBLIC_FILES = (
    "AGENTS.md",
    "LICENSE",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "agent.py",
    "app.py",
    "data/seed.json",
    "docs/screen.png",
    "research.schema.json",
    "records.schema.json",
    "scripts/build_windows.py",
    "storage.py",
    "web/app.css",
    "web/app.js",
    "web/agents.js",
    "web/inventory.js",
    "web/inventory.css",
    "web/records.js",
    "web/records.css",
    "web/fonts/PretendardVariable.woff2",
    "web/fonts/OFL.txt",
    "web/index.html",
    "실행.cmd",
)


def runtime_files(cached_path):
    if cached_path:
        bundle = cached_path.read_bytes()
    else:
        with urlopen(PYTHON_URL, timeout=60) as response:
            bundle = response.read()
    if hashlib.sha256(bundle).hexdigest() != PYTHON_SHA256:
        raise ValueError("Downloaded Python runtime does not match its published SHA-256.")

    with ZipFile(io.BytesIO(bundle)) as runtime:
        return {f"runtime/{name}": runtime.read(name) for name in runtime.namelist()}


def build(cached_runtime, output):
    files = {}
    for name in PUBLIC_FILES:
        data = (ROOT / name).read_bytes()
        if not name.endswith((".png", ".woff2")) and name != "web/fonts/OFL.txt":
            data = data.replace(b"\r\n", b"\n")
        files[name] = data.replace(b"\n", b"\r\n") if name.endswith(".cmd") else data
    examples = json.loads(files["data/seed.json"])["items"]
    if len(examples) != 1 or examples[0].get("id") != "example-reading-quiz" or examples[0].get("url") != "https://example.com/":
        raise ValueError("The public release must contain only the fictional example giveaway.")
    files.update(runtime_files(cached_runtime))

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        with ZipFile(temp_path, "w") as archive:
            for name in sorted(files):
                entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, files[name], compress_type=ZIP_DEFLATED, compresslevel=9)
        with ZipFile(temp_path) as archive:
            if archive.testzip() is not None:
                raise ValueError("The release archive could not be verified.")
        os.replace(temp_path, output)
    finally:
        temp_path.unlink(missing_ok=True)
    print(f"{hashlib.sha256(output.read_bytes()).hexdigest()}  {output.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-zip", type=Path, help="Use an already downloaded official Python ZIP")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="Destination archive")
    args = parser.parse_args()
    build(args.runtime_zip, args.output)
