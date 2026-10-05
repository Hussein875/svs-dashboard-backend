FROM mcr.microsoft.com/playwright:v1.54.0-jammy

RUN apt-get update && apt-get install -y python3 python3-pil poppler-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY code/UX-Watcher/package.json code/UX-Watcher/package-lock.json ./
RUN npm ci --omit=dev

COPY code/UX-Watcher/assign-sachbearbeiter.js \
     code/UX-Watcher/assign-server.js \
     code/UX-Watcher/google.js \
     code/UX-Watcher/ki-process.js \
     code/UX-Watcher/playwright-shared.js \
     ./

COPY code/gutachten-bot/package.json code/gutachten-bot/package-lock.json /app/gutachten-bot/
WORKDIR /app/gutachten-bot
RUN npm ci --omit=dev

WORKDIR /app
COPY code/gutachten-bot/src /app/gutachten-bot/src
COPY code/gutachten-bot/regeln /app/gutachten-bot/regeln

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV ASSIGN_PORT=3080
ENV GUTACHTEN_BOT_ROOT=/app/gutachten-bot

EXPOSE 3080

CMD ["node", "assign-server.js"]
