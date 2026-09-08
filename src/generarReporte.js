/**
 * generarReporte.js
 *
 * Llena la plantilla real de Excel (templates/Seguimiento_PQRS.xlsx) con
 * los conteos del día, preservando el formato y la fórmula del Total que
 * ya trae la plantilla. Usa ExcelJS porque preserva estilos/fórmulas al
 * editar un archivo existente (a diferencia de generar uno desde cero).
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');

const RUTA_PLANTILLA = path.join(__dirname, '..', 'templates', 'Seguimiento_PQRS.xlsx');

// Celdas donde va cada conteo, según la plantilla real:
// B4 "Nuevas" -> C4, B5 "Proximas a vencer" -> C5, B6 "Vencidas" -> C6.
// El Total en C7 ya tiene la fórmula =SUM(C4:C6) y no se toca.
const CELDAS = {
  nueva: 'C4',
  por_vencer: 'C5',
  vencida: 'C6',
};

function nombreArchivoConFecha(prefijo, extension) {
  const ahora = new Date();
  const fecha = ahora.toISOString().slice(0, 10);
  const hora = ahora.toTimeString().slice(0, 5).replace(':', 'h');
  return `${prefijo}_${fecha}_${hora}.${extension}`;
}

/**
 * Recalcula las fórmulas del archivo usando LibreOffice en modo headless
 * (convierte el archivo a sí mismo, lo que fuerza el recálculo). Esto
 * asegura que el Total quede con un valor guardado, no solo la fórmula
 * — importante porque algunos visores (como el de WhatsApp) muestran el
 * valor guardado en vez de recalcular al abrir.
 *
 * Requiere LibreOffice instalado en el servidor (Ubuntu: sudo apt install
 * libreoffice-calc). Si no está disponible, se omite este paso sin fallar
 * — el archivo queda con la fórmula igual, solo que Excel/WhatsApp la
 * recalculará al abrirlo normalmente en la mayoría de los casos.
 */
function recalcularConLibreOffice(rutaArchivo) {
  return new Promise((resolve) => {
    const carpeta = path.dirname(rutaArchivo);
    execFile(
      'soffice',
      ['--headless', '--convert-to', 'xlsx', '--outdir', carpeta, rutaArchivo],
      { timeout: 30000 },
      (error) => {
        if (error) {
          console.warn(
            `Aviso: no se pudo recalcular con LibreOffice (¿está instalado?). ` +
            `El archivo se entrega igual, con la fórmula sin recalcular: ${error.message}`
          );
        }
        resolve();
      }
    );
  });
}

/**
 * @param {{nueva: number, por_vencer: number, vencida: number}} conteos
 * @param {string} dirSalida carpeta donde guardar el archivo generado
 * @returns {Promise<string>} ruta del archivo Excel generado
 */
async function generarReporteExcel(conteos, dirSalida) {
  if (!fs.existsSync(RUTA_PLANTILLA)) {
    throw new Error(`No se encontró la plantilla en: ${RUTA_PLANTILLA}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(RUTA_PLANTILLA);

  const hoja = workbook.worksheets[0];

  hoja.getCell(CELDAS.nueva).value = conteos.nueva;
  hoja.getCell(CELDAS.por_vencer).value = conteos.por_vencer;
  hoja.getCell(CELDAS.vencida).value = conteos.vencida;

  if (!fs.existsSync(dirSalida)) {
    fs.mkdirSync(dirSalida, { recursive: true });
  }

  const nombreArchivo = nombreArchivoConFecha('reporte_pqrs', 'xlsx');
  const rutaSalida = path.join(dirSalida, nombreArchivo);

  await workbook.xlsx.writeFile(rutaSalida);
  await recalcularConLibreOffice(rutaSalida);

  return rutaSalida;
}

module.exports = { generarReporteExcel };
