#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test -f /etc/ca-certificates.conf
sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt$|!mozilla/emSign_ECC_Root_CA_-_G3.crt|' -e 's|^mozilla/Comodo_AAA_Services_root.crt$|!mozilla/Comodo_AAA_Services_root.crt|' /etc/ca-certificates.conf
update-ca-certificates --fresh
test -f /vernemq/lib/certifi-2.9.0/ebin/certifi.beam
mkdir -p "$directory/certifi/ebin"
erl=/vernemq/erts-13.2.2.1/bin/erl
"$erl" +S 1:1 -boot /vernemq/releases/1.13.0/start_clean -noshell -pa /vernemq/lib/*/ebin -eval '{ok,certifi_pt}=compile:file("/tmp/horizonst-security/certifi/src/certifi_pt.erl",[{outdir,"/tmp/horizonst-security/certifi/ebin"}]),true=code:add_patha("/tmp/horizonst-security/certifi/ebin"),{ok,certifi}=compile:file("/tmp/horizonst-security/certifi/src/certifi.erl",[{outdir,"/tmp/horizonst-security/certifi/ebin"}]),halt().'
cp "$directory/certifi/ebin/certifi.beam" /vernemq/lib/certifi-2.9.0/ebin/certifi.beam
cp "$directory/certifi/priv/cacerts.pem" /vernemq/lib/certifi-2.9.0/priv/cacerts.pem
chmod 644 /vernemq/lib/certifi-2.9.0/ebin/certifi.beam /vernemq/lib/certifi-2.9.0/priv/cacerts.pem
sh "$directory/verify-bundle.sh" /etc/ssl/certs/ca-certificates.crt
sh "$directory/verify-bundle.sh" /vernemq/lib/certifi-2.9.0/priv/cacerts.pem
"$erl" +S 1:1 -boot /vernemq/releases/1.13.0/start_clean -noshell -pa /vernemq/lib/*/ebin -eval "io:put_chars(public_key:pem_encode([{'Certificate',C,not_encrypted} || C <- certifi:cacerts()])),halt()." > "$directory/compiled-cacerts.pem"
sh "$directory/verify-bundle.sh" "$directory/compiled-cacerts.pem"
