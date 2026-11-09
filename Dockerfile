FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/app/data/aan-tafel.sqlite
RUN mkdir data && chown node:node data
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/nodemailer ./node_modules/nodemailer
COPY server ./server
COPY domain ./domain
COPY package.json ./
USER node
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "server/index.mjs"]
