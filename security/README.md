# Security evidence demo (SBOM + CVE)

This directory is a **standalone** compliance demonstration. It does not change
the LaunchDarkly Relay Proxy demo images, compose network, or dashboard.

It shows the difference between a scanner finding and confirmed exploitability
by stacking evidence:

1. Inventory — the package exists in the test image SBOM
2. Version match — installed `python3.9` is in the affected range
3. Reachability — the fixture imports and calls `urllib.parse.urlsplit`
4. Behavioral verification — a safe regression input is accepted on the
   vulnerable image and rejected on the patched image

It does **not** run a public exploit, reverse shell, or host-compromising PoC.

## What is reproduced

| Item | Value |
| --- | --- |
| CVE | CVE-2023-24329 |
| Component | CPython `urllib.parse` |
| Vulnerable package | `python3.9=3.9.2-1` (Debian bullseye) |
| Fixed package | `python3.9=3.9.2-1+deb11u2` |
| Base image | `debian:bullseye-20230522-slim@sha256:7606bef5…` |
| Runtime test | Leading newline before `http://example.com` vs a hostname blocklist |

The fixture only inspects parse results. Containers run with `--network none`,
as UID `65532`, with no published ports and no mounted secrets.

## Quick start

From the repository root:

```bash
./security/reproduce-cve.sh
docker compose -f docker-compose-security.yml up -d --build
```

Then open http://localhost:8090 (override with `SECURITY_PORT` in `.env`).

`reproduce-cve.sh` fails if Trivy does not report the expected CVE on the
vulnerable image, or if the two runtime fixtures do not diverge.

## Layout

```
security/
  reproduce-cve.sh
  Dockerfile.vulnerable
  Dockerfile.fixed
  Dockerfile.portal
  expected-cves.txt
  requirements.txt
  README.md
  test-fixture/
  ui/
  results/
    image-digest.txt
    sbom.cdx.json
    trivy.json
    metadata.txt
    summary.json
```

Images are tagged `ld-relay-demo/cve-repro:vulnerable-<gitsha>` and
`:fixed-<gitsha>`. They are never referenced by `docker-compose.yml`.

## Side-by-side matrix

| Artifact | Package state | Scanner result | Runtime test |
| --- | --- | --- | --- |
| Vulnerable image | `python3.9=3.9.2-1` | CVE-2023-24329 present | Affected parser accepts the fixture |
| Fixed image | `python3.9=3.9.2-1+deb11u2` | CVE absent or reduced | Same fixture is rejected safely |
| Production candidate | Exact release digest of the Relay image | Policy scan (separate) | Existing demo smoke tests |

Scan the Relay production candidate without this workflow:

```bash
docker compose images relay-proxy
trivy image --scanners vuln --severity HIGH,CRITICAL launchdarkly/ld-relay:<tag>
```

## Tooling

Scans run in pinned containers (`aquasec/trivy:0.58.1`, `anchore/syft:v1.20.0`),
not whatever happens to be installed on the host. Versions and a UTC timestamp
are written to `results/metadata.txt`. Keep those artifacts; do not treat a
later live scan as the only record. Vulnerability databases are reclassified
over time.

## Safety

Do not add a proof of concept that creates a reverse shell, reaches cloud
metadata, modifies the host, or executes arbitrary code outside an isolated
disposable VM. The regression input here is a single leading newline on a
URL string.
