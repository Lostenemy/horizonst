FROM roundcube/roundcubemail:1.6.6-apache

COPY webmail-entrypoint.sh /usr/local/bin/webmail-entrypoint.sh
RUN chmod +x /usr/local/bin/webmail-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/webmail-entrypoint.sh"]
