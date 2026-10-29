"""Validate the unmodified BetterNCMII.dll (x64 PE DLL) before bundling."""
from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path


def validate(path: Path) -> None:
    if not path.is_file() or not 64 * 1024 <= path.stat().st_size <= 40 * 1024 * 1024:
        raise ValueError("Official BetterNCM x64 DLL is missing or has unexpected size")
    with path.open("rb") as stream:
        if stream.read(2) != b"MZ":
            raise ValueError("Not a Windows PE file")
        stream.seek(0x3c)
        pe_offset, = struct.unpack("<I", stream.read(4))
        if pe_offset < 64 or pe_offset > path.stat().st_size - 24:
            raise ValueError("Invalid PE header offset")
        stream.seek(pe_offset)
        if stream.read(4) != b"PE\\x00\\x00":
            raise ValueError("Invalid PE signature")
        machine, = struct.unpack("<H", stream.read(2))
        stream.seek(pe_offset + 22)
        flags, = struct.unpack("<H", stream.read(2))
        if machine != 0x8664 or not flags & 0x2000:
            raise ValueError(f"Not an x64 Windows DLL: machine=0x{machine:04x}, flags=0x{flags:04x}")
    checksum = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
    print(f"BetterNCM x64 DLL verified. SHA-256: {checksum}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python installer/validate-betterncm.py BetterNCMII.dll")
    validate(Path(sys.argv[1]))
