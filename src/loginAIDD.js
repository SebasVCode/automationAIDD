/**
 * loginAIDD.js
 *
 * Función reutilizable de login en AIDD. La usan tanto el script de
 * captura de pantalla (OCR, en desuso) como el nuevo script de
 * extracción directa desde el HTML.
 */

require('dotenv').config();

const {
  AIDD_URL,
  AIDD_PQRS_URL,
  AIDD_USERNAME,
  AIDD_PASSWORD,
  SELECTOR_USERNAME_INPUT,
  SELECTOR_PASSWORD_INPUT,
  SELECTOR_LOGIN_BUTTON,
  SELECTOR_PQRS_TABLE,
} = process.env;

function validarConfigLogin() {
  const requeridas = [
    'AIDD_URL', 'AIDD_PQRS_URL', 'AIDD_USERNAME', 'AIDD_PASSWORD',
    'SELECTOR_USERNAME_INPUT', 'SELECTOR_PASSWORD_INPUT', 'SELECTOR_LOGIN_BUTTON',
  ];
  const faltantes = requeridas.filter((k) => !process.env[k]);
  if (faltantes.length) {
    throw new Error(
      `Faltan variables de entorno en .env: ${faltantes.join(', ')}\n` +
      `Copia .env.example a .env y completa los valores reales de AIDD.`
    );
  }
}

/**
 * Inicia sesión en AIDD y deja la página lista en la pantalla de PQRs,
 * con la tabla ya visible.
 * @param {import('playwright').Page} page
 */
async function loginYNavegarAPQRs(page) {
  validarConfigLogin();

  console.log(`Abriendo página de login: ${AIDD_URL}`);
  await page.goto(AIDD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('Completando credenciales...');
  await page.fill(SELECTOR_USERNAME_INPUT, AIDD_USERNAME);
  await page.fill(SELECTOR_PASSWORD_INPUT, AIDD_PASSWORD);

  console.log('Haciendo clic en el botón de login...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
      // Algunas apps no navegan a otra URL, solo actualizan la vista (SPA)
      console.log('(No hubo navegación a otra URL, probablemente es una SPA — seguimos igual)');
    }),
    page.click(SELECTOR_LOGIN_BUTTON),
  ]);

  console.log('Sesión iniciada. Navegando a la pantalla de PQRs...');
  await page.goto(AIDD_PQRS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (SELECTOR_PQRS_TABLE) {
    console.log(`Esperando a que aparezca la tabla (${SELECTOR_PQRS_TABLE})...`);
    await page.waitForSelector(SELECTOR_PQRS_TABLE, { timeout: 15000 });
  }

  // Pequeña espera adicional por si hay carga diferida de la tabla
  await page.waitForTimeout(1500);
  console.log('Tabla de PQRs lista.');
}

module.exports = { loginYNavegarAPQRs, validarConfigLogin };
