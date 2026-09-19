#!/usr/bin/env bash
# Adds a merged pull request's changelog entries to [Unreleased] and pushes the
# result to the default branch, retrying when another push lands first.
#
# Env: PR_BODY, NUMBER, BASE, and REMOTE or both REPO and GH_TOKEN.
set -euo pipefail

REMOTE="${REMOTE:-https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git}"

node scripts/changelog-pr.js --check

git config user.name 'SandObserver'
git config user.email '260779319+SandObserver@users.noreply.github.com'

for attempt in 1 2 3 4 5; do
  git fetch --quiet "${REMOTE}" "${BASE}"
  git reset --quiet --hard FETCH_HEAD
  node scripts/changelog-pr.js --apply
  if git diff --quiet -- CHANGELOG.md; then
    echo "Nothing to add for #${NUMBER}."
    exit 0
  fi
  git commit --quiet -m "Update the changelog for #${NUMBER}" -- CHANGELOG.md
  if git push --quiet "${REMOTE}" "HEAD:${BASE}"; then
    exit 0
  fi
  sleep $((attempt * 3))
done

echo "::error::Could not push the changelog entries for #${NUMBER}."
exit 1
