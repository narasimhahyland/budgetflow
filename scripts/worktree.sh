#!/usr/bin/env bash
# Worktrees for parallel agent waves.
#
#   scripts/worktree.sh new <name> [--base <ref>]     create ../<repo>-worktrees/<name> on branch agent/<name>, then install deps
#   scripts/worktree.sh check <name|branch> [--base <ref>] <allowed-glob>...
#                                                     fail if the worktree's current branch (or the named branch)
#                                                     changed files outside the allowed globs
#   scripts/worktree.sh list
#   scripts/worktree.sh remove <name>                 git worktree remove (refuses when the worktree is dirty)
#
# Globs use shell case patterns where * also matches "/": libs/web/features/budgets/* covers the whole lib.
# --base defaults to $BF_WAVE_BASE, then the current branch of the main checkout.
set -euo pipefail

die() { echo "worktree: $*" >&2; exit 1; }

root=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "not inside a git repository"
root=$(cd "$root/.." && pwd)
parent_dir=${BF_WORKTREE_DIR:-"$(dirname "$root")/$(basename "$root")-worktrees"}

cmd=${1:-}
[ -n "$cmd" ] || { sed -n '2,12p' "$0"; exit 2; }
shift

parse_base() {
  base=${BF_WAVE_BASE:-$(git -C "$root" rev-parse --abbrev-ref HEAD)}
  rest=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --base) base=${2:?--base needs a ref}; shift ;;
      *) rest+=("$1") ;;
    esac
    shift
  done
}

case "$cmd" in
  new)
    name=${1:?usage: worktree.sh new <name> [--base <ref>]}
    shift
    parse_base "$@"
    [[ "$name" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "name must be lowercase letters, digits, '.', '_' or '-'"
    path="$parent_dir/$name"
    branch="agent/$name"
    [ ! -e "$path" ] || die "$path already exists"
    mkdir -p "$parent_dir"
    git -C "$root" worktree add -b "$branch" "$path" "$base"
    echo "Installing dependencies in $path"
    (cd "$path" && bash .cursor/setup-worktree.sh)
    echo
    echo "Worktree ready: $path (branch $branch from $base)"
    echo "Open it in a new Cursor window, or give its path to the agent brief."
    ;;
  check)
    target=${1:?usage: worktree.sh check <name|branch> [--base <ref>] <allowed-glob>...}
    shift
    parse_base "$@"
    [ "${#rest[@]}" -gt 0 ] || die "give at least one allowed glob"
    if [ -d "$parent_dir/$target" ]; then
      branch=$(git -C "$parent_dir/$target" symbolic-ref -q --short HEAD) ||
        die "$parent_dir/$target is not on a branch; pass the branch name instead"
    elif git -C "$root" rev-parse --verify -q "refs/heads/$target" >/dev/null; then
      branch=$target
    elif git -C "$root" rev-parse --verify -q "refs/heads/agent/$target" >/dev/null; then
      branch="agent/$target"
    else
      die "no worktree $parent_dir/$target and no branch $target or agent/$target"
    fi
    mb=$(git -C "$root" merge-base "$base" "$branch") || die "no merge base between $base and $branch; pass --base <ref>"
    violations=0
    changed=0
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      changed=$((changed + 1))
      ok=0
      for glob in "${rest[@]}"; do
        # shellcheck disable=SC2254
        case "$file" in $glob) ok=1; break ;; esac
      done
      if [ "$ok" = 0 ]; then
        echo "  out of scope: $file"
        violations=$((violations + 1))
      fi
    done < <(git -C "$root" diff --name-only "$mb" "$branch")
    wt=$(git -C "$root" worktree list --porcelain |
      awk -v b="branch refs/heads/$branch" '/^worktree /{p=substr($0,10)} $0==b && !f{print p; f=1}')
    if [ -n "$wt" ] && [ -d "$wt" ]; then
      dirty=$(git -C "$wt" status --porcelain | wc -l | tr -d ' ')
      [ "$dirty" = 0 ] || echo "  note: worktree has $dirty uncommitted change(s); only commits are checked"
    fi
    if [ "$violations" -gt 0 ]; then
      die "$branch changed $violations file(s) outside its scope ($changed changed in total vs $base)"
    fi
    echo "worktree: $branch in scope ($changed file(s) changed vs $base)"
    ;;
  list)
    git -C "$root" worktree list
    ;;
  remove)
    name=${1:?usage: worktree.sh remove <name>}
    path="$parent_dir/$name"
    git -C "$root" worktree remove "$path"
    echo "Removed $path. The branch agent/$name is kept; delete it after merging with: git branch -d agent/$name"
    ;;
  *)
    die "unknown command '$cmd' (new, check, list, remove)"
    ;;
esac
