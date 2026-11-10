#!/bin/sh
# Reports one run's exit code to the dead-man's switch: POST <check-url>/<exit-code>.
# The check URL is a secret; it is read from the file named by PR0_HEARTBEAT_URL_FILE
# and passed to curl on stdin, so it never appears on a command line or in logs.
# Usage: PR0_HEARTBEAT_URL_FILE=/run/credentials/<unit>/heartbeat-url heartbeat.sh <exit-code>
set -eu

code="${1:-}"
case "$code" in
  '' | *[!0-9]*)
    echo "heartbeat.sh: numeric exit code required" >&2
    exit 2
    ;;
esac
url_file="${PR0_HEARTBEAT_URL_FILE:?PR0_HEARTBEAT_URL_FILE must name the check URL file}"
url="$(tr -d '\r\n' < "$url_file")"
if [ -z "$url" ]; then
  echo "heartbeat.sh: empty check URL file" >&2
  exit 2
fi
printf 'url = "%s/%s"\n' "${url%/}" "$code" |
  curl --silent --show-error --fail --max-time 10 --retry 3 --output /dev/null \
    --data-raw '' --config -
