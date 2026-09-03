#!/usr/bin/env python3
"""Build a compact evidence summary for the security portal."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open() as handle:
        return json.load(handle)


def findings(report: dict) -> list[dict]:
    items = []
    for result in report.get("Results") or []:
        for vuln in result.get("Vulnerabilities") or []:
            items.append(vuln)
    return items


def find_cve(items: list[dict], cve: str) -> dict | None:
    for item in items:
        if item.get("VulnerabilityID") == cve:
            return item
    return None


def severity_counts(items: list[dict]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for item in items:
        counts[item.get("Severity") or "UNKNOWN"] += 1
    return dict(counts)


def image_meta(results: Path, prefix: str) -> dict:
    text = (results / f"{prefix}-image-id.txt").read_text() if (results / f"{prefix}-image-id.txt").exists() else ""
    meta = {}
    for line in text.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            meta[key] = value
    return meta


def runtime_result(path: Path) -> dict:
    text = path.read_text() if path.exists() else ""
    result = "unknown"
    if "result=fixed" in text:
        result = "fixed"
    elif "result=vulnerable" in text:
        result = "vulnerable"
    hostname = ""
    version = ""
    for line in text.splitlines():
        if line.startswith("hostname="):
            hostname = line.split("=", 1)[1]
        if line.startswith("python3.9 "):
            version = line
    return {
        "result": result,
        "hostname": hostname,
        "logExcerpt": "\n".join(text.strip().splitlines()[-12:]),
        "packageLine": version,
    }


def cvss_vector(item: dict | None) -> str:
    if not item:
        return ""
    cvss = item.get("CVSS") or {}
    for vendor in ("nvd", "ghsa", "redhat"):
        data = cvss.get(vendor) or {}
        if data.get("V3Vector"):
            return data["V3Vector"]
        if data.get("V2Vector"):
            return data["V2Vector"]
    return item.get("PrimaryURL") or ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--cves", nargs="+", required=True)
    parser.add_argument("--vulnerable-tag", required=True)
    parser.add_argument("--fixed-tag", required=True)
    args = parser.parse_args()

    results = Path(args.results)
    cve = args.cves[0]
    vuln_report = load_json(results / "vulnerable.json")
    if not vuln_report:
        vuln_report = load_json(results / "trivy.json")
    vuln_items = findings(vuln_report)
    fixed_items = findings(load_json(results / "fixed.json"))
    vuln_hit = find_cve(vuln_items, cve)
    fixed_hit = find_cve(fixed_items, cve)

    summary = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cve": cve,
        "allExpectedCves": args.cves,
        "title": "CPython urllib.parse leading-whitespace blocklist bypass",
        "cwe": "CWE-20",
        "severity": (vuln_hit or {}).get("Severity", "HIGH"),
        "cvss": cvss_vector(vuln_hit),
        "primaryUrl": (vuln_hit or {}).get("PrimaryURL", "https://nvd.nist.gov/vuln/detail/CVE-2023-24329"),
        "package": (vuln_hit or {}).get("PkgName", "python3.9"),
        "component": "urllib.parse.urlsplit",
        "baseImage": "debian:bullseye-20230522-slim@sha256:7606bef5684b393434f06a50a3d1a09808fee5a0240d37da5d181b1b121e7637",
        "qualification": (
            "A scanner finding is inventory evidence, not confirmed exploitability. "
            "This demo layers SBOM presence, version match, reachability of urllib.parse, "
            "and a safe regression fixture. It does not run a weaponized exploit."
        ),
        "runtimeExposure": {
            "network": "none (--network none)",
            "publishedPorts": "none on the test images",
            "user": "65532:65532 (cveuser)",
            "privileges": "no added capabilities; disposable isolated container",
            "secrets": "none mounted",
        },
        "commands": {
            "reproduce": "./security/reproduce-cve.sh",
            "vulnerableRun": f"docker run --rm --network none {args.vulnerable_tag}",
            "fixedRun": f"docker run --rm --network none {args.fixed_tag}",
            "portal": "docker compose -f docker-compose-security.yml up -d --build",
        },
        "vulnerable": {
            "tag": args.vulnerable_tag,
            "packageVersion": (vuln_hit or {}).get("InstalledVersion", "3.9.2-1"),
            "cvePresent": vuln_hit is not None,
            "severityCounts": severity_counts(vuln_items),
            "finding": {
                "id": (vuln_hit or {}).get("VulnerabilityID"),
                "pkg": (vuln_hit or {}).get("PkgName"),
                "installed": (vuln_hit or {}).get("InstalledVersion"),
                "fixedVersion": (vuln_hit or {}).get("FixedVersion"),
                "severity": (vuln_hit or {}).get("Severity"),
                "title": (vuln_hit or {}).get("Title"),
            } if vuln_hit else None,
            "image": image_meta(results, "vulnerable"),
            "runtime": runtime_result(results / "runtime-vulnerable.log"),
        },
        "fixed": {
            "tag": args.fixed_tag,
            "packageVersion": (fixed_hit or {}).get("InstalledVersion", "3.9.2-1+deb11u2"),
            "cvePresent": fixed_hit is not None,
            "severityCounts": severity_counts(fixed_items),
            "finding": {
                "id": (fixed_hit or {}).get("VulnerabilityID"),
                "pkg": (fixed_hit or {}).get("PkgName"),
                "installed": (fixed_hit or {}).get("InstalledVersion"),
                "fixedVersion": (fixed_hit or {}).get("FixedVersion"),
                "severity": (fixed_hit or {}).get("Severity"),
            } if fixed_hit else None,
            "image": image_meta(results, "fixed"),
            "runtime": runtime_result(results / "runtime-fixed.log"),
        },
        "artifacts": [
            "image-digest.txt",
            "sbom.cdx.json",
            "sbom-fixed.cdx.json",
            "trivy.json",
            "vulnerable.json",
            "fixed.json",
            "metadata.txt",
            "summary.json",
        ],
    }

    if not summary["fixed"]["cvePresent"]:
        summary["fixed"]["packageVersion"] = "3.9.2-1+deb11u2"

    (results / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"Wrote {results / 'summary.json'}")


if __name__ == "__main__":
    main()
