#!/usr/bin/env bash
# Build, scan, and verify the isolated CVE reproduction images.
# Does not start or modify the main LaunchDarkly demo stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEC="$ROOT/security"
RESULTS="$SEC/results"

IMAGE="${IMAGE:-ld-relay-demo/cve-repro}"
VERSION="${VERSION:-$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo local)}"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.58.1}"
SYFT_IMAGE="${SYFT_IMAGE:-anchore/syft:v1.20.0}"
TRIVY_CACHE_VOLUME="${TRIVY_CACHE_VOLUME:-ld-security-trivy-cache}"

VULN_TAG="$IMAGE:vulnerable-$VERSION"
FIXED_TAG="$IMAGE:fixed-$VERSION"

EXPECTED_CVES=()
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    CVE-*) EXPECTED_CVES+=("$line") ;;
  esac
done < "$SEC/expected-cves.txt"
if [[ ${#EXPECTED_CVES[@]} -eq 0 ]]; then
  echo "No CVE IDs found in $SEC/expected-cves.txt" >&2
  exit 1
fi

mkdir -p "$RESULTS"
rm -f "$RESULTS"/*.json "$RESULTS"/*.txt "$RESULTS"/*.log 2>/dev/null || true

echo "==> Building immutable test images (tag=$VERSION)"
docker build --pull=false \
  --file "$SEC/Dockerfile.vulnerable" \
  --tag "$VULN_TAG" \
  --tag "$IMAGE:vulnerable" \
  "$SEC"

docker build --pull=false \
  --file "$SEC/Dockerfile.fixed" \
  --tag "$FIXED_TAG" \
  --tag "$IMAGE:fixed" \
  "$SEC"

inspect_image() {
  local tag="$1"
  local prefix="$2"
  docker image inspect "$tag" --format 'ImageID={{.Id}}
Os={{.Os}}
Architecture={{.Architecture}}
Created={{.Created}}
' > "$RESULTS/${prefix}-image-id.txt"
  local digest
  digest="$(docker image inspect "$tag" --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}')"
  echo "RepoDigest=${digest:-local-unpushed}" > "$RESULTS/${prefix}-repo-digest.txt"
}

inspect_image "$VULN_TAG" "vulnerable"
inspect_image "$FIXED_TAG" "fixed"

{
  echo "git=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "image_vulnerable=$VULN_TAG"
  echo "image_fixed=$FIXED_TAG"
  echo "expected_cves=${EXPECTED_CVES[*]}"
  echo "base=debian:bullseye-20230522-slim@sha256:7606bef5684b393434f06a50a3d1a09808fee5a0240d37da5d181b1b121e7637"
  echo "package_vulnerable=python3.9=3.9.2-1"
  echo "package_fixed=python3.9=3.9.2-1+deb11u2"
  docker version
  docker info --format 'OSType={{.OSType}} Architecture={{.Architecture}}'
  date -u +"timestamp=%Y-%m-%dT%H:%M:%SZ"
} > "$RESULTS/metadata.txt"

cp "$RESULTS/vulnerable-image-id.txt" "$RESULTS/image-digest.txt"
{
  echo "--- vulnerable ---"
  cat "$RESULTS/vulnerable-image-id.txt"
  echo "--- fixed ---"
  cat "$RESULTS/fixed-image-id.txt"
} >> "$RESULTS/image-digest.txt"

docker_tool() {
  local image="$1"
  shift
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$RESULTS:/out" \
    -v "$TRIVY_CACHE_VOLUME:/root/.cache/" \
    "$image" "$@"
}

echo "==> Recording pinned scanner versions"
{
  echo "trivy_image=$TRIVY_IMAGE"
  echo "syft_image=$SYFT_IMAGE"
  docker run --rm "$TRIVY_IMAGE" --version
  docker run --rm "$SYFT_IMAGE" version
} >> "$RESULTS/metadata.txt"

echo "==> Generating SBOMs with Syft"
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$RESULTS:/out" \
  "$SYFT_IMAGE" scan "$VULN_TAG" -o cyclonedx-json=/out/sbom.cdx.json

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$RESULTS:/out" \
  "$SYFT_IMAGE" scan "$FIXED_TAG" -o cyclonedx-json=/out/sbom-fixed.cdx.json

echo "==> Scanning images with Trivy (pinned container)"
docker_tool "$TRIVY_IMAGE" image \
  --scanners vuln \
  --format json \
  --output /out/trivy.json \
  "$VULN_TAG"

docker_tool "$TRIVY_IMAGE" image \
  --scanners vuln \
  --format json \
  --output /out/vulnerable.json \
  "$VULN_TAG"

docker_tool "$TRIVY_IMAGE" image \
  --scanners vuln \
  --format json \
  --output /out/fixed.json \
  "$FIXED_TAG"

docker_tool "$TRIVY_IMAGE" image \
  --scanners vuln \
  --severity HIGH,CRITICAL \
  --format table \
  --output /out/trivy-high.txt \
  "$VULN_TAG" || true

echo "==> Checking expected CVE inventory on the vulnerable image"
python3 - "$RESULTS/trivy.json" "${EXPECTED_CVES[@]}" <<'PY'
import json, sys
path = sys.argv[1]
cves = sys.argv[2:]
data = json.load(open(path))
found = {
    v.get("VulnerabilityID")
    for result in data.get("Results") or []
    for v in (result.get("Vulnerabilities") or [])
}
missing = [cve for cve in cves if cve not in found]
if missing:
    print("Expected CVE not found: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
print("Found expected CVE(s): " + ", ".join(cves))
PY

echo "==> Running isolated regression fixtures (no network)"
docker run --rm --network none "$VULN_TAG" | tee "$RESULTS/runtime-vulnerable.log"
docker run --rm --network none "$FIXED_TAG" | tee "$RESULTS/runtime-fixed.log"

if ! grep -q "vulnerable: affected parser accepts the regression fixture" "$RESULTS/runtime-vulnerable.log"; then
  echo "Vulnerable image did not demonstrate affected parser behavior" >&2
  exit 1
fi
if ! grep -q "fixed: regression fixture is rejected safely" "$RESULTS/runtime-fixed.log"; then
  echo "Fixed image did not reject the regression fixture" >&2
  exit 1
fi

python3 "$SEC/summarize.py" \
  --results "$RESULTS" \
  --cves "${EXPECTED_CVES[@]}" \
  --vulnerable-tag "$VULN_TAG" \
  --fixed-tag "$FIXED_TAG"

echo
echo "Reproduction complete."
echo "  Evidence: $RESULTS"
echo "  Portal:   docker compose -f docker-compose-security.yml up -d --build"
echo "  URL:      http://localhost:${SECURITY_PORT:-8090}"
