FROM mcr.microsoft.com/playwright:v1.52.0-jammy

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
