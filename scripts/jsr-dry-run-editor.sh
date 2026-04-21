#!/usr/bin/env bash
set -euo pipefail

packages=(
  packages/editor-core
  packages/editor-language
  packages/editor-layout
  packages/editor-theme
  packages/editor-controller
  packages/editor-view-dom
  packages/editor-element
)

for package_dir in "${packages[@]}"; do
  echo "==> deno publish --dry-run ${package_dir}"
  (
    cd "$package_dir"
    deno publish --dry-run --allow-dirty
  )
done
