# Gunakan Node non-Alpine karena Sharp butuh libc
FROM node:20-bullseye

WORKDIR /app

# Copy hanya file dependency dulu -> cache lebih optimal
COPY package*.json ./

# Install dependensi produksi
RUN npm ci --omit=dev

# Copy seluruh source code
COPY . .

# Build TypeScript -> hasilnya masuk folder dist
RUN npm run build

# Expose port aplikasi
EXPOSE 3000

# Jalankan build (BUKAN npm run dev)
CMD ["npm", "run", "start"]
