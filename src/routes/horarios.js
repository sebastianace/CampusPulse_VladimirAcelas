// Rutas de los horarios de las clases (Software, Inglés y SER).
// GET    /api/horarios            -> [{id, tipo, espacioId, horaInicio, horaFin, dias, grupo, estudiantes?, nivel?, docente?, modulo?, observacion?}]
//                                    Cualquier sesión. dias: [1..7] (1 = lunes) o null si todavía no se confirmaron. Solo los bloques con
//                                    días confirmados bloquean reservas (409 SALA_CON_CLASE).
// GET    /api/horarios/hallazgos  -> [{tipo, titulo, mensaje}] los problemas de planeación (cruces, aforo, datos incompletos...).
//                                    Solo admin: es trabajo de Coordinación y menciona docentes y grupos.
// POST   /api/horarios            {tipo, espacioId, horaInicio, horaFin, dias, grupo, estudiantes?, nivel?, docente?, modulo?, observacion?}
//                                 -> 201 {bloque, reservasEnConflicto}. Solo admin. 422 HORARIO_INVALIDO si algo no sirve.
// PATCH  /api/horarios/:id        los campos que cambian (un texto vacío quita un dato opcional) -> 200 {bloque, reservasEnConflicto}.
//                                 Solo admin. 404 HORARIO_NO_ENCONTRADO.
// DELETE /api/horarios/:id        -> 200 + el bloque quitado. Solo admin. 404 HORARIO_NO_ENCONTRADO.
// POST   /api/horarios/importar   cuerpo = los bytes de un Excel (.xlsx) o un CSV; query: aplicar=true (si no, es un ENSAYO),
//                                 alias={"Sala Nueva":"blanca"}, dias=L-V (para las filas sin días). Solo admin.
//                                 -> 200 el informe (bloques, errores, hallazgos, salasSinReconocer, reservasEnConflicto...).
//                                 Los errores de formato impiden guardar (aplicado: false). 413 si pasa de 5 MB.
// reservasEnConflicto: reservas futuras que quedan encima de la clase. No se cancelan: se avisa para reubicarlas.
// Los horarios también se cargan por terminal: npm run importar-horarios (ver docs/horarios.md).
import express, { Router } from 'express';
import { actualizarDB, leerDB } from '../data/almacen.js';
import { importarHorariosDesdeArchivo } from '../data/importar-horarios.js';
import { DatosInvalidosError } from '../domain/errors.js';
import { TITULOS_HALLAZGO, analizarHorarios, parsearDias } from '../domain/horarios.js';
import { crearBloque, modificarBloque, quitarBloque } from '../domain/horarios-editar.js';
import { exigirRol } from './auth.js';

const router = Router();

const resumenReserva = ({ id, espacioId, responsable, inicio, fin }) => ({ id, espacioId, responsable, inicio, fin });
const resumirConflictos = (resultado) => ({ bloque: resultado.bloque, reservasEnConflicto: resultado.reservasEnConflicto.map(resumenReserva) });

router.get('/', async (req, res) => {
  res.json((await leerDB()).horarios);
});

// Se calcula al pedirlo con lo que hay guardado: nunca queda desactualizado respecto de los bloques.
// "sin-dias" no se manda: ya lo dice la propia pantalla (cuántos bloques no tienen días).
router.get('/hallazgos', exigirRol('admin'), async (req, res) => {
  const db = await leerDB();
  const orden = Object.keys(TITULOS_HALLAZGO);
  res.json(analizarHorarios(db.horarios, db.espacios)
    .filter((h) => h.tipo !== 'sin-dias')
    .sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo))
    .map(({ tipo, mensaje }) => ({ tipo, titulo: TITULOS_HALLAZGO[tipo], mensaje })));
});

// ---------- subir el Excel (solo admin) ----------

/** Lo que la pantalla necesita del informe: el informe completo incluye detalles de la terminal. */
function resumirInforme(i) {
  return {
    aplicado: i.aplicado,
    formato: i.formato,
    hoja: i.hoja ?? null,
    total: i.total,
    bloques: i.bloques,
    porTipo: i.porTipo,
    sinDias: i.sinDias,
    dias: i.dias,
    diasPorDefecto: i.diasPorDefecto,
    reemplaza: i.reemplaza,
    errores: i.errores,
    salasSinReconocer: i.salasSinReconocer,
    ignoradas: i.ignoradas,
    hallazgos: i.hallazgos
      .filter((h) => h.tipo !== 'sin-dias')
      .map(({ tipo, mensaje, lineas }) => ({ tipo, titulo: TITULOS_HALLAZGO[tipo], mensaje, lineas })),
    reservasEnConflicto: i.reservasEnConflicto.map(resumenReserva),
  };
}

function leerAlias(texto) {
  if (!texto) return {};
  let alias;
  try {
    alias = JSON.parse(texto);
  } catch {
    throw new DatosInvalidosError('El parámetro alias no es un JSON válido', 'ALIAS_INVALIDO');
  }
  if (!alias || typeof alias !== 'object' || Array.isArray(alias) || !Object.values(alias).every((v) => typeof v === 'string')) {
    throw new DatosInvalidosError('El parámetro alias debe ser un objeto {"nombre en el archivo": "id de la sala"}', 'ALIAS_INVALIDO');
  }
  return alias;
}

// El archivo llega como bytes (no JSON): express.raw lo deja en req.body como Buffer. Límite de 5 MB: un horario pesa unos KB.
router.post('/importar', exigirRol('admin'), express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new DatosInvalidosError('No llegó ningún archivo. Elige el Excel de los horarios.', 'ARCHIVO_VACIO');
  let diasPorDefecto = null;
  if (req.query.dias) {
    const { dias, error } = parsearDias(String(req.query.dias));
    if (error || !dias) throw new DatosInvalidosError(`Los días por defecto no sirven: ${error ?? 'escribe por ejemplo L-V'}`, 'DIAS_INVALIDOS');
    diasPorDefecto = dias;
  }
  const informe = await importarHorariosDesdeArchivo(req.body, {
    aplicar: req.query.aplicar === 'true',
    alias: leerAlias(req.query.alias),
    diasPorDefecto,
  });
  res.json(resumirInforme(informe));
});

// ---------- agregar, cambiar y quitar un bloque (solo admin) ----------

router.post('/', exigirRol('admin'), async (req, res) => {
  const resultado = await actualizarDB((db) => crearBloque(db, req.body ?? {}));
  res.status(201).json(resumirConflictos(resultado));
});

router.patch('/:id', exigirRol('admin'), async (req, res) => {
  const resultado = await actualizarDB((db) => modificarBloque(db, req.params.id, req.body ?? {}));
  res.json(resumirConflictos(resultado));
});

router.delete('/:id', exigirRol('admin'), async (req, res) => {
  res.json(await actualizarDB((db) => quitarBloque(db, req.params.id)));
});

export default router;
