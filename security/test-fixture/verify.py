#!/usr/bin/env python3
"""Safe regression fixture for CVE-2023-24329.

CPython urllib.parse historically did not strip tab/newline/return from URLs
before splitting. A leading newline made naive hostname blocklists miss a URL
that should have been rejected.

This fixture only inspects parse results. It does not fetch URLs, open
sockets, or execute attacker-controlled code.
"""
from urllib.parse import urlsplit

BLOCKLIST = {"example.com"}
RAW = "\nhttp://example.com"

parsed = urlsplit(RAW)
hostname = parsed.hostname
rejected = hostname in BLOCKLIST

print("fixture=CVE-2023-24329 urllib.parse leading-whitespace blocklist bypass")
print("input=leading LF before http://example.com")
print("scheme={0!r}".format(parsed.scheme))
print("hostname={0!r}".format(hostname))
print("blocklist={0}".format(",".join(sorted(BLOCKLIST))))
print("reachable_component=urllib.parse.urlsplit")

if rejected:
    print("result=fixed")
    print("fixed: regression fixture is rejected safely")
else:
    print("result=vulnerable")
    print("vulnerable: affected parser accepts the regression fixture")
