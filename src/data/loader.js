// =====================================================================
// CARGADOR DEL CSV OFICIAL DE ESPACIOS (data/raw/espacios.csv)
// ---------------------------------------------------------------------
// Lee el CSV, normaliza los nombres, convierte el aforo a entero y
// separa los registros buenos de los malos. NUNCA lanza error por un
// registro inválido: lo anota en el reporte de calidad y sigue.
//
// Qué se considera inconsistente:
//   - fila sin nombre
//   - aforo vacío, no numérico, con decimales o menor o igual a 0
//   - nombre duplicado (se conserva la primera fila válida)
//   - fila con menos columnas que el encabezado
//
// Los registros con nombre pero aforo inválido se cargan como espacio
// en estado "inconsistente" (aparecen en gris y no se pueden reservar).
// Los vacíos y duplicados solo aparecen en el reporte.
// =====================================================================

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

// Nombres de columna aceptados para cada campo (ya en minúsculas y sin tildes).
const COLUMNAS = {
  nombre: ['nombre', 'espacio', 'sala', 'name'],
  aforo: ['aforo', 'capacidad', 'cupo', 'capacity'],
  tipo: ['tipo', 'type'],
};

// Tipo que se asigna si el CSV no trae columna "tipo".
const TIPO_POR_DEFECTO = 'sala';

// ---------- utilidades de texto ----------

// Quita espacios sobrantes: "  Sala   Azul " -> "Sala Azul".
function limpiarTexto(valor) {
  return String(valor ?? '').trim().replace(/\s+/g, ' ');
}

