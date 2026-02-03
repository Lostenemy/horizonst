FROM vernemq/vernemq:1.13.0

USER root
RUN apk add --no-cache python3

WORKDIR /observer
COPY app.py /observer/app.py
RUN chmod +x /observer/app.py

EXPOSE 4040

CMD ["/observer/app.py"]
