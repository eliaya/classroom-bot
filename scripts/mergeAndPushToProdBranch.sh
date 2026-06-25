#!/usr/bin/env bash

# Local one-command merge into main AND push (production deploy):
#   chmod +x ./scripts/mergeAndPushToProdBranch.sh
#   ./scripts/mergeAndPushToProdBranch.sh
#
# Same flow as ./scripts/mergeToDevelopBranch.sh (feature -> main), but instead
# of asking whether to push, it pushes main to origin automatically — main is
# the deployed/production branch here, so this is the "release" command.
#   update main → merge main into your branch → merge your branch into main → push main
#
# Run from a feature branch (not main).
#
# Never auto force-pushes, deletes branches, or overwrites conflicted files.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GIT_REMOTE="${GIT_REMOTE:-origin}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
# Set AUTO_PUSH=0 to stop before pushing (e.g. to inspect the merge first).
AUTO_PUSH="${AUTO_PUSH:-1}"
ORIGINAL_BRANCH=""
MERGE_PHASE=""

log() {
  printf '[merge-to-prod] %s\n' "$*"
}

warn() {
  printf '[merge-to-prod] WARN: %s\n' "$*" >&2
}

die() {
  printf '[merge-to-prod] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
  done
}

is_interactive() {
  [[ -t 0 ]]
}

