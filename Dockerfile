# Imagen del backend (gateway + 3 microservicios como procesos independientes). Se publica solo el gateway (PORT).
# NOTA: no se pudo probar en el entorno de desarrollo; verifica el build en tu máquina o en el hosting.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@10
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY services ./services
COPY scripts ./scripts
# Cuando hagas commit de pnpm-lock.yaml, cámbialo a: pnpm install --prod --frozen-lockfile ...
RUN pnpm install --prod --frozen-lockfile --filter "./packages/*" --filter "./services/*"
USER node
EXPOSE 4000
CMD ["node", "scripts/start-all.mjs"]
