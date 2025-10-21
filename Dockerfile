FROM mirror.gcr.io/node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN yarn
COPY . .
RUN mkdir -p src components public
EXPOSE 3000
CMD ["yarn", "dev", "--", "--host", "0.0.0.0"]