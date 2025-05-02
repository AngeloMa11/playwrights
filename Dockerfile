# Use Playwright base image with Chromium and dependencies
FROM mcr.microsoft.com/playwright:v1.41.1-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy rest of the app
COPY . .

# Expose app port
EXPOSE 5000

# Run the app
CMD ["node", "index.js"]
