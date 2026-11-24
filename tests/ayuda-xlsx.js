// =====================================================================
// AYUDANTE DE LOS TESTS: ARMA UN .xlsx EN MEMORIA (no es un test)
// ---------------------------------------------------------------------
// Un .xlsx es un ZIP con XML. Aquí se escribe uno mínimo a mano para probar el lector (src/data/xlsx.js) sin un
// archivo real. Imita las dos formas en que se guardan los textos (en una tabla compartida, como Excel, o
// "en línea", como otras herramientas) y las horas como fracción del día con un estilo de hora.
//   crearXlsx([{ nombre: 'Horarios', filas: [['Tipo', 'Hora'], ['SER', { hora: '07:00' }]] }], { compartidos: true })
// Una celda puede ser texto, número, {hora: 'HH:MM'}, {formula: 'texto'} (guarda el último valor), o null (vacía).
// =====================================================================

import { crc32, deflateRawSync } from 'node:zlib';

const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letra = (i) => String.fromCharCode(65 + i);

function zip(archivos, { comprimir = true } = {}) {
  const locales = [];
  const centrales = [];
  let posicion = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const nombreBytes = Buffer.from(nombre);
    const datos = Buffer.from(contenido);
    const comprimido = comprimir ? deflateRawSync(datos) : datos;
    const metodo = comprimir ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc32(datos), 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBytes.length, 26);
    locales.push(local, nombreBytes, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(crc32(datos), 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBytes.length, 28);
    central.writeUInt32LE(posicion, 42);
    centrales.push(central, nombreBytes);
    posicion += local.length + nombreBytes.length + comprimido.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 8);
  fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(posicion, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

/** hojas: [{nombre, filas: [[celda]], oculta?}]. Opciones: {compartidos = false, comprimir = true}. */
export function crearXlsx(hojas, { compartidos = false, comprimir = true } = {}) {
  const textos = [];
  const indiceDe = (t) => { const i = textos.indexOf(t); return i >= 0 ? i : textos.push(t) - 1; };

  const celda = (valor, referencia) => {
    if (valor === null || valor === undefined || valor === '') return `<c r="${referencia}"/>`;
    if (typeof valor === 'number') return `<c r="${referencia}"><v>${valor}</v></c>`;
    if (valor.hora) {
      const [h, m] = valor.hora.split(':').map(Number);
      return `<c r="${referencia}" s="1"><v>${(h * 60 + m) / 1440}</v></c>`; // 07:00 -> 0,2916666666666667
    }
    if (valor.formula) return `<c r="${referencia}" t="str"><f>A1&amp;B1</f><v>${escapar(valor.formula)}</v></c>`;
    return compartidos
      ? `<c r="${referencia}" t="s"><v>${indiceDe(String(valor))}</v></c>`
      : `<c r="${referencia}" t="inlineStr"><is><t>${escapar(valor)}</t></is></c>`;
  };

  const hoja = ({ filas }) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    filas.map((fila, i) => `<row r="${i + 1}">${fila.map((v, j) => celda(v, `${letra(j)}${i + 1}`)).join('')}</row>`).join('')
  }</sheetData></worksheet>`;

  const archivos = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
      hojas.map((h, i) => `<sheet name="${escapar(h.nombre)}" sheetId="${i + 1}"${h.oculta ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
    }</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    }</Relationships>`,
    // Estilo 0: general. Estilo 1: formato personalizado de hora "HH:MM" (id 164).
    'xl/styles.xml': '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="HH:MM"/></numFmts><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
  };
  hojas.forEach((h, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = hoja(h); });
  if (compartidos) {
    archivos['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
      textos.map((t) => `<si><t xml:space="preserve">${escapar(t)}</t></si>`).join('')
    }</sst>`;
  }
  return zip(archivos, { comprimir });
}
