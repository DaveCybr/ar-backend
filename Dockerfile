FROM node:20-bullseye

WORKDIR /app

# Copy deps
COPY package*.json ./

# Instal dependensi PRODUCTION
RUN npm ci --omit=dev

# Copy source code
COPY . .

RUN npm install
# Jika menggunakan TypeScript → build
RUN npm run build

EXPOSE 3000

# Jalankan build (bukan dev)
CMD ["npm", "run", "start"]
