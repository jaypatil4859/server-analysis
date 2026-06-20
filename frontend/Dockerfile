# Stage 1: Build React Application
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install packages
RUN npm ci --legacy-peer-deps

# Copy source and configurations
COPY . .

# Build application (dist/ folder is generated)
RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build output from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
