#!/usr/bin/env bash
# Builds the clickable design preview and publishes ONLY design/preview/dist to the gh-pages branch (GitHub Pages).
#
#   design/preview/deploy.sh [--no-build] [--dry-run] [--remote <name>] [--branch <name>]
#
# The site is committed on top of the existing branch through a temporary worktree (history kept, never a force
# push), with .nojekyll so GitHub serves files as they are. Pages is enabled for the branch with the gh CLI when
# it is not enabled yet. All links in the site are relative, so the /<repo>/ base path works.
set -euo pipefail

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
remote=origin
branch=gh-pages
build=1
dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) build=0 ;;
    --dry-run) dry=1 ;;
    --remote) remote=${2:?--remote needs a name}; shift ;;
    --branch) branch=${2:?--branch needs a name}; shift ;;
    -h | --help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "deploy: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

dist="$here/dist"
[ "$build" = 0 ] || node "$here/build.mjs"
[ -f "$dist/index.html" ] || { echo "deploy: $dist/index.html is missing; run without --no-build" >&2; exit 1; }
touch "$dist/.nojekyll"
sh "$root/scripts/secret-scan.sh" --dir "$dist" --quiet || { echo "deploy: secret scan failed on $dist" >&2; exit 1; }

tmp=$(mktemp -d "${TMPDIR:-/tmp}/bf-design-preview.XXXXXX")
scratch=""
cleanup() {
  git -C "$root" worktree remove --force "$tmp" >/dev/null 2>&1 || rm -rf "$tmp"
  [ -z "$scratch" ] || git -C "$root" branch -D "$scratch" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if git -C "$root" ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  git -C "$root" fetch --quiet "$remote" "refs/heads/$branch"
  git -C "$root" worktree add --quiet --detach "$tmp" FETCH_HEAD
else
  scratch="design-preview-publish-$$"
  git -C "$root" worktree add --quiet --detach "$tmp"
  git -C "$tmp" checkout --quiet --orphan "$scratch"
  git -C "$tmp" rm -r -f --quiet --cached . >/dev/null
fi

find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$dist"/. "$tmp"/
git -C "$tmp" add -A
if git -C "$tmp" diff --cached --quiet; then
  echo "deploy: $branch already matches the build; nothing to publish"
else
  git -C "$tmp" commit --quiet -m "docs(design-preview): publish the clickable design preview from $(git -C "$root" rev-parse --short HEAD)"
  echo "deploy: $(git -C "$tmp" show --stat --oneline HEAD | tail -1)"
  if [ "$dry" = 1 ]; then
    echo "deploy: dry run; not pushing"
    exit 0
  fi
  git -C "$tmp" push --quiet "$remote" "HEAD:refs/heads/$branch"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "deploy: gh CLI not found; enable Pages for the $branch branch in the repository settings"
  exit 0
fi
repo=$(cd "$root" && gh repo view --json nameWithOwner -q .nameWithOwner)
if gh api "repos/$repo/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$repo/pages" -f "source[branch]=$branch" -f "source[path]=/" >/dev/null
else
  gh api -X POST "repos/$repo/pages" -f "source[branch]=$branch" -f "source[path]=/" >/dev/null
fi
echo "deploy: published to $(gh api "repos/$repo/pages" -q .html_url)"
