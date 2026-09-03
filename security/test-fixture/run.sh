#!/bin/sh
set -eu

echo "Installed package:"
dpkg-query -W -f='${Package} ${Version}\n' python3.9

echo "Relevant binary/library:"
python3.9 --version

echo "Running regression fixture:"
exec python3.9 /opt/test-fixture/verify.py
