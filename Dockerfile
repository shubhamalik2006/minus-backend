FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
