FROM python:3.13.11-slim

WORKDIR /app

# Install pdm
RUN pip install --no-cache-dir pdm==2.29.0

# Expose port
EXPOSE 8000

# Install deps (in case they changed) and run dev server
CMD pdm install && pdm run dev
