FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production
RUN npx playwright install chromium

COPY . .

EXPOSE $PORT

ENV PORT=8080

CMD ["node", "server.js"]
