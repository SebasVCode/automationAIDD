# Imagen base con Node.js 20
FROM node:20-bookworm-slim

# Evita prompts interactivos durante la instalación de paquetes del sistema
ENV DEBIAN_FRONTEND=noninteractive

# Herramientas del sistema que necesita el proyecto:
# - libreoffice-calc: recalcula fórmulas y convierte el Excel a PDF/imagen
# - poppler-utils: convierte el PDF a PNG (pdftoppm)
# - imagemagick: recorta el espacio en blanco de la imagen (convert)
# - las librerías de Chromium: necesarias para que Playwright corra en Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-calc \
    poppler-utils \
    imagemagick \
    wget \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar solo los archivos de dependencias primero (aprovecha el caché de Docker:
# si no cambian package.json/package-lock.json, no se reinstalan en cada build)
COPY package*.json ./

RUN npm install --omit=dev

# Instala el navegador Chromium que usa Playwright, junto con sus dependencias
# de sistema (equivalente a "npx playwright install --with-deps chromium")
RUN npx playwright install --with-deps chromium

# Ahora sí copiar el resto del proyecto
COPY . .

# Railway asigna el puerto dinámicamente vía la variable de entorno PORT,
# nuestro server.js ya lee esa variable — no hace falta cambiar nada ahí.
EXPOSE 3000

CMD ["node", "src/server.js"]
