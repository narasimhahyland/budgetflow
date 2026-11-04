# shellcheck shell=bash
# Source from bash scripts: selects Node 24 through nvm when available.
# Usage: . "$(dirname "$0")/lib/node-env.sh"; bf_use_node24 [--install]

bf_use_node24() {
  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  local restore_u=0
  case $- in *u*) restore_u=1; set +u ;; esac
  if [ -s "$nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_sh" --no-use
    if ! nvm use 24 >/dev/null 2>&1 && [ "${1:-}" = "--install" ]; then
      nvm install 24 >/dev/null && nvm use 24 >/dev/null
    fi
  fi
  [ "$restore_u" = 1 ] && set -u
  case "$(node -v 2>/dev/null)" in
    v24.*) return 0 ;;
    *) echo "warning: using Node $(node -v 2>/dev/null || echo 'none'); BudgetFlow expects v24 (nvm use 24)" >&2 ;;
  esac
}
