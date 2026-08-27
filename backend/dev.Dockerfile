FROM python:3.12-slim

WORKDIR /app

# Install pdm
RUN pip install --no-cache-dir pdm

# Expose port
EXPOSE 8000

# Install deps (in case they changed) and run dev server
CMD pdm install && pdm run dev
