"""API call cache — minimizes external API calls by caching responses locally.

Stores cached data as JSON files in a local directory with a log of all API calls.
Cache keys are derived from (service, lat, lon, date_range, params).
"""

import hashlib
import json
import logging
import os
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

CACHE_DIR = Path(os.environ.get("KRISHITWIN_CACHE_DIR", "/tmp/krishitwin_cache"))
LOG_FILE = CACHE_DIR / "api_call_log.jsonl"

# Cache TTL in seconds (default: 6 hours for weather, 24h for soil/elevation)
DEFAULT_TTL = 6 * 3600


def _ensure_cache_dir():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_key(service: str, **params) -> str:
    """Generate a deterministic cache key from service name + params."""
    raw = json.dumps({"service": service, **params}, sort_keys=True)
    return hashlib.md5(raw.encode()).hexdigest()


def _log_call(service: str, cache_hit: bool, params: dict):
    """Append to the API call log (JSONL format)."""
    _ensure_cache_dir()
    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "service": service,
        "cache_hit": cache_hit,
        "params": params,
    }
    try:
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.debug("Failed to write API log: %s", e)


def get_cached(service: str, ttl: int = DEFAULT_TTL, **params) -> dict | None:
    """Check if cached data exists and is fresh enough.

    Returns the cached data dict or None if cache miss/expired.
    """
    _ensure_cache_dir()
    key = _cache_key(service, **params)
    cache_file = CACHE_DIR / f"{service}_{key}.json"

    if not cache_file.exists():
        _log_call(service, cache_hit=False, params=params)
        return None

    try:
        data = json.loads(cache_file.read_text())
        cached_at = datetime.fromisoformat(data.get("_cached_at", "2000-01-01"))
        age = (datetime.utcnow() - cached_at).total_seconds()

        if age > ttl:
            logger.info("Cache expired for %s (age=%.0fs, ttl=%ds)", service, age, ttl)
            _log_call(service, cache_hit=False, params=params)
            return None

        logger.info("Cache HIT for %s (age=%.0fs)", service, age)
        _log_call(service, cache_hit=True, params=params)
        return data.get("payload")
    except Exception as e:
        logger.debug("Cache read failed for %s: %s", service, e)
        _log_call(service, cache_hit=False, params=params)
        return None


def set_cached(service: str, payload: dict, **params):
    """Store data in cache."""
    _ensure_cache_dir()
    key = _cache_key(service, **params)
    cache_file = CACHE_DIR / f"{service}_{key}.json"

    data = {
        "_cached_at": datetime.utcnow().isoformat(),
        "_service": service,
        "_params": params,
        "payload": payload,
    }
    try:
        cache_file.write_text(json.dumps(data))
        logger.info("Cached %s (%d bytes)", service, len(json.dumps(payload)))
    except Exception as e:
        logger.debug("Cache write failed for %s: %s", service, e)


def get_call_stats() -> dict:
    """Return API call statistics from the log."""
    _ensure_cache_dir()
    if not LOG_FILE.exists():
        return {"total_calls": 0, "cache_hits": 0, "cache_misses": 0, "by_service": {}}

    total = 0
    hits = 0
    by_service: dict[str, dict[str, int]] = {}

    try:
        for line in LOG_FILE.read_text().strip().split("\n"):
            if not line:
                continue
            entry = json.loads(line)
            total += 1
            svc = entry.get("service", "unknown")
            if svc not in by_service:
                by_service[svc] = {"calls": 0, "hits": 0}
            by_service[svc]["calls"] += 1
            if entry.get("cache_hit"):
                hits += 1
                by_service[svc]["hits"] += 1
    except Exception:
        pass

    return {
        "total_calls": total,
        "cache_hits": hits,
        "cache_misses": total - hits,
        "hit_rate_pct": round(hits / max(total, 1) * 100, 1),
        "by_service": by_service,
    }
