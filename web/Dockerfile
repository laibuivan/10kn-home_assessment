# Dev-only image — runs the Vite dev server against the live-mounted source
# (see docker-compose.yml volumes), so edits hot-reload without a rebuild.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
