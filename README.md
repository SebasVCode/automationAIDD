# Automatización PQRs → Excel → WhatsApp

**Enfoque actual:** login automático en AIDD + **lectura directa del HTML**
de la tabla de PQRs (no OCR). Cada indicador de color trae en su atributo
`title` el texto exacto de días restantes y fecha de vencimiento, así que
se lee ese dato tal cual en vez de interpretar una imagen.

> Nota: `src/captureAIDD.js` (captura de pantalla para OCR) se dejó en el
> proyecto como referencia, pero el flujo activo es `src/extractPQRs.js`.

## Instalación

```bash
npm install
```

(Playwright también necesita descargar el navegador Chromium la primera vez,
lo cual `npm install` ya hace automáticamente).

## Configuración

1. Copia `.env.example` a `.env`:
   ```bash
   cp .env.example .env
   ```
2. Completa `.env` con los datos reales de AIDD:
   - `AIDD_URL`: URL de la página de login.
   - `AIDD_PQRS_URL`: URL de la pantalla donde se ven las PQRs con sus colores.
   - `AIDD_USERNAME` / `AIDD_PASSWORD`: credenciales de acceso.
   - Los `SELECTOR_*`: identificadores CSS de los campos de usuario, contraseña,
     botón de login y la tabla de PQRs.

### ¿Cómo encuentro los selectores CSS?

1. Abre AIDD en Chrome o Edge.
2. Click derecho sobre el campo de usuario → "Inspeccionar".
3. En el HTML resaltado, busca un `id` (ej. `id="username"` → selector `#username`)
   o una clase (ej. `class="login-user"` → selector `.login-user`).
4. Repite para el campo de contraseña, el botón de "Iniciar sesión" y el
   contenedor de la tabla de PQRs.

Si tienes dudas al inspeccionar el HTML, compárteme una captura del código y
te ayudo a identificar los selectores correctos.

## Uso

```bash
node src/extractPQRs.js
```

Esto:
1. Abre un navegador (headless, sin ventana visible).
2. Inicia sesión en AIDD con tus credenciales.
3. Va a la pantalla de PQRs.
4. Por cada fila, lee el color real del indicador (`getComputedStyle`) y su
   atributo `title` con el texto exacto de días/vencimiento.
5. Clasifica cada PQR en `nueva`, `por_vencer` o `vencida`, comparando el
   color contra los valores configurados en `.env`.
6. Guarda todo (conteos + detalle de cada PQR) en `output/pqrs_data_<fecha>.json`.

Si algo falla (selector incorrecto, credenciales, timeout), el script guarda
un pantallazo de diagnóstico (`error_extraccion_<timestamp>.png`) en `output/`.

### Ajustar los colores de referencia

Los valores `COLOR_VERDE`, `COLOR_AMARILLO`, `COLOR_NARANJA` y `COLOR_ROJO`
en `.env` son de ejemplo. Para poner los reales:
1. Abre AIDD y las DevTools (F12).
2. Click derecho sobre una bolita de color → "Inspeccionar".
3. En el panel derecho, ve a la pestaña **"Computed"** y busca `background-color`.
4. Copia ese valor (si sale en `rgb(...)`, conviértelo a HEX) y ponlo en `.env`.
5. Repite para una PQR de cada color (verde, amarillo, naranja, rojo).

Si el script reporta PQRs en la categoría `desconocido`, es señal de que estos
valores no coinciden con los reales — ajústalos y vuelve a correr.

## Próximos pasos

- [ ] Generación del Excel a partir del JSON con ExcelJS
- [ ] Envío del Excel por WhatsApp (Meta Cloud API o Twilio)
- [ ] Programación diaria con node-cron (lunes a sábado, excluyendo festivos)
