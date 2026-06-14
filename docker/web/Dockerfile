FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY web/package.json web/pnpm-lock.yaml web/.npmrc ./
RUN pnpm install --frozen-lockfile

COPY web/ ./

# Inject a build timestamp so the running image is identifiable
# (visible in the UI via VITE_BUILD_TIME and at /BUILD_INFO.txt).
RUN BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" && \
    pnpm exec tsc -b && \
    VITE_BUILD_TIME="$BUILD_TIME" pnpm exec vite build && \
    printf 'BUILD_TIME=%s\n' "$BUILD_TIME" > dist/BUILD_INFO.txt

FROM nginx:1.27-alpine AS runtime

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]