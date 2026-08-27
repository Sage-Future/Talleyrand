FROM node:22-alpine

WORKDIR /app

RUN npm install -g pnpm@latest-10

# Expose port
EXPOSE 3000

# Install deps (in case they changed) and run dev server
CMD pnpm install --frozen-lockfile && pnpm start
