FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install --production=false
RUN npx playwright install chromium

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
