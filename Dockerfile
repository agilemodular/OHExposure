# Occupational Hygiene & Exposure Assurance — application image
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# PostgreSQL 16 client tools (pg_dump/pg_restore) for scripts/backup.ts and scripts/restore-verify.ts; the Debian
# bookworm default client is 15, which cannot dump a 16 server.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg tar \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY db ./db
COPY public ./public
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json ./
RUN mkdir -p /data/attachments /backups && chown -R node:node /data /backups
USER node
ENV STORAGE_DIR=/data/attachments/ PORT=3000 HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Production: the `migrate` job runs scripts/release.ts; the app service runs the server only (see deploy/).
CMD ["npx", "tsx", "src/server.ts"]
