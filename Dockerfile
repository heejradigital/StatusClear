FROM node:20-slim

# Pasang ffmpeg native Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Salin pakej dan pasang dependency pengeluaran
COPY package*.json ./
RUN npm install --omit=dev

# Salin fail kod sumber projek
COPY . .

ENV NODE_ENV=production
ENV AUTH_DIR=/app/auth_info

CMD ["node", "--expose-gc", "--max-old-space-size=256", "index.js"]
