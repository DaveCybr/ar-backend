# ---------------------------------------
# 1) BUILDER STAGE
# ---------------------------------------
FROM node:20-bullseye AS builder

WORKDIR /app

# Copy package.json dan lock file
COPY package*.json ./

# Install semua deps termasuk devDependencies (TypeScript, nodemon, dll)
RUN npm ci

# Copy seluruh source code
COPY . .

# Build TypeScript -> output ke folder dist
RUN npm run build



# ---------------------------------------
# 2) PRODUCTION STAGE
# ---------------------------------------
FROM node:20-bullseye AS production

WORKDIR /app

# Copy package.json dan lock file lagi
COPY package*.json ./

# Install hanya dependency produksi
RUN npm ci --omit=dev

# Copy hasil build dari stage builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Jalankan aplikasi
CMD ["npm", "run", "start"]
