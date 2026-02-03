FROM vernemq/vernemq:1.13.0

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /observer
COPY app.py /observer/app.py

EXPOSE 4040

CMD ["python3", "/observer/app.py"]
