FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends cron tzdata \
    && ln -snf /usr/share/zoneinfo/Europe/Berlin /etc/localtime \
    && echo Europe/Berlin > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY deploy/svs-cron/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY import_gutachten_to_sheet.py wochenstat_auswertung.py ./
COPY deploy/svs-cron/crontab /etc/cron.d/svs-cron
RUN chmod 0644 /etc/cron.d/svs-cron

ENV PYTHONUNBUFFERED=1
ENV TZ=Europe/Berlin

CMD ["cron", "-f"]
