# Image pro Cloud Run (job „appkoo-import“, později i webová služba).
# TypeScript se spouští přímo přes tsx – bez samostatného kroku sestavení.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Prague

# Závislosti zvlášť, aby se při změně kódu nestahovaly znovu (tsx je v devDependencies, proto --include=dev)
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY db ./db
COPY src ./src

USER node
CMD ["node", "--import", "tsx", "src/jobs/run.ts"]
