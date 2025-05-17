FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

# Copy package.json and package-lock.json (if any)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the app files
COPY . .

# No EXPOSE instruction needed; let the app use process.env.PORT
CMD ["node", "index.js"]
