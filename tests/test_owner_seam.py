"""The cache is only read through ``classroom_cache.owned``."""

from __future__ import annotations

import re
from pathlib import Path

# A raw select/get on a cache model skips the owner filter.
RAW = re.compile(r"(?<![\w.])select\(\s*Classroom|session\.get\(\s*Classroom|(?<![\w.])select\(\s*model\b")

# The only deliberate cross-owner reads, each documented where it lives.
ALLOWED = {
    "src/repositories/classroom_cache.py": 1,  # owners_of_course: ids only, for push fan-out
    "src/repositories/backup_jobs.py": 1,      # active_sync: "is any sync running?" is global
}


def test_no_raw_queries_on_owner_scoped_tables():
    root = Path(__file__).resolve().parent.parent
    found = {}
    for path in sorted((root / "src").rglob("*.py")):
        hits = len(RAW.findall(path.read_text()))
        if hits:
            found[str(path.relative_to(root))] = hits
    assert found == ALLOWED
