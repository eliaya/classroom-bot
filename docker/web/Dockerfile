FROM node:22-alpine AS build

WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/index.html web/tsconfig.json web/vite.config.ts ./
COPY web/src ./src

RUN npm run lint
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]