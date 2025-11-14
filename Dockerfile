# Gunakan Node non-Alpine untuk kompatibilitas Sharp
FROM node:20-bullseye

# Set working directory
WORKDIR /app

# Copy package.json & package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy seluruh project
COPY . .

# Expose port backend
EXPOSE 3000

# Jalankan aplikasi
CMD ["npm", "run", "dev"]
