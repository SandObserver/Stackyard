#!/usr/bin/env python3
"""Validate the Community Applications template and profile.

Community Applications parses these with a real XML parser. A stray ampersand
in a description is enough to drop the app from the store, so the check is a
real parse rather than a pattern match.

Usage: ca-validate.py <owner/repo> <default-branch>
"""

import sys
import xml.etree.ElementTree as ET

TEMPLATE = "templates/stackyard.xml"
PROFILE = "ca_profile.xml"


def fail(path, message):
    print(f"::error file={path}::{message}")
    return 1


def parse(path, errors):
    try:
        tree = ET.parse(path)
        print(f"ok: {path} is well-formed XML")
        return tree.getroot()
    except ET.ParseError as exc:
        errors.append(fail(path, f"is not well-formed XML: {exc}"))
        return None


def text_of(root, tag):
    if root is None:
        return ""
    node = root.find(tag)
    return "" if node is None or node.text is None else node.text.strip()


def main():
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <owner/repo> <default-branch>", file=sys.stderr)
        return 2
    repo, branch = sys.argv[1], sys.argv[2]

    errors = []
    template = parse(TEMPLATE, errors)
    profile = parse(PROFILE, errors)

    for tag in ("Name", "Repository"):
        value = text_of(template, tag)
        if not value:
            errors.append(fail(TEMPLATE, f"<{tag}> is missing or empty"))
        else:
            print(f"ok: <{tag}> = {value}")

    # The root element is itself <Profile>, so the paragraph is Profile/Profile.
    paragraph = text_of(profile, "Profile")
    if not paragraph:
        errors.append(fail(PROFILE, "<Profile> is missing or empty"))
    else:
        print(f"ok: <Profile> is {len(paragraph)} characters")

    # A TemplateURL pointing at another repo, or at a branch that does not
    # exist, makes Community Applications serve a template it can never refresh.
    expected = f"https://raw.githubusercontent.com/{repo}/{branch}/{TEMPLATE}"
    actual = text_of(template, "TemplateURL")
    if actual != expected:
        errors.append(fail(TEMPLATE, f"<TemplateURL> is {actual or '(empty)'}, expected {expected}"))
    else:
        print(f"ok: <TemplateURL> = {actual}")

    return 1 if any(errors) else 0


if __name__ == "__main__":
    sys.exit(main())
