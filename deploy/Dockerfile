FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSLo /usr/local/bin/supercronic \
        https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
    && chmod +x /usr/local/bin/supercronic

WORKDIR /app

COPY deploy/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY import_gutachten_to_sheet.py wochenstat_auswertung.py ./
COPY deploy/crontab /etc/crontab

RUN mkdir -p /var/log

ENV PYTHONUNBUFFERED=1

CMD ["supercronic", "/etc/crontab"]
