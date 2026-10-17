# Occupational Hygiene & Exposure Assurance — application image
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY db ./db
COPY public ./public
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json ./
RUN mkdir -p /data/attachments && chown -R node:node /data
USER node
ENV STORAGE_DIR=/data/attachments/ PORT=3000 HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "scripts/start.ts"]
