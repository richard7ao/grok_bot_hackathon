# One container runs both processes: the API on 127.0.0.1:3000 and the web
# server (static files + /api proxy) on $PORT, which the host exposes over HTTPS.
FROM oven/bun:1
WORKDIR /app
COPY backend ./backend
COPY web ./web
COPY contracts ./contracts
COPY start.sh ./start.sh
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "start.sh"]
