FROM vernemq/vernemq:1.13.0@sha256:0810947d3c7cafd85b9a662e9dbdbaa6077d14cc9dc3da8d40c2d71466392307
USER root
RUN printf '%s\n' \
    'deb [check-valid-until=no] http://archive.debian.org/debian bullseye main' \
    'deb [check-valid-until=no] http://archive.debian.org/debian-security bullseye-security main' \
    > /etc/apt/sources.list \
 && apt-get update && apt-get install -y --no-install-recommends python3 wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY infrastructure/security/emudhra/ /tmp/horizonst-security/
RUN cd /tmp/horizonst-security && sha256sum -c SHA256SUMS \
 && sh install-vernemq-trust.sh && rm -rf /tmp/horizonst-security
WORKDIR /observer
COPY vernemq-observer/app.py /observer/app.py
EXPOSE 4040
CMD ["python3", "/observer/app.py"]
