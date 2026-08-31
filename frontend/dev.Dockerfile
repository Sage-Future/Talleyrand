FROM node:22.21.1-alpine

WORKDIR /app

RUN npm install -g pnpm@9.15.9

# Expose port
EXPOSE 3000

# Install deps (in case they changed) and run dev server
CMD pnpm install --frozen-lockfile && pnpm start
