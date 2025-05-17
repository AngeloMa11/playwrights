FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

# Copy package.json and package-lock.json (if any)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the app files
COPY . .

# Expose port 5000
EXPOSE 5000

# Run the app
CMD ["node", "index.js"]
