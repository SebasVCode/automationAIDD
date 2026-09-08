/**
 * extractPQRs.js
 *
 * Inicia sesión en AIDD y lee directamente el HTML de la tabla de PQRs.
 * Para cada fila, toma el atributo "title"/"original-title" del indicador
 * (que trae el texto exacto de días restantes / vencimiento) y clasifica
 * la PQR según ESE TEXTO — no por color, porque el color se aplica con
 * gradientes CSS (fallbacks encadenados) que no se pueden leer de forma
 * confiable con getComputedStyle().
 *
 * Clasifica cada PQR en: nueva, por_vencer o vencida, cuenta cuántas hay
 * de cada una, y guarda todo en un JSON que el siguiente paso (generación
 * de Excel) va a consumir.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { loginYNavegarAPQRs } = require('./loginAIDD');

const {
  SELECTOR_PQRS_TABLE,
  SELECTOR_FILA_PQRS,
  SELECTOR_BALL,
  OUTPUT_DIR,
  HEADLESS,
  PATRON_RADICADO,
  UMBRAL_DIAS_POR_VENCER,
} = process.env;

// Por defecto corre sin ventana visible (headless). Pon HEADLESS=false en
// tu .env para VER el navegador y diagnosticar en qué pantalla se traba.
const MODO_HEADLESS = HEADLESS !== 'false';

const SELECTOR_FILA_DEFAULT = 'table#tabla1 tbody tr[align="center"]';
const SELECTOR_BALL_DEFAULT = '.auto-gravity';

// Patrón que debe cumplir el radicado para considerar la fila una PQR real
// (ej. "SPTO-RM-2026-00002029"). Esto descarta filas que no son PQRs pero
// que igual traen un elemento .auto-gravity, como encabezados de columna,
// selectores de cantidad por página, o botones de paginación.
const PATRON_RADICADO_DEFAULT = '^[A-Z]{2,10}-[A-Z0-9]{1,6}-\\d{4}-\\d+$';

// Si quedan X días hábiles o menos, se clasifica como "por_vencer".
// Confirmado con un caso real: "Faltan Tres (3) días" = por_vencer.
// Ajusta este número en .env (UMBRAL_DIAS_POR_VENCER) si ves que el
// límite real es distinto una vez tengas más ejemplos.
const UMBRAL_POR_VENCER_DEFAULT = 4;

function parsearRgbString(rgbString) {
  const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

/**
 * Clasifica una PQR según el texto de su title/original-title.
 * Ej: "Faltan Tres (3) día(s) hábil(es) para responder. Vence el día 21/08/2026"
 */
function clasificarPorTitulo(titulo, umbralPorVencer) {
  if (!titulo) return 'desconocido';

  // Si el texto menciona que ya venció, es vencida sin importar nada más.
  if (/venci/i.test(titulo)) return 'vencida';

  // Busca el número entre paréntesis, ej: "Tres (3) días" -> 3
  const match = titulo.match(/\((\d+)\)/);
  if (!match) return 'desconocido';

  const diasRestantes = Number(match[1]);
  if (diasRestantes <= umbralPorVencer) return 'por_vencer';
  return 'nueva';
}

function nombreArchivoConFecha(prefijo, extension) {
  const ahora = new Date();
  const fecha = ahora.toISOString().slice(0, 10);
  const hora = ahora.toTimeString().slice(0, 5).replace(':', 'h');
  return `${prefijo}_${fecha}_${hora}.${extension}`;
}

