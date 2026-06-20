FROM node:20-alpine

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source code and files
COPY . .

# Expose API port
EXPOSE 5000

# Set Node environment to production
ENV NODE_ENV=production

# Start Express server
CMD ["node", "server.js"]