prompt_choice() {
  local question="$1"
  shift
  local -a options=("$@")
  local choice reply

  is_interactive || die "cannot handle in non-interactive mode: $question"

  while true; do
    printf '\n%s\n' "$question" >&2
    local i=1
    for choice in "${options[@]}"; do
      printf '  %d) %s\n' "$i" "$choice" >&2
      i=$((i + 1))
    done
    printf 'Choice [1-%d]: ' "${#options[@]}" >&2
    read -r reply
    if [[ "$reply" =~ ^[0-9]+$ ]] && ((reply >= 1 && reply <= ${#options[@]})); then
      printf '%s\n' "${options[$((reply - 1))]}"
      return 0
    fi
    warn "invalid choice: $reply"
  done
}

usage() {
  cat <<'USAGE'
Usage: ./scripts/mergeAndPushToProdBranch.sh

First-time setup:
  chmod +x ./scripts/mergeAndPushToProdBranch.sh

What it does:
  Merge your current feature branch into main and push main (the production deploy).

Flow:
  1. Verify a clean working tree and that you are not on main
  2. Fetch and update local main from origin/main
  3. Merge main into your current branch (surface conflicts early)
  4. Switch to main, merge your branch into main
  5. Push main to origin (auto; set AUTO_PUSH=0 to skip)

Requirements:
  - Run from a feature branch, not main
  - All changes committed or stashed
  - Git remote origin configured with origin/main

Environment (optional):
  GIT_REMOTE=origin
  TARGET_BRANCH=main
  AUTO_PUSH=1            # 0 to stop before pushing
USAGE
}

current_branch() {
  git branch --show-current
}

ensure_git_repo() {
  git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $PROJECT_ROOT"
}

ensure_not_on_target() {
  local current
  current="$(current_branch)"
  [[ -n "$current" ]] || die "detached HEAD detected; checkout a feature branch first"
  if [[ "$current" == "$TARGET_BRANCH" ]]; then
    die "do not run this script on ${TARGET_BRANCH}. Checkout a feature branch first."
  fi
}

ensure_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "uncommitted changes detected:"
    git status --short >&2
    die "commit your changes (git add && git commit) or stash them (git stash) before running this script"
  fi
}

fetch_remote() {
  log "fetching ${GIT_REMOTE}..."
  git fetch "$GIT_REMOTE" --prune
}

ensure_remote_target() {
  fetch_remote
  if ! git show-ref --verify --quiet "refs/remotes/$GIT_REMOTE/$TARGET_BRANCH"; then
    die "remote branch ${GIT_REMOTE}/${TARGET_BRANCH} not found; check remote and branch name"
  fi
}

checkout_branch() {
  local branch="$1"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git checkout "$branch"
  elif git show-ref --verify --quiet "refs/remotes/$GIT_REMOTE/$branch"; then
    git checkout -B "$branch" "$GIT_REMOTE/$branch"
  else
    die "branch not found locally or on remote: $branch"
  fi
}

pull_target_branch() {
  log "pulling latest ${GIT_REMOTE}/${TARGET_BRANCH}..."
  if ! git pull --no-rebase "$GIT_REMOTE" "$TARGET_BRANCH"; then
    MERGE_PHASE="updating ${TARGET_BRANCH}"
    handle_merge_conflict
  fi
}

list_conflicted_files() {
  git diff --name-only --diff-filter=U
}

has_unresolved_conflicts() {
  [[ -n "$(list_conflicted_files)" ]]
}

show_conflicted_files() {
  local -a files=()
  local _line

  while IFS= read -r _line; do
    [[ -z "$_line" ]] && continue
    files+=("$_line")
  done < <(list_conflicted_files)

  if ((${#files[@]} == 0)); then
    log "no unresolved conflict files"
    return 0
  fi

  warn "${#files[@]} conflicted file(s):"
  printf '  - %s\n' "${files[@]}" >&2
}

complete_merge_commit() {
  local merge_msg="$1"
  if git commit --no-edit 2>/dev/null; then
    return 0
  fi
  git commit -m "$merge_msg"
}

handle_merge_conflict() {
  local phase="${MERGE_PHASE:-merge}"
  local choice

  while true; do
    if ! has_unresolved_conflicts && [[ -d .git/MERGE_HEAD || -f .git/MERGE_HEAD ]]; then
      log "conflicts resolved; completing merge commit..."
      case "$phase" in
        "merge ${TARGET_BRANCH} into ${ORIGINAL_BRANCH}")
          complete_merge_commit "merge: integrate ${TARGET_BRANCH} into ${ORIGINAL_BRANCH}"
          ;;
        "merge ${ORIGINAL_BRANCH} into ${TARGET_BRANCH}")
          complete_merge_commit "merge: integrate ${ORIGINAL_BRANCH} into ${TARGET_BRANCH}"
          ;;
        *)
          complete_merge_commit "merge: resolve conflicts during ${phase}"
          ;;
      esac
      log "merge commit created"
      return 0
    fi

    if ! has_unresolved_conflicts; then
      warn "no conflict files detected, but merge is incomplete; check git status"
      git status -sb >&2
      die "cannot complete merge automatically; resolve manually and retry"
    fi

    warn "merge conflict during ${phase}"
    show_conflicted_files

    choice="$(prompt_choice \
      "Merge conflict detected. Choose how to proceed:" \
      "show conflicted files, pause for manual resolution, then continue" \
      "abort merge and switch back to original branch" \
      "exit and keep conflict state for manual handling")"

    case "$choice" in
      "show conflicted files, pause for manual resolution, then continue")
        show_conflicted_files
        printf '\nResolve conflicts in your editor, then run: git add <file>\n' >&2
        printf 'Press Enter when done... ' >&2
        read -r _
        if has_unresolved_conflicts; then
          warn "unresolved conflicts remain; keep resolving"
        elif [[ -d .git/MERGE_HEAD || -f .git/MERGE_HEAD ]]; then
          log "all conflicted files marked resolved"
        else
          warn "merge state changed; check git status"
        fi
        ;;
      "abort merge and switch back to original branch")
        if [[ -d .git/MERGE_HEAD || -f .git/MERGE_HEAD ]]; then
          log "aborting merge..."
          git merge --abort
        fi
        if [[ -n "$ORIGINAL_BRANCH" ]] && [[ "$(current_branch)" != "$ORIGINAL_BRANCH" ]]; then
          log "switching back to ${ORIGINAL_BRANCH}..."
          git checkout "$ORIGINAL_BRANCH"
        fi
        die "merge aborted; back on ${ORIGINAL_BRANCH:-original branch}"
        ;;
      "exit and keep conflict state for manual handling")
        warn "exiting with conflict state intact. Use git status, resolve, then git commit to finish"
        exit 1
        ;;
      *)
        die "unknown choice: $choice"
        ;;
    esac
  done
}

