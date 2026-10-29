"""Validate the original InfLink-rs release archive before embedding it in FC Setup."""
import json
import sys
import zipfile
from pathlib import Path


def validate(package: Path) -> None:
    if not package.is_file() or package.stat().st_size < 1024:
        raise ValueError("Missing/empty official InfLink-rs.plugin")
    if package.stat().st_size > 150 * 1024 * 1024:
        raise ValueError("InfLink-rs plugin package exceeds the safety limit")
    with zipfile.ZipFile(package) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise ValueError(f"Corrupted ZIP file: {corrupt}")
        names = set(archive.namelist())
        if not {"manifest.json", "index.js", "backend.dll"}.issubset(names):
            raise ValueError("InfLink-rs manifest/index.js/backend.dll missing")
        data = json.loads(archive.read("manifest.json"))
        if data.get("name") != "InfLink-rs":
            raise ValueError("Unexpected plugin name")
        if not isinstance(data.get("version"), str) or not data["version"]:
            raise ValueError("No valid InfLink-rs version")
        print(f"InfLink-rs v{data['version']} validated; {len(names)} entries")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python installer/validate-inflink.py InfLink-rs.plugin")
    validate(Path(sys.argv[1]))
