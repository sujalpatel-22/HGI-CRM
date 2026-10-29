# HGI Billing sync service — Google Cloud Run
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
