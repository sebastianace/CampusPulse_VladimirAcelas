// =====================================================================
// BUSCAR UNA SALA POR NOMBRE (funciones puras)
// ---------------------------------------------------------------------
// Los archivos de Excel que llegan de Coordinación nombran las salas como se dice en voz alta: "Sala Azul",
// "Skylab", "AUDITÓRIO". Esto las encuentra entre los espacios de la base por id, por el nombre del campus
// ("Sputnik") o por el oficial ("Spooki"), sin importar tildes, mayúsculas ni la palabra "Sala".
// Lo usan el importador de inventario y el de horarios.
// =====================================================================

/** Minúsculas, sin tildes y con todo lo que no es letra o número reducido a un espacio. */
export function plano(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const sinPrefijo = (texto) => texto.replace(/^(sala|salon|aula) /, '');
// "Skylab" y "Skylabs" son la misma sala: la única diferencia que se perdona es la "s" final (singular o plural)
const sinPlural = (texto) => (texto.length > 3 ? texto.replace(/s$/, '') : texto);

// Distancia de Levenshtein: cuántas letras hay que cambiar, quitar o agregar para pasar de a a b
function distancia(a, b) {
  const previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = previa[0];
    previa[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = previa[j];
      previa[j] = Math.min(previa[j] + 1, previa[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return previa[b.length];
}

/**
 * Busca la sala `texto` entre los espacios. `alias` (opcional) es un objeto {"sala nueva": "blanca"}: nombre
 * (en cualquier forma) -> id de espacio, para los nombres que no están en la base y que alguien confirmó.
 * Devuelve {espacio} si la encontró, o {sugerencia} con la más parecida (o undefined). Nunca adivina.
 */
export function buscarSala(texto, espacios, alias = {}) {
  const buscado = sinPrefijo(plano(texto));
  const idAlias = Object.entries(alias).find(([nombre]) => sinPrefijo(plano(nombre)) === buscado)?.[1];
  if (idAlias) {
    const espacio = espacios.find((e) => e.id === idAlias);
    if (espacio) return { espacio };
  }
  const claves = (e) => [plano(e.id), plano(e.nombre), sinPrefijo(plano(e.nombre)), plano(e.nombreOficial)].filter(Boolean);
  const exacta = espacios.find((e) => claves(e).some((k) => k === buscado || sinPlural(k) === sinPlural(buscado)));
  if (exacta) return { espacio: exacta };
  const cercana = espacios
    .map((e) => ({ e, d: Math.min(...claves(e).map((k) => (k.includes(buscado) || buscado.includes(k) ? 1 : distancia(k, buscado)))) }))
    .filter(({ d }) => d <= 2).sort((a, b) => a.d - b.d)[0];
  return { sugerencia: cercana?.e };
}
