#!/usr/bin/env python3
"""Build public job feeds from official board APIs."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CATALOG = Path(__file__).resolve().parent / "companies.yaml"
OUT = Path(os.environ.get("FEED_OUT") or (ROOT / "site" / "public" / "feeds"))
UA = "JobAutopilot/1.0 (public board feed; +https://ajeenckya5.github.io/job-search/)"
SOURCES = {"greenhouse", "lever", "ashby", "remotive", "arbeitnow"}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def strip_html(raw: str) -> str:
    parser = _Text()
    parser.feed(raw or "")
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return text[:1500]


def years_required(title: str, description: str):
    match = re.search(r"(\d{1,2})\s*\+?\s*(?:years|yrs)\b", f"{title} {description}", re.I)
    if not match:
        return None
    value = int(match.group(1))
    return value if 0 <= value <= 40 else None


def sponsorship(text: str) -> str:
    blob = (text or "").lower()
    if re.search(r"unable to sponsor|cannot sponsor|no sponsorship|without sponsorship|must be authorized to work", blob):
        return "no"
    if re.search(r"visa sponsorship|will sponsor|sponsorship available|h-1b", blob):
        return "yes"
    return "unknown"


def remote_type(location: str) -> str:
    blob = (location or "").lower()
    if "hybrid" in blob:
        return "hybrid"
    if "remote" in blob or "anywhere" in blob:
        return "remote"
    return "onsite"


def country_of(location: str) -> str:
    blob = (location or "").lower()
    if not blob or "remote" in blob or "anywhere" in blob:
        return "Remote"
    if re.search(r"united states|\busa\b|\bu\.s\.|,\s*[a-z]{2}\b", blob):
        return "United States"
    return location.split(",")[-1].strip()[:40] or "Other"


def fetch_json(url: str, timeout: int = 25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    ctx = ssl.create_default_context()
    last_error = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
                return json.loads(res.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 429 and attempt == 0:
                time.sleep(2)
                continue
            raise
    raise last_error


def limited(rows, limit: int):
    rows = list(rows or [])
    if limit and limit > 0:
        return rows[:limit]
    return rows


def coverage_problems(jobs: list[dict]) -> list[str]:
    companies = {job.get("company") for job in jobs if job.get("company")}
    counts: dict[str, int] = {}
    for job in jobs:
        source = job.get("source") or ""
        counts[source] = counts.get(source, 0) + 1
    problems = []
    if len(companies) < 300:
        problems.append(f"companies {len(companies)} < 300")
    if len(jobs) < 2000:
        problems.append(f"jobs {len(jobs)} < 2000")
    for source in ("greenhouse", "lever", "ashby", "remotive", "arbeitnow"):
        if counts.get(source, 0) <= 0:
            problems.append(f"{source} returned 0")
    return problems


def job_record(**fields) -> dict:
    title = fields.get("title") or ""
    description = strip_html(fields.get("description") or "")
    location = fields.get("location") or ""
    url = fields.get("url") or ""
    if not url.startswith("https://"):
        return {}
    posted = fields.get("posted_at") or ""
    return {
        "id": fields["id"],
        "source": fields["source"],
        "company": fields.get("company") or "",
        "title": title,
        "department": fields.get("department") or "",
        "url": url,
        "location_raw": location,
        "locations": [{
            "city": "",
            "region": "",
            "country": country_of(location),
            "remote": "remote" if remote_type(location) == "remote" else "",
        }],
        "remote_type": remote_type(location),
        "posted_at": posted,
        "updated_at": fields.get("updated_at") or posted,
        "salary_min": fields.get("salary_min"),
        "salary_max": fields.get("salary_max"),
        "currency": fields.get("currency") or "",
        "years_required": years_required(title, description),
        "seniority": "",
        "sponsorship": sponsorship(f"{title} {description}"),
        "description_text": description,
    }


def from_greenhouse(token: str, company: str, limit: int) -> list[dict]:
    data = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
    rows = []
    for job in limited(data.get("jobs"), limit):
        loc = (job.get("location") or {}).get("name") or ""
        rows.append(job_record(
            id=f"gh-{token}-{job.get('id')}",
            source="greenhouse",
            company=job.get("company_name") or company,
            title=job.get("title") or "",
            department=((job.get("departments") or [{}])[0] or {}).get("name") or "",
            url=job.get("absolute_url") or "",
            location=loc,
            posted_at=job.get("first_published") or job.get("updated_at") or "",
            updated_at=job.get("updated_at") or "",
            description=job.get("content") or "",
        ))
    return [row for row in rows if row]


def from_lever(token: str, company: str, limit: int) -> list[dict]:
    data = fetch_json(f"https://api.lever.co/v0/postings/{token}?mode=json")
    rows = []
    for job in limited(data, limit):
        cats = job.get("categories") or {}
        created = job.get("createdAt")
        posted = datetime.fromtimestamp(created / 1000, timezone.utc).isoformat() if created else ""
        rows.append(job_record(
            id=f"lever-{token}-{job.get('id')}",
            source="lever",
            company=company,
            title=job.get("text") or "",
            department=cats.get("department") or cats.get("team") or "",
            url=job.get("hostedUrl") or job.get("applyUrl") or "",
            location=cats.get("location") or "",
            posted_at=posted,
            updated_at=posted,
            description=job.get("descriptionPlain") or job.get("description") or "",
        ))
    return [row for row in rows if row]


def from_ashby(token: str, company: str, limit: int) -> list[dict]:
    data = fetch_json(f"https://api.ashbyhq.com/posting-api/job-board/{token}")
    rows = []
    for job in limited(data.get("jobs"), limit):
        loc = job.get("location") or job.get("address") or ""
        if isinstance(loc, dict):
            loc = loc.get("postalAddress") or loc.get("addressLocality") or ""
        rows.append(job_record(
            id=f"ashby-{token}-{job.get('id')}",
            source="ashby",
            company=company,
            title=job.get("title") or "",
            department=job.get("department") or "",
            url=job.get("jobUrl") or job.get("applyUrl") or "",
            location=str(loc),
            posted_at=job.get("publishedAt") or job.get("updatedAt") or "",
            updated_at=job.get("updatedAt") or "",
            description=job.get("descriptionPlain") or job.get("descriptionHtml") or "",
        ))
    return [row for row in rows if row]


def from_remotive(limit: int) -> list[dict]:
    data = fetch_json("https://remotive.com/api/remote-jobs")
    rows = []
    for job in limited(data.get("jobs"), limit):
        rows.append(job_record(
            id=f"remotive-{job.get('id')}",
            source="remotive",
            company=job.get("company_name") or "",
            title=job.get("title") or "",
            department=job.get("category") or "",
            url=job.get("url") or "",
            location=job.get("candidate_required_location") or "Remote",
            posted_at=job.get("publication_date") or "",
            updated_at=job.get("publication_date") or "",
            description=job.get("description") or "",
            salary_min=None,
            salary_max=None,
        ))
    return [row for row in rows if row]


def from_arbeitnow(limit: int) -> list[dict]:
    data = fetch_json("https://www.arbeitnow.com/api/job-board-api")
    rows = []
    for job in limited(data.get("data"), limit):
        rows.append(job_record(
            id=f"arbeitnow-{job.get('slug')}",
            source="arbeitnow",
            company=job.get("company_name") or "",
            title=job.get("title") or "",
            url=job.get("url") or "",
            location=job.get("location") or ("Remote" if job.get("remote") else ""),
            posted_at=job.get("created_at") or "",
            updated_at=job.get("created_at") or "",
            description=job.get("description") or "",
        ))
    return [row for row in rows if row]


def time_key(value) -> str:
    if isinstance(value, (int, float)):
        return f"{value:020.3f}"
    return str(value or "")


def dedupe(jobs: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for job in jobs:
        key = "|".join(
            re.sub(r"\s+", " ", (job.get(field) or "").lower()).strip()
            for field in ("company", "title", "location_raw")
        )
        current = best.get(key)
        if current is None or time_key(job.get("updated_at")) > time_key(current.get("updated_at")):
            best[key] = job
    return list(best.values())


def shard_name(job: dict) -> str:
    country = (job.get("locations") or [{}])[0].get("country") or "other"
    slug = re.sub(r"[^a-z0-9]+", "-", country.lower()).strip("-") or "other"
    if slug not in {"united-states", "remote"}:
        slug = "other"
    family = "general"
    blob = f"{job.get('title') or ''} {job.get('department') or ''}".lower()
    if re.search(r"nurse|clinic|health|patient|pharma", blob):
        family = "health"
    elif re.search(r"driver|warehouse|logistic|supply", blob):
        family = "logistics"
    elif re.search(r"retail|store|sales associate|cashier", blob):
        family = "retail"
    elif re.search(r"engineer|software|data|design|product", blob):
        family = "software"
    return f"{slug}-{family}.json"


def load_catalog() -> list[dict]:
    data = yaml.safe_load(CATALOG.read_text()) or {}
    companies = data.get("companies") or []
    if len(companies) < 400:
        raise SystemExit(f"companies.yaml has {len(companies)} employers; need at least 400")
    for row in companies:
        if row.get("source") not in SOURCES:
            raise SystemExit(f"bad source for {row}")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,80}", str(row.get("token") or "")):
            raise SystemExit(f"bad token for {row}")
    return companies


def fetch_company(row: dict, per_company: int) -> tuple[list[dict], str]:
    token = row["token"]
    name = row.get("name") or token
    try:
        if row["source"] == "greenhouse":
            found = from_greenhouse(token, name, per_company)
        elif row["source"] == "lever":
            found = from_lever(token, name, per_company)
        elif row["source"] == "ashby":
            found = from_ashby(token, name, per_company)
        else:
            found = []
        return found, ""
    except Exception as exc:
        return [], f"{row['source']}:{token}: {exc.__class__.__name__}"


def build(limit_companies: int, per_company: int, workers: int = 12) -> dict:
    companies = [row for row in load_catalog() if row["source"] not in {"remotive", "arbeitnow"}]
    if limit_companies and limit_companies > 0:
        companies = companies[:limit_companies]
    jobs: list[dict] = []
    errors = []
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(fetch_company, row, per_company) for row in companies]
        for future in as_completed(futures):
            found, error = future.result()
            jobs.extend(found)
            if error:
                errors.append(error)
            done += 1
            if done % 50 == 0 or done == len(companies):
                print(f"boards {done}/{len(companies)} jobs {len(jobs)} errors {len(errors)}", flush=True)
    try:
        jobs.extend(from_remotive(per_company))
    except Exception as exc:
        errors.append(f"remotive: {exc.__class__.__name__}")
    try:
        jobs.extend(from_arbeitnow(per_company))
    except Exception as exc:
        errors.append(f"arbeitnow: {exc.__class__.__name__}")
    jobs = dedupe([job for job in jobs if job])
    problems = coverage_problems(jobs)
    if problems:
        print("coverage gate failed: " + "; ".join(problems))
        print(f"jobs {len(jobs)} errors {len(errors)}")
        raise SystemExit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    buckets: dict[str, list] = {}
    for job in jobs:
        buckets.setdefault(shard_name(job), []).append(job)

    def pieces(rows: list[dict]) -> list[list[dict]]:
        payload = json.dumps({"jobs": rows}, separators=(",", ":")).encode()
        if len(payload) <= 1_500_000 or len(rows) <= 1:
            return [rows]
        mid = max(1, len(rows) // 2)
        return pieces(rows[:mid]) + pieces(rows[mid:])

    shards = []
    hashes = {}
    written = 0
    for name, rows in sorted(buckets.items()):
        for index, chunk in enumerate(pieces(rows), start=1):
            shard = name if index == 1 else name.replace(".json", f"-{index}.json")
            payload = json.dumps({"jobs": chunk}, separators=(",", ":")).encode()
            (OUT / shard).write_bytes(payload)
            (OUT / f"{shard}.gz").write_bytes(gzip.compress(payload))
            shards.append(shard)
            hashes[shard] = hashlib.sha256(payload).hexdigest()
            written += len(chunk)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "shards": shards,
        "sha256": hashes,
        "job_count": written,
        "errors": errors[:40],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def print_audit(jobs: list[dict], generated_at: str) -> None:
    counts: dict[str, int] = {}
    companies = set()
    non_string = 0
    old = 0
    salary = 0
    seniority = 0
    sponsorship_known = 0
    now = datetime.now(timezone.utc)
    for job in jobs:
        counts[job.get("source") or ""] = counts.get(job.get("source") or "", 0) + 1
        if job.get("company"):
            companies.add(job["company"])
        posted = job.get("posted_at")
        if not isinstance(posted, str):
            non_string += 1
        else:
            try:
                stamp = datetime.fromisoformat(posted.replace("Z", "+00:00"))
                if stamp.tzinfo is None:
                    stamp = stamp.replace(tzinfo=timezone.utc)
                if (now - stamp).days > 45:
                    old += 1
            except ValueError:
                non_string += 1
        if job.get("salary_min") is not None:
            salary += 1
        if job.get("seniority"):
            seniority += 1
        if job.get("sponsorship") not in (None, "unknown"):
            sponsorship_known += 1
    print("jobs", len(jobs), "companies", len(companies))
    print("sources", counts)
    print("non-string dates", non_string, "| older than 45d", old)
    print("salary", salary, "seniority", seniority, "sponsorship known", sponsorship_known)
    print("built", generated_at)


def audit_directory(path: Path) -> int:
    manifest = json.loads((path / "manifest.json").read_text())
    jobs: list[dict] = []
    for shard in manifest.get("shards") or []:
        data = json.loads((path / shard).read_text())
        jobs.extend(data["jobs"] if isinstance(data, dict) else data)
    print_audit(jobs, manifest.get("generated_at") or "")
    problems = coverage_problems(jobs)
    if problems:
        print("coverage gate failed: " + "; ".join(problems))
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--audit-dir", default="")
    parser.add_argument("--limit-companies", type=int, default=0)
    parser.add_argument("--per-company", type=int, default=0)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    if args.check:
        rows = load_catalog()
        print(f"catalog ok: {len(rows)} employers")
        return 0
    if args.audit_dir:
        return audit_directory(Path(args.audit_dir))
    manifest = build(args.limit_companies, args.per_company, args.workers)
    print(f"jobs {manifest['job_count']} shards {len(manifest['shards'])} errors {len(manifest['errors'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
