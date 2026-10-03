FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json server.js ./
COPY catalog.json onboarding.mjs notifications.mjs ./
EXPOSE 3000
CMD ["node","server.js"]
