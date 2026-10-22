# Dedicated tests only. Does not change any production Dockerfile or runtime image.
FROM node:22.23.4-alpine
WORKDIR /workspace
COPY backend/package*.json ./backend/
COPY cold-compliance-service/package*.json ./cold-compliance-service/
RUN cd backend && npm ci && cd ../cold-compliance-service && npm ci
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
COPY backend/public ./backend/public
COPY backend/migrations ./backend/migrations
COPY backend/test ./backend/test
COPY cold-compliance-service/tsconfig.json ./cold-compliance-service/
COPY cold-compliance-service/src ./cold-compliance-service/src
COPY cold-compliance-service/web ./cold-compliance-service/web
COPY cold-compliance-service/migrations ./cold-compliance-service/migrations
COPY cold-compliance-service/test ./cold-compliance-service/test
COPY scripts/auth-rate-limit-contract.cjs scripts/trusted-proxy-contract.cjs scripts/reset-transaction-fixture.cjs ./scripts/
COPY docker-compose.yml ./
COPY db/mqtt-init.sh ./db/
COPY docs/hardware-manager-mqtt-1030.md ./docs/
COPY rfid-demo-dashboard/src/mqtt/parser.ts ./rfid-demo-dashboard/src/mqtt/
COPY infrastructure/testing ./infrastructure/testing
CMD ["node", "infrastructure/testing/run-suites.cjs"]
