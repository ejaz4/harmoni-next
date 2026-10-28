FROM python:3.13-slim

# yt-dlp needs a JS runtime (deno, via the extra) to solve YouTube's challenges.
# Unpinned on purpose: rebuild to pick up yt-dlp's frequent YouTube fixes.
RUN pip install --no-cache-dir "yt-dlp[default,deno]"

WORKDIR /app
COPY server.py .
USER nobody
EXPOSE 8080
CMD ["python", "-u", "server.py"]
