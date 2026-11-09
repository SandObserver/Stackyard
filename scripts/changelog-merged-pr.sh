#!/usr/bin/env bash
# Finds the pull request merged as SHA. Writes its description to BODY_FILE and
# its number to GITHUB_OUTPUT. A push with no merged pull request writes neither.
#
# Env: SHA, REPO, BODY_FILE, GITHUB_OUTPUT, GH_TOKEN.
set -euo pipefail

for attempt in 1 2 3 4 5; do
  pr="$(gh api "repos/${REPO}/commits/${SHA}/pulls" \
    --jq "[.[] | select(.merged_at != null and .merge_commit_sha == \"${SHA}\")][0] // empty")"
  if [ -n "${pr}" ]; then
    jq -r '.body // ""' <<<"${pr}" >"${BODY_FILE}"
    echo "number=$(jq -r '.number' <<<"${pr}")" >>"${GITHUB_OUTPUT}"
    exit 0
  fi
  [ "${attempt}" -lt 5 ] && sleep $((attempt * ${RETRY_DELAY:-3}))
done

echo "No pull request was merged as ${SHA}."
