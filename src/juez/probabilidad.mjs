// src/juez/probabilidad.mjs
// Convierte cada REVISAR en la probabilidad de que en realidad sea APTO:
// una "duda" por motivo, con su p y una acción concreta; p total = producto.
import { parseSalario, salarioMensual } from './salario.mjs';

const CLAIM_REMOTO = 'El puesto es 100% remoto';
const CLAIM_HIBRIDO = 'El puesto es híbrido';
const CLAIM_UNIVERSIDAD = 'El puesto no exige estudios universitarios';
const CLAIM_FINDE = 'El puesto descansa el fin de semana';

const pct = (p) => Math.round(p * 100);

// Tasa base empírica de "salario ≥ piso" por área/nivel, suavizada
// jerárquicamente: global → área → celda (pseudoconteo `a`). Celdas o áreas
// desconocidas caen a la tasa del nivel superior.
export function crearBaseSalarial(muestras, piso, a = 20) {
  const areas = new Map();
  const celdas = new Map();
  let okTotal = 0;
  let nTotal = 0;
  for (const m of muestras ?? []) {
    const mensual = salarioMensual(parseSalario(m?.salarioTag));
    if (mensual == null) continue;
    const ok = mensual >= piso;
    nTotal++;
    if (ok) okTotal++;
    const area = m.area ?? 'otro';
    const clave = `${area}|${m.nivel ?? 'intermedio'}`;
    const ar = areas.get(area) ?? { ok: 0, n: 0 };
    ar.n++;
    if (ok) ar.ok++;
    areas.set(area, ar);
    const ce = celdas.get(clave) ?? { ok: 0, n: 0 };
    ce.n++;
    if (ok) ce.ok++;
    celdas.set(clave, ce);
  }
  const g = nTotal ? okTotal / nTotal : 0.5;
  return (area, nivel) => {
    const ar = areas.get(area);
    const pa = ar ? (ar.ok + a * g) / (ar.n + a) : g;
    const ce = celdas.get(`${area}|${nivel}`);
    if (!ce) return { p: pa, n: 0 };
    return { p: (ce.ok + a * pa) / (ce.n + a), n: ce.n };
  };
}

export function probabilidadApto({ veredicto, motivos = [], flags = {}, claims = [], baseSalarial, config }) {
  if (veredicto === 'APTO') return { p: 1, dudas: [] };
  if (veredicto === 'DESCARTADO') return null;
  const claimDe = (texto) => claims.find((c) => c.claim === texto);
  const dudas = [];
  let modalidadHecha = false;
  for (const motivo of motivos) {
    let duda = null;
    if (motivo === 'salario_no_publicado') {
      const { p, n } = baseSalarial(flags.area, flags.nivel);
      duda = {
        motivo, p, accion: 'Pregunta el salario antes de la entrevista',
        texto: `Salario no publicado: ~${pct(p)}% de puestos parecidos (${flags.area}/${flags.nivel}, n=${n}) pagan ≥ Q${config.duros.salario_piso_Q}`,
      };
    } else if (motivo === 'experiencia_2') {
      const pr = flags.probabilidades?.experienciaExigencia;
      const p = pr ? Math.max(0.1, (pr.flexible ?? 0) + 0.5 * (pr.no_dice ?? 0)) : 0.5;
      duda = {
        motivo, p, accion: 'Postula igual y destaca que automatizas con IA',
        texto: `Pide 2 años (tú <1): ${pct(p)}% de que sea flexible`,
      };
    } else if (motivo === 'experiencia_estricta') {
      duda = {
        motivo, p: 0.4, accion: 'Postula solo si tu experiencia se acerca a lo pedido',
        texto: 'Experiencia obligatoria (tú <1 año)',
      };
    } else if (motivo === 'formacion_especifica') {
      const p = Math.max(0.1, 1 - (flags.probabilidades?.formacionEspecifica?.otra_especialidad ?? 0.8));
      duda = {
        motivo, p, accion: 'Verifica si dominas la carrera/software que piden',
        texto: `Pide formación de otra especialidad: ${pct(p)}% de que la puedas cubrir`,
      };
    } else if (motivo === 'vehiculo_carro') {
      duda = {
        motivo, p: 0.5, accion: 'Solo si vale la pena: sacarías licencia (el carro es de tu mamá)',
        texto: 'Pide licencia/carro',
      };
    } else if (motivo === 'finde_contradicho') {
      const c = claimDe(CLAIM_FINDE);
      const p = 1 - (c?.probabilidad?.contradicts ?? 0.5);
      duda = {
        motivo, p, accion: 'Confirma que no se trabaja sábado',
        texto: `El texto sugiere fin de semana: ${pct(p)}% de que sí descanse`,
      };
    } else if ((motivo === 'modalidad_solo_texto' || motivo === 'modalidad_no_confirmada') && !modalidadHecha) {
      // Un solo factor aunque aparezcan los dos motivos de modalidad.
      modalidadHecha = true;
      const c = claimDe(CLAIM_REMOTO) ?? claimDe(CLAIM_HIBRIDO);
      const p = c?.probabilidad?.supports ?? 0.5;
      duda = {
        motivo, p, accion: 'Confirma la modalidad al postular',
        texto: `Modalidad ${flags.modalidad} sin confirmar: ${pct(p)}% de que lo sea`,
      };
    } else if (motivo === 'hibrido_fuera_ciudad') {
      const p = config.revisar.p_hibrido_fuera_metro;
      duda = {
        motivo, p, accion: 'Confirma cuántos días hay que ir a la oficina',
        texto: 'Híbrido fuera del área metropolitana',
      };
    } else if (motivo === 'horario_personal') {
      duda = {
        motivo, p: 0.6, accion: 'Pregunta si el horario flexible respeta tus días',
        texto: `Horario flexible sin detalle: confirma ${config.duros.horario_personal}`,
      };
    } else if (motivo === 'universidad_contradicha') {
      const c = claimDe(CLAIM_UNIVERSIDAD);
      const p = 1 - (c?.probabilidad?.contradicts ?? 0.5);
      duda = {
        motivo, p, accion: 'Lee la letra chica de estudios',
        texto: `El texto sugiere universidad: ${pct(p)}% de que no la exija`,
      };
    } else if (motivo === 'ingles_ambiguo') {
      const p = 1 - (flags.probabilidades?.ingles?.requerido ?? 0.5);
      duda = {
        motivo, p, accion: 'Pregunta si el inglés es obligatorio',
        texto: `Inglés ambiguo: ${pct(p)}% de que no lo exija`,
      };
    } else if (motivo === 'estudios_ambiguos') {
      const p = 1 - (flags.probabilidades?.estudios?.universitario_o_mas ?? 0.5);
      duda = {
        motivo, p, accion: 'Revisa el nivel de estudios exigido',
        texto: `Estudios no declarados: ${pct(p)}% de que no pida universidad`,
      };
    } else if (motivo !== 'modalidad_solo_texto' && motivo !== 'modalidad_no_confirmada') {
      duda = { motivo, p: 0.5, texto: motivo, accion: 'Revísalo manualmente' };
    }
    if (duda) dudas.push(duda);
  }
  const p = Math.round(dudas.reduce((acc, d) => acc * d.p, 1) * 100) / 100;
  return { p, dudas };
}
