FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json server.js ./
COPY app.json ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]
