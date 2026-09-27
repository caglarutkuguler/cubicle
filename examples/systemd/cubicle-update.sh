#!/usr/bin/env bash
# Keep a Cubicle clone up to date and restart its running services when it changes.
# Run by cubicle-update.timer; safe to run by hand.
#
# - Only fast-forwards. If the clone has local edits or has diverged, it does nothing.
# - Restarts every active cubicle*.service (except the updater itself) after an update.
#   Open browser tabs notice the restart and reload themselves within a minute.
set -euo pipefail

DIR="${CUBICLE_DIR:-$HOME/cubicle}"
cd "$DIR"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "cubicle-update: local changes in $DIR, skipping"
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
before="$(git rev-parse HEAD)"
git fetch --quiet origin "$branch"
if ! git merge --ff-only --quiet "origin/$branch" 2>/dev/null; then
  echo "cubicle-update: cannot fast-forward $branch, skipping"
  exit 0
fi
after="$(git rev-parse HEAD)"
[ "$before" = "$after" ] && exit 0

echo "cubicle-update: $before -> $after"
git --no-pager log --oneline "$before..$after"

systemctl --user list-units --type=service --state=active --no-legend --plain 'cubicle*.service' \
  | awk '{print $1}' \
  | grep -v '^cubicle-update\.service$' \
  | while read -r unit; do
      echo "cubicle-update: restarting $unit"
      systemctl --user restart "$unit"
    done
