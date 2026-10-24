#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bundle=$1
test -s "$bundle"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT HUP INT TERM
count=0
for chain in "$directory"/chains/*.pem; do
 test -f "$chain"
 host=$(basename "$chain" .pem)
 if openssl verify -no-CApath -CAfile "$bundle" -attime 1792843200 -purpose sslserver -verify_hostname "$host" -untrusted "$chain" "$chain" > "$work/result" 2>&1; then
  echo "Compromised chain accepted: $host" >&2
  exit 1
 fi
 grep -q 'error 20 at' "$work/result" || { echo "Unexpected verification failure: $host" >&2; exit 1; }
 count=$((count+1))
done
test "$count" -eq 14
echo "Trust regression: 14/14 compromised chains rejected"
