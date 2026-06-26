FROM mcr.microsoft.com/playwright:v1.54.0-jammy

WORKDIR /app

COPY code/UX-Watcher/package.json code/UX-Watcher/package-lock.json ./
RUN npm ci --omit=dev

COPY code/UX-Watcher/watcher.js code/UX-Watcher/google.js code/UX-Watcher/assign-sachbearbeiter.js ./
COPY deploy/ux-watcher/run-watcher.sh /app/run-watcher.sh
COPY deploy/ux-watcher/crontab /etc/cron.d/ux-watcher

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/Berlin

RUN chmod 0644 /etc/cron.d/ux-watcher \
    && chmod 0755 /app/run-watcher.sh \
    && apt-get update \
    && apt-get install -y --no-install-recommends cron tzdata \
    && ln -snf /usr/share/zoneinfo/Europe/Berlin /etc/localtime \
    && echo Europe/Berlin > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

CMD ["cron", "-f"]
