"""Validate a release/test .plugin archive before publishing it as a CI artifact."""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path


def validate(package: Path) -> None:
    manifest_path = Path(__file__).resolve().parents[1] / "plugin" / "manifest.json"
    expected = json.loads(manifest_path.read_text(encoding="utf-8"))
    if package.name != f"FloatingCloud-v{expected['version']}.plugin":
        raise ValueError(f"Unexpected package name: {package.name}")
    if not package.is_file() or package.stat().st_size == 0:
        raise FileNotFoundError(f"Missing packaged plugin: {package}")

    with zipfile.ZipFile(package) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f"Corrupted ZIP member: {corrupt}")
        files = set(archive.namelist())
        required = {
            "manifest.json",
            "native.dll",
            "FloatingCloudLyrics.exe",
            "desktop.html",
            "update-check.js",
        }
        required.update(x["file"] for x in expected["injects"]["Main"])
        missing = required - files
        if missing:
            raise ValueError(f"Plugin package is missing files: {sorted(missing)}")

        bundled_manifest = json.loads(archive.read("manifest.json"))
        if bundled_manifest != expected or bundled_manifest.get("slug") != "floatingcloud-lite":
            raise ValueError("Packaged manifest does not match source manifest")
        if archive.getinfo("native.dll").file_size <= 0:
            raise ValueError("native.dll is empty")
        if archive.getinfo("FloatingCloudLyrics.exe").file_size <= 0:
            raise ValueError("FloatingCloudLyrics.exe is empty")
        print(f"Valid plugin v{expected['version']}: {len(files)} archive entries")

    digest = hashlib.sha256()
    with package.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    print(f"SHA-256: {digest.hexdigest()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python tools/validate-plugin-package.py <file.plugin>")
    validate(Path(sys.argv[1]))
