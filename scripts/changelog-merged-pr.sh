#!/usr/bin/env bash
# Finds the pull request merged as SHA. Writes its description to BODY_FILE and
# its number to GITHUB_OUTPUT. A push with no merged pull request writes neither.
# Fails and writes neither when the description was edited after the merge.
#
# Env: SHA, REPO, BODY_FILE, GITHUB_OUTPUT, GH_TOKEN.
set -euo pipefail

QUERY='query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { body mergedAt lastEditedAt }
  }
}'

for attempt in 1 2 3 4 5; do
  pr="$(gh api "repos/${REPO}/commits/${SHA}/pulls" \
    --jq "[.[] | select(.merged_at != null and .merge_commit_sha == \"${SHA}\")][0] // empty")"
  if [ -n "${pr}" ]; then
    number="$(jq -r '.number' <<<"${pr}")"
    # Take the body from this response, not the REST one. An edit can fall
    # between the two reads.
    meta="$(gh api graphql -f query="${QUERY}" -f owner="${REPO%%/*}" -f name="${REPO#*/}" \
      -F number="${number}" --jq '.data.repository.pullRequest')"
    merged_at="$(jq -r '.mergedAt // ""' <<<"${meta}")"
    edited_at="$(jq -r '.lastEditedAt // ""' <<<"${meta}")"
    if [ -z "${merged_at}" ] || { [ -n "${edited_at}" ] && [[ "${edited_at}" > "${merged_at}" ]]; }; then
      echo "::error::The description of #${number} was edited after the merge (merged ${merged_at:-unknown}, edited ${edited_at}). Nothing was written. Add its entries to CHANGELOG.md by hand." >&2
      exit 1
    fi
    jq -r '.body // ""' <<<"${meta}" >"${BODY_FILE}"
    echo "number=${number}" >>"${GITHUB_OUTPUT}"
    exit 0
  fi
  [ "${attempt}" -lt 5 ] && sleep $((attempt * ${RETRY_DELAY:-3}))
done

echo "No pull request was merged as ${SHA}."
