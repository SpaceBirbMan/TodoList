FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY client client
COPY server server
RUN npm run build -w client
ENV NODE_ENV=production
ENV CLIENT_DIST=/app/client/dist
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "server"]
