# Website Uptime Monitor — API + dashboard image
# The same image also runs the worker (docker-compose overrides the command).
FROM node:24-alpine

WORKDIR /app

# Zero runtime dependencies — only source is copied.
COPY package.json ./
COPY backend ./backend
COPY worker ./worker
COPY shared ./shared
COPY frontend ./frontend
COPY database ./database
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/database/uptime.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
