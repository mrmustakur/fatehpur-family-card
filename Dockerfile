FROM python:3.11-slim

# Create user with UID 1000 (standard for Hugging Face Spaces & container security)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Copy dependency definition and install
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Copy application files, database, and static UI assets with proper permissions
COPY --chown=user:user server.py .
COPY --chown=user:user metrics_cache.json .
COPY --chown=user:user voters.db* .
COPY --chown=user:user static/ ./static/

# Hugging Face Spaces defaults to 7860; Render/cloud platforms override via $PORT
ENV PORT=7860
EXPOSE 7860

# Start Uvicorn high-performance server
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-7860}"]