// Clave para comparar nombres: minúsculas y sin tildes. "Ápolo" == "apolo".
function claveComparacion(valor) {
  return limpiarTexto(valor).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ID estable y legible a partir del nombre: "Amarillas verdes" -> "amarillas-verdes".
export function crearId(nombre) {
  return claveComparacion(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Nombre presentable: sin espacios extra y con la primera letra en mayúscula.
// Si viene todo en mayúsculas ("COSMOS") se pasa a "Cosmos".
function normalizarNombre(valor) {
  let nombre = limpiarTexto(valor);
  if (nombre === nombre.toUpperCase()) nombre = nombre.toLowerCase();
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

// ---------- lectura del CSV ----------

// Separa una línea en campos respetando comillas: "a,\"b,c\",d" -> [a, b,c, d].
function separarCampos(linea, separador) {
  const campos = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const caracter = linea[i];
    if (caracter === '"' && enComillas && linea[i + 1] === '"') {
      actual += '"'; // comilla escapada ""
      i++;
    } else if (caracter === '"') {
      enComillas = !enComillas;
    } else if (caracter === separador && !enComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += caracter;
    }
  }
  campos.push(actual);
  return campos;
}

// Si el encabezado tiene más ";" que ",", el archivo usa punto y coma (Excel en español).
function detectarSeparador(encabezado) {
  const puntoYComa = encabezado.split(';').length;
  const comas = encabezado.split(',').length;
  return puntoYComa > comas ? ';' : ',';
}

// Devuelve en qué posición está cada campo: { nombre: 0, aforo: 1, tipo: -1 }.
function ubicarColumnas(camposEncabezado) {
  const claves = camposEncabezado.map(claveComparacion);
  const posiciones = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    posiciones[campo] = claves.findIndex((clave) => alias.includes(clave));
  }
  return posiciones;
}

// ---------- validación de cada registro ----------

// Convierte el aforo a entero. Devuelve { aforo } o { motivo } si no sirve.
function convertirAforo(valor) {
  const texto = limpiarTexto(valor);
  if (texto === '') return { motivo: 'Aforo vacío' };
  const numero = Number(texto);
  if (Number.isNaN(numero)) return { motivo: `Aforo no numérico ("${texto}")` };
  if (!Number.isInteger(numero)) return { motivo: `Aforo con decimales (${texto})` };
  if (numero <= 0) return { motivo: `Aforo debe ser mayor que 0 (${numero})` };
  return { aforo: numero };
}

// Revisa una fila y devuelve { fila, nombre, aforo, tipo, motivo }.
// Si motivo es null, el registro es válido.
function revisarFila(campos, fila, columnas, totalColumnas) {
  const nombreCrudo = campos[columnas.nombre];
  const nombre = nombreCrudo === undefined ? '' : normalizarNombre(nombreCrudo);
  const tipo = limpiarTexto(campos[columnas.tipo]).toLowerCase() || TIPO_POR_DEFECTO;
  const registro = { fila, nombre, tipo, aforo: null, motivo: null };

  if (campos.length < totalColumnas) {
    registro.motivo = `Faltan columnas (tiene ${campos.length} de ${totalColumnas})`;
  } else if (nombre === '') {
    registro.motivo = 'Nombre vacío';
  } else {
    const resultado = convertirAforo(campos[columnas.aforo]);
    registro.aforo = resultado.aforo ?? null;
    registro.motivo = resultado.motivo ?? null;
  }
  return registro;
}

// Convierte un registro revisado en el objeto espacio del contrato.
function aEspacio(registro, estado) {
  return {
    id: crearId(registro.nombre),
    nombre: registro.nombre,
    tipo: registro.tipo,
    aforo: registro.aforo,
    estado,
  };
}

// ---------- función principal ----------

// Reporte vacío con un único motivo general (archivo ausente, encabezado roto...).
function reporteConError(motivo) {
  return { espacios: [], calidad: { cargados: 0, validos: 0, inconsistentes: [{ fila: 0, motivo }] } };
}

/**
 * Lee el CSV de espacios y devuelve:
 *   { espacios: [{id, nombre, tipo, aforo, estado}],
 *     calidad:  {cargados, validos, inconsistentes: [{fila, motivo}]} }
 * "fila" es el número de línea del archivo (el encabezado es la fila 1).
 */
export function cargarEspacios(rutaCSV) {
  if (!existsSync(rutaCSV)) return reporteConError(`No se encontró el archivo ${basename(rutaCSV)}`);

  let texto;
  try {
    texto = readFileSync(rutaCSV, 'utf8').replace(/^﻿/, ''); // quita el BOM de Excel
  } catch (error) {
    return reporteConError(`No se pudo leer el archivo: ${error.message}`);
  }

  const lineas = texto.split(/\r?\n/);
  const separador = detectarSeparador(lineas[0] ?? '');
  const encabezado = separarCampos(lineas[0] ?? '', separador);
  const columnas = ubicarColumnas(encabezado);
  if (columnas.nombre === -1 || columnas.aforo === -1) {
    return reporteConError('El encabezado del CSV no tiene columnas de nombre y aforo');
  }

  // 1) Revisar cada fila con datos (las líneas en blanco se ignoran).
  const registros = [];
  lineas.slice(1).forEach((linea, i) => {
    if (linea.trim() === '') return;
    registros.push(revisarFila(separarCampos(linea, separador), i + 2, columnas, encabezado.length));
  });

  // 2) Clasificar: válidos sin duplicar, inconsistentes con nombre, y reporte.
  const espacios = [];
  const inconsistentes = [];
  const filaPorId = new Map(); // id -> fila donde apareció primero

  // Primero los válidos, para que un duplicado malo no "robe" el nombre a uno bueno.
  for (const registro of registros.filter((r) => !r.motivo)) {
    const id = crearId(registro.nombre);
    if (filaPorId.has(id)) {
      inconsistentes.push({ fila: registro.fila, motivo: `Nombre duplicado ("${registro.nombre}", ya está en la fila ${filaPorId.get(id)})` });
    } else {
      filaPorId.set(id, registro.fila);
      espacios.push(aEspacio(registro, 'disponible'));
    }
  }

  // Luego los inválidos: siempre al reporte; al mapa solo si tienen nombre nuevo.
  for (const registro of registros.filter((r) => r.motivo)) {
    inconsistentes.push({ fila: registro.fila, motivo: registro.motivo });
    const id = crearId(registro.nombre);
    if (id && !filaPorId.has(id)) {
      filaPorId.set(id, registro.fila);
      espacios.push(aEspacio(registro, 'inconsistente'));
    }
  }

  inconsistentes.sort((a, b) => a.fila - b.fila);
  const validos = espacios.filter((e) => e.estado === 'disponible').length;
  return { espacios, calidad: { cargados: registros.length, validos, inconsistentes } };
}
