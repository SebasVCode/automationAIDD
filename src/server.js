/**
 * server.js
 *
 * Expone la extracción de PQRs como una API HTTP, para que n8n.cloud
 * (que no puede correr Playwright directamente) la llame por internet.
 *
 * Endpoint principal: POST /extraer-pqrs
 * Requiere el header:  x-api-key: <API_KEY definida en .env>
 *
 * Responde con el JSON de conteos (nueva, por_vencer, vencida) listo
 * para que n8n arme el Excel y lo envíe por WhatsApp.
 */

const express = require('express');
require('dotenv').config();

const { extraerPQRs } = require('./extractPQRs');
const { generarReporteExcel } = require('./generarReporte');

const { API_KEY, PORT } = process.env;

if (!API_KEY) {
  console.error(
    'Falta API_KEY en tu .env. Define una clave secreta larga, ej:\n' +
    'API_KEY=un-texto-largo-y-dificil-de-adivinar\n' +
    'Esa misma clave la vas a usar en el header x-api-key desde n8n.'
  );
  process.exit(1);
}

const app = express();
const puerto = PORT || 3000;

// Middleware simple de autenticación por clave secreta.
function requiereApiKey(req, res, next) {
  const claveRecibida = req.header('x-api-key');
  if (claveRecibida !== API_KEY) {
    return res.status(401).json({ error: 'No autorizado. Falta o es incorrecto el header x-api-key.' });
  }
  next();
}

// Endpoint de salud simple, para probar que el servidor está vivo
// sin necesidad de disparar todo el proceso de extracción (que
// tarda porque abre un navegador y hace login en AIDD).
app.get('/salud', (req, res) => {
  res.json({ ok: true, mensaje: 'Servidor de extracción de PQRs activo.' });
});

// Evita que llamadas simultáneas disparen dos extracciones a la vez
// (dos logins pisándose, dos navegadores abiertos, etc.).
let extraccionEnCurso = false;

app.post('/extraer-pqrs', requiereApiKey, async (req, res) => {
  if (extraccionEnCurso) {
    return res.status(409).json({ error: 'Ya hay una extracción en curso. Intenta de nuevo en unos segundos.' });
  }

  extraccionEnCurso = true;
  console.log(`[${new Date().toISOString()}] Extracción solicitada vía API...`);

  try {
    const resultado = await extraerPQRs();

    // Resumen simplificado con solo lo que el Excel final necesita
    // (nueva, por_vencer, vencida — sin "respondida" ni "desconocido").
    const resumenReporte = {
      nueva: resultado.conteos.nueva,
      por_vencer: resultado.conteos.por_vencer,
      vencida: resultado.conteos.vencida,
    };

    res.json({
      ok: true,
      fechaExtraccion: resultado.fechaExtraccion,
      resumenReporte,
      conteosCompletos: resultado.conteos,
      totalPQRs: resultado.totalFilas,
    });
  } catch (error) {
    console.error('Error durante la extracción vía API:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    extraccionEnCurso = false;
  }
});

// Endpoint que hace todo de una vez: extrae las PQRs de AIDD y devuelve
// directamente el archivo Excel (la plantilla real, ya llena) listo para
// que n8n lo adjunte y lo envíe por WhatsApp — sin pasos intermedios.
app.post('/generar-reporte-excel', requiereApiKey, async (req, res) => {
  if (extraccionEnCurso) {
    return res.status(409).json({ error: 'Ya hay una extracción en curso. Intenta de nuevo en unos segundos.' });
  }

  extraccionEnCurso = true;
  console.log(`[${new Date().toISOString()}] Generación de reporte Excel solicitada vía API...`);

  try {
    const resultado = await extraerPQRs();
    const conteos = {
      nueva: resultado.conteos.nueva,
      por_vencer: resultado.conteos.por_vencer,
      vencida: resultado.conteos.vencida,
    };

    const dirSalida = process.env.OUTPUT_DIR || './output';
    const rutaExcel = await generarReporteExcel(conteos, dirSalida);

    console.log(`Reporte Excel generado: ${rutaExcel}`);

    // Se devuelve el archivo directamente (binario), no un JSON, para
    // que n8n lo reciba como dato binario listo para adjuntar.
    res.download(rutaExcel, 'Seguimiento_PQRS.xlsx');
  } catch (error) {
    console.error('Error generando el reporte Excel:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    extraccionEnCurso = false;
  }
});

app.listen(puerto, () => {
  console.log(`Servidor de extracción de PQRs escuchando en el puerto ${puerto}`);
  console.log(`Prueba de salud: http://localhost:${puerto}/salud`);
  console.log(`Endpoint de extracción: POST http://localhost:${puerto}/extraer-pqrs (header x-api-key requerido)`);
  console.log(`Endpoint de reporte Excel: POST http://localhost:${puerto}/generar-reporte-excel (header x-api-key requerido)`);
});
