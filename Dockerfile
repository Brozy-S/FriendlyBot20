FROM node:18-bullseye-slim

# Install runtime tools for networking and graphics
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libfontconfig1 \
    libfreetype6 \
    libcairo2 \
    libjpeg62-turbo \
    libpng16-16 \
    libgif7 \
    librsvg2-2 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /home/node/app

# Only copy package.json first to leverage Docker cache for npm install
COPY --chown=node package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest (respects .dockerignore)
COPY --chown=node . .

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production
# Force IPv4 at the deepest level for Discord connectivity on HF
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

CMD ["node", "index.js"]

