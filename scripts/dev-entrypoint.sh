#!/bin/sh
set -eu

workspace=${FLOWENT_WORKDIR:-/workspace}
source_dir=${FLOWENT_SOURCE_DIR:-/app}

if [ -z "$workspace" ] || [ "$workspace" = "/" ] || [ "$workspace" = "$source_dir" ]; then
  echo "Invalid FLOWENT_WORKDIR: $workspace" >&2
  exit 1
fi

mkdir -p "$workspace"

if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fx "$source_dir" >/dev/null 2>&1; then
  git config --global --add safe.directory "$source_dir"
fi

if [ ! -e "$workspace/.git" ]; then
  find "$workspace" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  git clone --no-hardlinks "$source_dir" "$workspace"
fi

cd "$workspace"

if [ "$#" -eq 0 ]; then
  set -- pnpm --dir "$source_dir" dev
fi

exec "$@"
