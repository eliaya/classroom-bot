#!/usr/bin/env bash

# Local one-command promotion of main into the production branch:
#   chmod +x ./scripts/mergeAndPushToProdBranch.sh
#   ./scripts/mergeAndPushToProdBranch.sh
#
# Unlike ./scripts/mergeToDevelopBranch.sh (feature -> main), this script
# promotes the integration branch to production and pushes automatically:
#   update main -> merge main into production -> push production
#
# Run it after main already contains everything you want released (e.g. you
# integrated your feature with mergeToDevelopBranch.sh first).
#
# Never auto force-pushes, deletes branches, or overwrites conflicted files.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GIT_REMOTE="${GIT_REMOTE:-origin}"
TARGET_BRANCH="${TARGET_BRANCH:-production}"
SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
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
  Promote the integration branch (main) into the production branch and push it.

Flow:
  1. Verify a clean working tree
  2. Fetch and update local main from origin/main (the release source)
  3. Checkout production (creating it from main on first run), pull origin/production
  4. Merge main into production (surface conflicts before pushing)
  5. Push production to origin (auto; set AUTO_PUSH=0 to skip)

Requirements:
  - All changes committed or stashed
  - Git remote origin configured with origin/main

Environment (optional):
  GIT_REMOTE=origin
  TARGET_BRANCH=production
  SOURCE_BRANCH=main
  AUTO_PUSH=1            # 0 to stop before pushing
USAGE
}

current_branch() {
  git branch --show-current
}

ensure_git_repo() {
  git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $PROJECT_ROOT"
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

ensure_remote_source() {
  fetch_remote
  if ! git show-ref --verify --quiet "refs/remotes/$GIT_REMOTE/$SOURCE_BRANCH"; then
    die "remote source branch ${GIT_REMOTE}/${SOURCE_BRANCH} not found; check remote and branch name"
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

update_source_branch() {
  log "switching to ${SOURCE_BRANCH} and updating from ${GIT_REMOTE}/${SOURCE_BRANCH}..."
  checkout_branch "$SOURCE_BRANCH"
  if ! git pull --no-rebase "$GIT_REMOTE" "$SOURCE_BRANCH"; then
    MERGE_PHASE="updating ${SOURCE_BRANCH}"
    handle_merge_conflict
  fi
}

# Checkout production; create it from the freshly-updated main on first run.
checkout_or_create_target() {
  if git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
    log "switching to existing local ${TARGET_BRANCH}..."
    git checkout "$TARGET_BRANCH"
    if ! git pull --no-rebase "$GIT_REMOTE" "$TARGET_BRANCH" 2>/dev/null; then
      log "no remote ${GIT_REMOTE}/${TARGET_BRANCH} to pull (or pull conflict); continuing"
    fi
  elif git show-ref --verify --quiet "refs/remotes/$GIT_REMOTE/$TARGET_BRANCH"; then
    log "checking out ${TARGET_BRANCH} from ${GIT_REMOTE}/${TARGET_BRANCH}..."
    git checkout -B "$TARGET_BRANCH" "$GIT_REMOTE/$TARGET_BRANCH"
  else
    log "${TARGET_BRANCH} does not exist; creating it from ${SOURCE_BRANCH}..."
    git checkout -B "$TARGET_BRANCH" "$SOURCE_BRANCH"
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
      complete_merge_commit "merge: resolve conflicts during ${phase}"
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

merge_source_into_target() {
  MERGE_PHASE="merge ${SOURCE_BRANCH} into ${TARGET_BRANCH}"
  log "${MERGE_PHASE}..."
  if git merge --no-ff --no-edit "$SOURCE_BRANCH" -m "merge: promote ${SOURCE_BRANCH} into ${TARGET_BRANCH}"; then
    log "merged ${SOURCE_BRANCH} into ${TARGET_BRANCH}"
    return 0
  fi
  handle_merge_conflict
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

prompt_continue() {
  is_interactive || return 0

  local reply
  printf '\nThis script will:\n' >&2
  printf '  1. Update local %s (pull %s/%s)\n' "$SOURCE_BRANCH" "$GIT_REMOTE" "$SOURCE_BRANCH" >&2
  printf '  2. Checkout %s (create from %s if missing)\n' "$TARGET_BRANCH" "$SOURCE_BRANCH" >&2
  printf '  3. Merge %s into %s\n' "$SOURCE_BRANCH" "$TARGET_BRANCH" >&2
  if [[ "$AUTO_PUSH" == "1" ]]; then
    printf '  4. Push %s to %s\n' "$TARGET_BRANCH" "$GIT_REMOTE" >&2
  else
    printf '  4. Skip push (AUTO_PUSH=0)\n' >&2
  fi
  printf '\nContinue? [Y/n]: ' >&2
  read -r reply
  [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]] || die "cancelled"
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
  ensure_clean_tree

  ORIGINAL_BRANCH="$(current_branch)"
  [[ -n "$ORIGINAL_BRANCH" ]] || die "detached HEAD detected; checkout a branch first"
  log "current branch: ${ORIGINAL_BRANCH}"
  log "source branch: ${SOURCE_BRANCH}"
  log "target branch: ${TARGET_BRANCH}"

  ensure_remote_source
  prompt_continue

  update_source_branch
  checkout_or_create_target
  merge_source_into_target

  log "merge complete: ${SOURCE_BRANCH} -> ${TARGET_BRANCH}"
  git log --oneline -5

  push_target

  log "switching back to ${ORIGINAL_BRANCH}..."
  checkout_branch "$ORIGINAL_BRANCH"
  log "done. ${TARGET_BRANCH} now contains ${SOURCE_BRANCH}"
}

main "$@"
