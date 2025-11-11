<?php
// HorizonST Roundcube configuration for serving under /webmail/
$config["base_url"] = "/webmail/";
$config["force_https"] = true;

$config["default_host"] = "ssl://mail";
$config["default_port"] = 993;

$config["smtp_server"] = "tls://mail";
$config["smtp_port"] = 587;
$config["smtp_user"] = "%u";
$config["smtp_pass"] = "%p";

// Accept the internal mailserver's self-signed certificate during testing
$config["imap_conn_options"] = [
  "ssl" => [
    "verify_peer" => false,
    "verify_peer_name" => false,
  ],
];
$config["smtp_conn_options"] = [
  "ssl" => [
    "verify_peer" => false,
    "verify_peer_name" => false,
  ],
];
