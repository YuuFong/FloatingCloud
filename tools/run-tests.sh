#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node --check "$ROOT/plugin/core.js"
node --check "$ROOT/plugin/main.js"
node --test "$ROOT/tools/core.test.js"
python "$ROOT/tools/test_desktop.py"
python "$ROOT/tools/test_plugin_mock.py"