merge_target_into_feature() {
  MERGE_PHASE="merge ${TARGET_BRANCH} into ${ORIGINAL_BRANCH}"
  log "${MERGE_PHASE} (surface conflicts early)..."
  if git merge --no-ff --no-edit "$TARGET_BRANCH" -m "merge: integrate ${TARGET_BRANCH} into ${ORIGINAL_BRANCH}"; then
    log "merged ${TARGET_BRANCH} into ${ORIGINAL_BRANCH}"
    return 0
  fi
  handle_merge_conflict
}

merge_feature_into_target() {
  MERGE_PHASE="merge ${ORIGINAL_BRANCH} into ${TARGET_BRANCH}"
  log "${MERGE_PHASE}..."
  if git merge --no-ff --no-edit "$ORIGINAL_BRANCH" -m "merge: integrate ${ORIGINAL_BRANCH} into ${TARGET_BRANCH}"; then
    log "merged ${ORIGINAL_BRANCH} into ${TARGET_BRANCH}"
    return 0
  fi
  handle_merge_conflict
}

prompt_continue() {
  is_interactive || return 0

  local reply
  printf '\nThis script will:\n' >&2
  printf '  1. Update local %s (pull %s/%s)\n' "$TARGET_BRANCH" "$GIT_REMOTE" "$TARGET_BRANCH" >&2
  printf '  2. Merge %s into your branch %s\n' "$TARGET_BRANCH" "$ORIGINAL_BRANCH" >&2
  printf '  3. Switch to %s, merge %s into %s\n' "$TARGET_BRANCH" "$ORIGINAL_BRANCH" "$TARGET_BRANCH" >&2
  if [[ "$AUTO_PUSH" == "1" ]]; then
    printf '  4. Push %s to %s %s\n' "$TARGET_BRANCH" "$GIT_REMOTE" "$TARGET_BRANCH" >&2
  else
    printf '  4. Skip push (AUTO_PUSH=0)\n' >&2
  fi
  printf '\nContinue? [Y/n]: ' >&2
  read -r reply
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]] || die "cancelled"
}

push_target() {
  if [[ "$AUTO_PUSH" != "1" ]]; then
    log "AUTO_PUSH=${AUTO_PUSH}; skipped push. To push: git push ${GIT_REMOTE} ${TARGET_BRANCH}"
    return 0
  fi
  log "pushing to ${GIT_REMOTE}/${TARGET_BRANCH}..."
  if git push "$GIT_REMOTE" "$TARGET_BRANCH"; then
    log "push complete"
  else
    warn "push failed. Check remote state, then run: git push ${GIT_REMOTE} ${TARGET_BRANCH}"
    exit 1
  fi
}

main() {
  local command="${1:-merge}"

  case "$command" in
    help|--help|-h)
      usage
      exit 0
      ;;
    merge|"")
      ;;
    *)
      usage >&2
      die "unknown command: $command"
      ;;
  esac

  require_command git
  ensure_git_repo
  ensure_not_on_target
  ensure_clean_tree

  ORIGINAL_BRANCH="$(current_branch)"
  log "current branch: ${ORIGINAL_BRANCH}"
  log "target branch: ${TARGET_BRANCH}"

  ensure_remote_target
  prompt_continue

  log "switching to ${TARGET_BRANCH} and updating..."
  checkout_branch "$TARGET_BRANCH"
  pull_target_branch

  log "switching back to ${ORIGINAL_BRANCH}..."
  checkout_branch "$ORIGINAL_BRANCH"
  merge_target_into_feature

  log "switching to ${TARGET_BRANCH}..."
  checkout_branch "$TARGET_BRANCH"
  merge_feature_into_target

  log "merge complete: ${ORIGINAL_BRANCH} → ${TARGET_BRANCH}"
  git log --oneline -5

  push_target

  log "done. currently on ${TARGET_BRANCH}"
  log "to return to your feature branch: git checkout ${ORIGINAL_BRANCH}"
}

main "$@"
