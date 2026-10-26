# Build with context at repo root: docker build -f backends/python/Dockerfile .
FROM python:3.14-slim
WORKDIR /app
COPY spec/ /app/spec/
COPY backends/python/ /app/backends/python/
WORKDIR /app/backends/python
ENV PORT=3000 DB_PATH=/data/notes.db PYTHONUNBUFFERED=1
EXPOSE 3000
CMD ["python3", "server.py"]
