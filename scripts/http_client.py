"""Shared HTTP client for PathoMap build scripts.

Provides unified HTTP infrastructure with caching, rate limiting, and retry
logic. Used by both protein enrichment (api_clients.py) and pathogen enrichment
(build_pathogens.py).

Features:
- Configurable rate limiting (fixed delay or host-based throttling)
- On-disk caching with refresh and offline modes
- Retry logic with exponential backoff and Retry-After header support
- Graceful degradation with ApiError exception

Usage (from a build script)::

    from http_client import http_json, http_text, ApiError

    # With host-based rate limiting (default)
    args = argparse.Namespace(refresh=False, no_network=False)
    data = http_json(url, args, cache_path)

    # With fixed rate limiting (for APIs without host-based limits)
    data = http_json(url, args, cache_path, rate_limit=0.34)
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional


class ApiError(RuntimeError):
    """Raised when an HTTP request fails after retries or is unavailable offline."""


def slug(value: str) -> str:
    """Turn a free-text string into a filesystem-safe cache file name."""
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-") or "empty"


def read_json(path: Path) -> Any:
    """Read and parse a JSON file."""
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    """Write a JSON file with standard formatting."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _host(url: str) -> str:
    """Extract the hostname from a URL."""
    return urllib.parse.urlparse(url).netloc


# Per-host rate limits (minimum seconds between requests)
# These are conservative operating choices based on provider guidance
RATE_LIMITS = {
    "rest.uniprot.org": 0.05,   # ~20 req/s (UniProt allows more, but we stay conservative)
    "www.ebi.ac.uk": 0.10,     # ~10 req/s (InterPro/Pfam don't specify hard limits)
    "string-db.org": 1.00,     # 1 req/s (per STRING's explicit recommendation)
    "eutils.ncbi.nlm.nih.gov": 0.34,  # NCBI E-Utilities (custom rate limit for pathogen builds)
    "api.ncbi.nlm.nih.gov": 0.34,     # NCBI Datasets API (custom rate limit for pathogen builds)
}

# Last request timestamp per host, used for throttling
_last_request_at: dict[str, float] = {}


def _throttle(url: str, rate_limit: Optional[float] = None) -> None:
    """Sleep if needed to stay under rate limits.

    Args:
        url: The URL being requested
        rate_limit: Fixed delay in seconds. If None, uses host-based RATE_LIMITS.
    """
    if rate_limit is not None:
        # Fixed rate limiting (for APIs without host-based limits)
        now = time.monotonic()
        last = _last_request_at.get("fixed", 0.0)
        wait = rate_limit - (now - last)
        if wait > 0:
            time.sleep(wait)
        _last_request_at["fixed"] = time.monotonic()
    else:
        # Host-based rate limiting
        host = _host(url)
        interval = RATE_LIMITS.get(host, 0.1)
        now = time.monotonic()
        last = _last_request_at.get(host, 0.0)
        wait = interval - (now - last)
        if wait > 0:
            time.sleep(wait)
        _last_request_at[host] = time.monotonic()


def _parse_retry_after(headers: dict[str, str]) -> Optional[float]:
    """Parse Retry-After header to seconds, or None if invalid/missing.

    Supports both delay-seconds and HTTP-date formats per RFC 7231.
    """
    retry_after = headers.get("Retry-After")
    if not retry_after:
        return None

    # Try parsing as integer seconds
    try:
        return float(retry_after)
    except ValueError:
        pass

    # Try parsing as HTTP-date (RFC 1123)
    try:
        from email.utils import parsedate_to_datetime
        retry_date = parsedate_to_datetime(retry_after)
        if retry_date:
            delay = (retry_date.timestamp() - time.time())
            return max(0.0, delay)
    except Exception:
        pass

    return None


def http_text(
    url: str,
    args: argparse.Namespace,
    cache_path: Optional[Path] = None,
    rate_limit: Optional[float] = None,
    user_agent: str = "PathoMap/2.0 (build script; contact: local development)",
) -> str:
    """Fetch text from URL with caching, rate limiting, and retry logic.

    Args:
        url: The URL to fetch
        args: Namespace with refresh and no_network boolean flags
        cache_path: Path to cache file. If None, caching is disabled.
        rate_limit: Fixed delay in seconds. If None, uses host-based RATE_LIMITS.
        user_agent: User-Agent header value

    Returns:
        The response text

    Raises:
        ApiError: If request fails after retries or is unavailable offline
    """
    refresh = bool(getattr(args, "refresh", False))
    no_network = bool(getattr(args, "no_network", False))

    # Return cached response if available and not refreshing
    if cache_path is not None and cache_path.exists() and not refresh:
        return cache_path.read_text(encoding="utf-8")

    # Fail if network disabled and cache missing
    if no_network:
        raise ApiError(f"network access disabled and cache is missing: {cache_path}")

    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            _throttle(url, rate_limit)
            request = urllib.request.Request(url, headers={"User-Agent": user_agent})
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode("utf-8")

                # Cache the response
                if cache_path is not None:
                    cache_path.parent.mkdir(parents=True, exist_ok=True)
                    cache_path.write_text(text, encoding="utf-8")

                return text

        except urllib.error.HTTPError as exc:
            last_error = exc
            # Check for Retry-After header on 429 or 5xx errors
            if exc.code in (429, 502, 503, 504):
                retry_after = _parse_retry_after(dict(exc.headers))
                if retry_after is not None:
                    time.sleep(retry_after)
                    continue
            # Exponential backoff for other errors
            time.sleep(1.5 * (attempt + 1))

        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))

    raise ApiError(f"request failed: {url}\n{last_error}")


def http_json(
    url: str,
    args: argparse.Namespace,
    cache_path: Optional[Path] = None,
    rate_limit: Optional[float] = None,
    user_agent: str = "PathoMap/2.0 (build script; contact: local development)",
) -> dict:
    """Fetch JSON from URL with caching, rate limiting, and retry logic.

    Args:
        url: The URL to fetch
        args: Namespace with refresh and no_network boolean flags
        cache_path: Path to cache file. If None, caching is disabled.
        rate_limit: Fixed delay in seconds. If None, uses host-based RATE_LIMITS.
        user_agent: User-Agent header value

    Returns:
        The parsed JSON response as a dict

    Raises:
        ApiError: If request fails after retries or is unavailable offline
    """
    text = http_text(url, args, cache_path, rate_limit, user_agent)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ApiError(f"invalid JSON from {url}: {exc}") from exc
