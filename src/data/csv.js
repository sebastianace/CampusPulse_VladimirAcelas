// =====================================================================
// LECTOR DE CSV (funciones puras, sin librerías)
// ---------------------------------------------------------------------
// Pensado para archivos que salen de Excel en español, que tiene tres trampas:
//   1. El separador no es la coma sino el punto y coma (porque en español la coma es el decimal).
//   2. Con "CSV (delimitado por comas)" el archivo queda en Windows-1252, no en UTF-8: sin cuidado,
//      "Micrófono" se lee "Micr?fono". Con "CSV UTF-8" empieza con un BOM (caracteres invisibles).
//   3. Los textos con separador o saltos de línea van entre comillas, y una comilla se escribe doble ("").
// Aquí se resuelven las tres. No sabe nada de equipos: eso está en src/domain/inventario-importar.js.
// =====================================================================

const SEPARADORES = [';', ',', '\t'];

/**
 * Bytes -> texto. Intenta UTF-8 estricto; si el archivo no es UTF-8 válido, lo lee como Windows-1252
 * (lo que guarda Excel por defecto). Quita el BOM. Devuelve {texto, codificacion}.
 */
export function decodificarTexto(bytes) {
  const datos = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let codificacion = 'utf-8';
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(datos);
  } catch {
    codificacion = 'windows-1252';
    texto = new TextDecoder('windows-1252').decode(datos);
  }
  return { texto: texto.replace(/^﻿/, ''), codificacion };
}

/**
 * Cuál de ; , o tabulador separa las columnas: el que más aparece en la primera línea con contenido,
 * sin contar lo que está entre comillas. Si no hay ninguno, la coma.
 */
export function detectarSeparador(texto) {
  const cuentas = new Map(SEPARADORES.map((s) => [s, 0]));
  let entreComillas = false;
  for (const c of texto) {
    if (c === '"') entreComillas = !entreComillas;
    else if (!entreComillas && (c === '\n' || c === '\r')) {
      if ([...cuentas.values()].some((n) => n > 0)) break; // la línea de encabezado ya se terminó
    } else if (!entreComillas && cuentas.has(c)) cuentas.set(c, cuentas.get(c) + 1);
  }
  const [mejor, veces] = [...cuentas.entries()].sort((a, b) => b[1] - a[1])[0];
  return veces > 0 ? mejor : ',';
}

/**
 * Texto CSV -> {separador, registros: [{linea, celdas: [texto]}]}.
 * `linea` es la línea del archivo donde empieza el registro (la que se ve en un editor: sirve para
 * decir "error en la línea 12"). Las filas totalmente vacías se saltan: Excel suele dejar `;;;;` al final.
 * Lanza Error si una comilla queda abierta.
 */
export function parsearCSV(texto, separador = detectarSeparador(texto)) {
  const registros = [];
  let celdas = [];
  let celda = '';
  let entreComillas = false;
  let hayContenido = false; // ¿la celda actual vino entre comillas o tiene algo? (distingue "" de nada)
  let linea = 1;
  let lineaInicio = 1;
  let comillaAbiertaEn = 0;

  const cerrarCelda = () => { celdas.push(celda); celda = ''; hayContenido = false; };
  const cerrarRegistro = () => {
    cerrarCelda();
    if (celdas.some((c) => c.trim() !== '')) registros.push({ linea: lineaInicio, celdas });
    celdas = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else entreComillas = false;
      } else {
        if (c === '\n') linea++;
        celda += c;
      }
    } else if (c === '"' && !hayContenido) {
      entreComillas = true;
      hayContenido = true;
      comillaAbiertaEn = linea;
    } else if (c === separador) {
      cerrarCelda();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      cerrarRegistro();
      linea++;
      lineaInicio = linea;
    } else {
      celda += c;
      hayContenido = true;
    }
  }
  if (entreComillas) throw new Error(`Hay una comilla sin cerrar que empieza en la línea ${comillaAbiertaEn}.`);
  if (celda !== '' || celdas.length) cerrarRegistro();
  return { separador, registros };
}

/** Atajo: bytes -> {separador, codificacion, registros}. */
export function leerCSV(bytes) {
  const { texto, codificacion } = decodificarTexto(bytes);
  return { codificacion, ...parsearCSV(texto) };
}
