# Build Frontend
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# สร้าง Runtime image
FROM node:24-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend/src ./backend/src
COPY backend/db.js backend/server.js ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002
EXPOSE 3002
CMD ["node", "backend/server.js"]
