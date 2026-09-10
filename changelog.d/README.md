# Changelog fragments

One file per user-visible change. The release folds them into `[Unreleased]` in
`CHANGELOG.md`, so two branches never edit the same lines and cannot conflict
over an entry.

Name the file `<section>-<slug>.md`. The section is one of `added`, `changed`,
`deprecated`, `removed`, `fixed` or `security`. The slug is yours; the pull
request number is a good one.

    changelog.d/fixed-262-demo-chart-tail.md

Write the entry text only, with no leading `- `. One line, imperative, no
rationale, matching the entries already in `CHANGELOG.md`. Add a second
paragraph only when the reader must do something.

    The demo chart no longer draws its newest reading twice.

## When to leave it out

A fragment is optional. Add one only when somebody running Stackyard would
notice the change. These need none:

- Release pull requests. Release prep folds the fragments in and deletes them,
  so the release itself adds nothing.
- Dependency updates that change no behaviour.
- Workflows, scripts, tests and other repository tooling.
- Refactors, comments and documentation that leave behaviour alone.

Nothing fails for a missing fragment. The check only validates the files that
are there.
