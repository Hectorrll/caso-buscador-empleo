function queryDe(config) {
  return `${config.candidato.resumen} Preferencias (de mayor a menor peso): ${config.preferencias.join('; ')}`;
}

// Límite de texto por candidata en jev_rerank/jev_find: 2,000 chars. Mismo criterio que el
// clasificador: requerimientos completos (sin recortar) + cola de la descripción (los requisitos
// suelen ir AL FINAL; cortar los primeros 2,000 chars los perdía → ranking sesgado).
const TOPE_TEXTO = 2000;
const COLA_DESCRIPCION = 1200;

function excerptParaCandidata(c) {
  const reqs = (Array.isArray(c.requerimientos) ? c.requerimientos : []).map(String).join(' | ');
  const fuente = String(c.descripcion ?? c.texto ?? '');
  if (!reqs) return fuente.slice(-TOPE_TEXTO);
  const reqsFinal = reqs.slice(0, TOPE_TEXTO); // prioridad: que requerimientos entre completo
  const presupuesto = Math.max(0, TOPE_TEXTO - reqsFinal.length - 3);
  const cola = fuente.slice(-Math.min(COLA_DESCRIPCION, presupuesto));
  return cola ? `${reqsFinal} | ${cola}` : reqsFinal;
}

// Mismo límite server-side que jev_classify: máx. 20 candidatas por llamada a jev_rerank.
const LOTE_RERANK = 20;

export async function rankear(jev, candidatas, config, log = console) {
  const scores = new Map();
  const query = queryDe(config);
  for (let i = 0; i < candidatas.length; i += LOTE_RERANK) {
    const lote = candidatas.slice(i, i + LOTE_RERANK);
    const args = {
      query,
      candidates: lote.map((c) => ({ id: c.id, text: excerptParaCandidata(c) })),
      top_k: lote.length,
    };
    // El endpoint puede degradar sin lanzar ({status:'invalid_response', ranked:null}
    // o el error HTTP como texto): sin `ranked` el lote se reintenta UNA vez; si sigue
    // sin venir, queda sin scores (relevancia 0) y se marca _degradado para el reporte.
    let r = await jev.call('jev_rerank', args);
    if (!Array.isArray(r?.ranked)) r = await jev.call('jev_rerank', args);
    if (!Array.isArray(r?.ranked)) {
      scores._degradado = true;
      log.error(`jev_rerank sin 'ranked' (${lote.length} candidatas: ${lote.map((c) => c.id).join(', ')}) — lote degradado, relevancia 0`);
      continue;
    }
    for (const fila of r.ranked) scores.set(fila.id, Math.round(fila.relevance * 100));
  }
  return scores;
}

export async function sanityFind(jev, muestra, config) {
  const r = await jev.call('jev_find', {
    query: queryDe(config),
    candidates: muestra.slice(0, 64).map((c) => ({ id: c.id, text: excerptParaCandidata(c) })),
    top_k: 5,
  });
  return { exists: r.exists ?? 0 };
}

const PESO_MODALIDAD = { remoto: 20, hibrido: 15, presencial: 5 };
const PESO_IA = { alta: 15, media: 6, baja: 0 };
const PESO_AREA = { administrativa: 10, computacion: 10, otro: 3, ventas: 0, servicio_cliente: 0, call_center: 0 };
const TAGS_ENTRADA = ['Beca/Prácticas', 'Contrato de Aprendizaje'];

export function scoreCompuesto({ relevancia = 0, flags = {}, experiencia = {}, otrosTags = [], sinEvidencia = 0 }) {
  const rel = Math.round((relevancia ?? 0) * 0.45);
  const mod = PESO_MODALIDAD[flags.modalidad] ?? 0;
  const ia = PESO_IA[flags.palancaIA] ?? 0;
  const anios = experiencia?.anios ?? null;
  const ent = (otrosTags ?? []).some((t) => TAGS_ENTRADA.includes(t)) || anios === 0 ? 10
    : anios === 1 || (anios === null && flags.nivel === 'entrada') ? 5 : 0;
  const area = PESO_AREA[flags.area] ?? 3;
  const pen = 8 * (sinEvidencia ?? 0);
  // Fin de semana trabajado o rotativo no descarta: solo baja el score.
  const penFinde = flags.finDeSemana === 'no' || flags.finDeSemana === 'rotativo' ? 5 : 0;
  const partes = [`${rel} relevancia`, `${mod} ${flags.modalidad ?? 'modalidad'}`, `${ia} IA ${flags.palancaIA ?? '?'}`, `${ent} entrada`, `${area} área`];
  return {
    score: Math.max(0, Math.min(100, rel + mod + ia + ent + area - pen - penFinde)),
    desglose: partes.join(' + ') + (pen ? ` − ${pen} evidencia` : '') + (penFinde ? ' − 5 fin de semana' : ''),
  };
}

export function porqueDe(flags) {
  const p = [];
  if (flags.modalidad === 'remoto') p.push('100% remoto');
  else if (flags.modalidad === 'hibrido') p.push('híbrido');
  if (flags.palancaIA === 'alta' || flags.palancaIA === 'media') p.push(`palanca IA ${flags.palancaIA}`);
  if (flags.nivel === 'entrada') p.push('entrada');
  if (flags.finDeSemana === 'si') p.push('descansa fin de semana');
  if (flags.horarioFlexible === 'si') p.push('horario flexible');
  if (flags.area === 'administrativa' || flags.area === 'computacion') p.push('área administrativa/computación');
  return p.join(' · ') || 'cumple los requisitos duros';
}
