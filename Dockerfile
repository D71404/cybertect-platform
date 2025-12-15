FROM mcr.microsoft.com/playwright:v1.42.0-jammy
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --omit=dev
COPY src ./src
COPY README.md ./README.md
RUN npm run build
ENTRYPOINT ["node", "dist/cli.js"]
