// =====================================================================
// UTILIDADES DE FECHA
// ---------------------------------------------------------------------
// El contrato usa fechas "YYYY-MM-DDTHH:mm" en hora local de Bogotá,
// sin zona horaria. Con ese formato, comparar dos fechas como texto
// ("2026-10-16T08:00" < "2026-10-16T10:00") da el orden correcto.
// =====================================================================

// Zona horaria del campus.
export const ZONA_HORARIA = 'America/Bogota';

// Formatos aceptados.
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Fecha y hora actual en Bogotá con formato "YYYY-MM-DDTHH:mm". */
export function ahoraBogota(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}T${valor('hour')}:${valor('minute')}`;
}

/** Fecha actual en Bogotá con formato "YYYY-MM-DD". */
export function hoyBogota() {
  return ahoraBogota().slice(0, 10);
}

// Comprueba que la fecha exista de verdad (rechaza 2026-02-30).
function esFechaReal(texto) {
  const [anio, mes, dia] = texto.slice(0, 10).split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/** true si el texto es "YYYY-MM-DD" y la fecha existe. */
export function esFechaValida(texto) {
  return typeof texto === 'string' && FORMATO_FECHA.test(texto) && esFechaReal(texto);
}

// ---------- cálculos sobre fechas "YYYY-MM-DDTHH:mm" ya validadas ----------

// Convierte "YYYY-MM-DDTHH:mm" en milisegundos (como si fuera UTC: solo sirve para restar fechas).
function aMilisegundos(texto) {
  const [anio, mes, dia] = texto.slice(0, 10).split('-').map(Number);
  const [hora, minuto] = texto.slice(11, 16).split(':').map(Number);
  return Date.UTC(anio, mes - 1, dia, hora, minuto);
}

/** Minutos transcurridos desde la medianoche: "2026-10-16T08:30" -> 510. */
export function minutosDelDia(texto) {
  const [hora, minuto] = texto.slice(11, 16).split(':').map(Number);
  return hora * 60 + minuto;
}

/** Día de la semana: 0 = domingo ... 6 = sábado. */
export function diaDeLaSemana(texto) {
  return new Date(aMilisegundos(texto)).getUTCDay();
}

/** Minutos entre dos fechas. */
export function minutosEntre(inicio, fin) {
  return (aMilisegundos(fin) - aMilisegundos(inicio)) / 60000;
}

/** true si dos rangos [inicioA, finA) y [inicioB, finB) se cruzan. Pegados (10-12 y 12-14) no se cruzan. */
export function seSolapan(inicioA, finA, inicioB, finB) {
  return inicioA < finB && inicioB < finA;
}

/** true si el texto es "YYYY-MM-DDTHH:mm", la fecha existe y la hora es 00:00-23:59. */
export function esFechaHoraValida(texto) {
  if (typeof texto !== 'string' || !FORMATO_FECHA_HORA.test(texto) || !esFechaReal(texto)) return false;
  const [hora, minuto] = texto.slice(11).split(':').map(Number);
  return hora <= 23 && minuto <= 59;
}
