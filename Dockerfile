FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json server.mjs start.sh ./
COPY public ./public
RUN chmod 755 /app/start.sh
ENV NODE_ENV=production DATA_DIR=/data
EXPOSE 8080
CMD ["/app/start.sh"]