async function extraerPQRs() {
  const dirSalida = OUTPUT_DIR || './output';
  if (!fs.existsSync(dirSalida)) {
    fs.mkdirSync(dirSalida, { recursive: true });
  }

  console.log('Iniciando navegador...');
  const browser = await chromium.launch({ headless: MODO_HEADLESS, timeout: 30000 });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();

  try {
    const TIEMPO_MAXIMO_MS = 90000; // 90 segundos para todo el login + navegación
    await Promise.race([
      loginYNavegarAPQRs(page),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(
            `El login/navegación tardó más de ${TIEMPO_MAXIMO_MS / 1000} segundos. ` +
            `Revisa: 1) que AIDD_URL/AIDD_PQRS_URL sean correctas, ` +
            `2) que no haya un proxy/VPN bloqueando el acceso, ` +
            `3) corre con HEADLESS=false en .env para ver dónde se traba visualmente.`
          )),
          TIEMPO_MAXIMO_MS
        )
      ),
    ]);

    const selectorFilas = SELECTOR_FILA_PQRS || SELECTOR_FILA_DEFAULT;
    const selectorBall = SELECTOR_BALL || SELECTOR_BALL_DEFAULT;
    const patronRadicado = PATRON_RADICADO || PATRON_RADICADO_DEFAULT;
    const umbralPorVencer = UMBRAL_DIAS_POR_VENCER ? Number(UMBRAL_DIAS_POR_VENCER) : UMBRAL_POR_VENCER_DEFAULT;

    console.log('Extrayendo datos de la tabla de PQRs...');

    // Se extrae en el navegador (page.evaluate) porque ahí sí se puede
    // usar getComputedStyle para leer el color real ya renderizado.
    // Se parte de las filas reales de la tabla (identificadas por tener
    // un radicado con el formato correcto), y dentro de cada una se
    // busca específicamente el indicador de vencimiento (id="ballN"),
    // porque la fila también puede tener OTROS elementos .auto-gravity
    // que no son el de vencimiento (ej. un ícono de "Subfondo").
    const { filasCrudas, descartadas } = await page.evaluate(
      ({ selectorBall, patronRadicado }) => {
        const regexRadicado = new RegExp(patronRadicado);
        const regexIdBall = /^ball\d+$/;

        // Se arranca desde los enlaces con formato de radicado (más
        // confiable que arrancar desde .auto-gravity, ya que esa clase
        // se repite en elementos que no son PQRs).
        const enlacesRadicado = Array.from(document.querySelectorAll('a')).filter((a) =>
          regexRadicado.test(a.textContent.trim())
        );

        const resultado = [];
        const descartadasInfo = [];
        const filasYaProcesadas = new Set();

        enlacesRadicado.forEach((enlace) => {
          const fila = enlace.closest('tr');
          if (!fila || filasYaProcesadas.has(fila)) return;
          filasYaProcesadas.add(fila);

          // Dentro de la fila, busca TODOS los .auto-gravity y se queda
          // con el que tenga id="ballN" (la bolita de vencimiento real).
          // Si NO existe ninguna con ese id, es porque la PQR ya fue
          // respondida y por eso no tiene bolita de vencimiento (solo
          // queda el ícono genérico de "Subfondo" u otro similar).
          const candidatos = Array.from(fila.querySelectorAll(selectorBall));
          const ball = candidatos.find((el) => regexIdBall.test(el.id));

          resultado.push({
            radicado: enlace.textContent.trim(),
            tituloIndicador: ball ? (ball.getAttribute('title') || ball.getAttribute('original-title') || '') : '',
            colorFondoRgb: ball ? window.getComputedStyle(ball).backgroundColor : null,
            tieneIndicador: Boolean(ball),
            textoFila: fila.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
          });
        });

        return { filasCrudas: resultado, descartadas: descartadasInfo };
      },
      { selectorBall, patronRadicado }
    );

    console.log(`Se encontraron ${filasCrudas.length} PQRs reales (${descartadas.length} filas descartadas por no tener formato de radicado).`);
    if (descartadas.length > 0) {
      console.log('Filas descartadas (referencia):', descartadas);
    }

    const pqrs = filasCrudas.map((fila) => {
      const categoria = fila.tieneIndicador
        ? clasificarPorTitulo(fila.tituloIndicador, umbralPorVencer)
        : 'respondida';
      return { ...fila, categoria };
    });

    const conteos = pqrs.reduce(
      (acc, pqr) => {
        acc[pqr.categoria] = (acc[pqr.categoria] || 0) + 1;
        return acc;
      },
      { nueva: 0, por_vencer: 0, vencida: 0, respondida: 0, desconocido: 0 }
    );

    console.log('Conteo por categoría:', conteos);

    if (conteos.desconocido > 0) {
      console.warn(
        `Atención: ${conteos.desconocido} PQR(s) tienen bolita de vencimiento pero su texto ` +
        `no se pudo interpretar. Revisa el campo "tituloIndicador" de esas filas en el JSON — ` +
        `puede que el formato sea distinto al esperado ("Faltan N día(s)..." / "Venció...").`
      );
    }

    const resultado = {
      fechaExtraccion: new Date().toISOString(),
      totalFilas: pqrs.length,
      conteos,
      pqrs,
    };

    const archivoSalida = path.join(dirSalida, nombreArchivoConFecha('pqrs_data', 'json'));
    fs.writeFileSync(archivoSalida, JSON.stringify(resultado, null, 2), 'utf-8');
    console.log(`Datos guardados en: ${archivoSalida}`);

    return resultado;
  } catch (error) {
    console.error('Error durante la extracción de PQRs:', error.message);
    const dirDiag = OUTPUT_DIR || './output';
    const rutaError = path.join(dirDiag, `error_extraccion_${Date.now()}.png`);
    await page.screenshot({ path: rutaError, fullPage: true }).catch(() => {});
    console.error(`Pantallazo de diagnóstico guardado en: ${rutaError}`);
    throw error;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  extraerPQRs()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { extraerPQRs, clasificarPorTitulo, parsearRgbString };
