#!/usr/bin/env bash

set -euo pipefail

ARTIFACT_DIR="${1:-artifacts}"

if [[ ! -d "$ARTIFACT_DIR" ]]; then
  echo "❌ Artifact directory not found: $ARTIFACT_DIR" >&2
  exit 1
fi

cd "$ARTIFACT_DIR"

if [[ ! -f "SHA256SUMS" ]]; then
  echo "❌ Missing SHA256SUMS in $ARTIFACT_DIR" >&2
  exit 1
fi

shopt -s nullglob

tgz_files=( *.tgz )
if [[ ${#tgz_files[@]} -eq 0 ]]; then
  echo "❌ No CLI package artifacts (*.tgz) found in $ARTIFACT_DIR" >&2
  exit 1
fi

if [[ ! -f "cli-sbom.cdx.json" ]]; then
  echo "❌ Missing CLI SBOM file cli-sbom.cdx.json in $ARTIFACT_DIR" >&2
  exit 1
fi

for file in "${tgz_files[@]}"; do
  if ! grep -Fq "  $file" "SHA256SUMS" && ! grep -Fq " $file" "SHA256SUMS"; then
    echo "❌ Missing checksum entry for $file in SHA256SUMS" >&2
    exit 1
  fi
done

echo "Verifying SHA256 checksums..."
shasum -a 256 -c SHA256SUMS

echo "Validating SBOM JSON payload..."
if ! python3 -m json.tool cli-sbom.cdx.json >/tmp/cli-sbom-check.json 2>&1; then
  echo "❌ cli-sbom.cdx.json is not valid JSON" >&2
  exit 1
fi

for file in "${tgz_files[@]}"; do
  if [[ ! -s "$file" ]]; then
    echo "❌ Package file is empty: $file" >&2
    exit 1
  fi
done

if [[ ! -s "cli-sbom.cdx.json" ]]; then
  echo "❌ cli-sbom.cdx.json is empty" >&2
  exit 1
fi

echo "✅ CLI release integrity files verified."
