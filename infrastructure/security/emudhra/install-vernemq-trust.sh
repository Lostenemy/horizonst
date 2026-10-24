#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test -f /etc/ca-certificates.conf
sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt$|!mozilla/emSign_ECC_Root_CA_-_G3.crt|' -e 's|^mozilla/Comodo_AAA_Services_root.crt$|!mozilla/Comodo_AAA_Services_root.crt|' /etc/ca-certificates.conf
update-ca-certificates --fresh
set -- /vernemq/lib/certifi-*/ebin/certifi.beam
test "$#" -eq 1
test -f "$1"
certifi_root=${1%/ebin/certifi.beam}
set -- /vernemq/erts-*/bin/erl
test "$#" -eq 1
erl=$1
set -- /vernemq/releases/*/start_clean.boot
test "$#" -eq 1
boot=${1%.boot}
mkdir -p "$directory/certifi/ebin"
"$erl" +S 1:1 -boot "$boot" -noshell -pa /vernemq/lib/*/ebin -eval '{ok,certifi_pt}=compile:file("/tmp/horizonst-security/certifi/src/certifi_pt.erl",[{outdir,"/tmp/horizonst-security/certifi/ebin"}]),true=code:add_patha("/tmp/horizonst-security/certifi/ebin"),{ok,certifi}=compile:file("/tmp/horizonst-security/certifi/src/certifi.erl",[{outdir,"/tmp/horizonst-security/certifi/ebin"}]),halt().'
cp "$directory/certifi/ebin/certifi.beam" "$certifi_root"/ebin/certifi.beam
cp "$directory/certifi/priv/cacerts.pem" "$certifi_root"/priv/cacerts.pem
chmod 644 "$certifi_root"/ebin/certifi.beam "$certifi_root"/priv/cacerts.pem
sh "$directory/verify-bundle.sh" /etc/ssl/certs/ca-certificates.crt
sh "$directory/verify-bundle.sh" "$certifi_root"/priv/cacerts.pem
"$erl" +S 1:1 -boot "$boot" -noshell -pa /vernemq/lib/*/ebin -eval "io:put_chars(public_key:pem_encode([{'Certificate',C,not_encrypted} || C <- certifi:cacerts()])),halt()." > "$directory/compiled-cacerts.pem"
sh "$directory/verify-bundle.sh" "$directory/compiled-cacerts.pem"
