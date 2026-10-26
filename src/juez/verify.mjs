import { TAGS_MODALIDAD } from './criterios.mjs';

// Los veredictos de jev_verify mueven el veredicto del juez: un claim afirmado por el
// flag pero no confirmado en el texto baja APTO → REVISAR (o a DESCARTADO si es el
// horario flexible de un presencial). DESCARTADO nunca se reabre aquí.
const CLAIM_FINDE = 'El puesto descansa el fin de semana';
// El claim apunta a flexibilidad PARA el trabajador: "disponibilidad de horario"
// exigida al candidato (que se adapte a la empresa) NO es horario flexible.
const CLAIM_FLEXIBLE = 'El puesto permite al trabajador elegir o ajustar su propio horario (no que el trabajador deba adaptarse al horario que necesite la empresa)';
const CLAIM_UNIVERSIDAD = 'El puesto no exige estudios universitarios';
const CLAIMS_MODALIDAD = [['El puesto es 100% remoto', 'remoto'], ['El puesto es híbrido', 'híbrido']];

export function ajustarPorClaims(r, claims = []) {
  if (r.veredicto === 'DESCARTADO') return r;
  const veredictoDe = (texto) => claims.find((c) => c.claim === texto)?.veredicto;
  const motivos = [...(r.motivos ?? [])];
  const razon = [...(r.razon ?? [])];

  const flexible = veredictoDe(CLAIM_FLEXIBLE);
  if (r.flags?.modalidad === 'presencial' && flexible !== undefined && flexible !== 'verified') {
    motivos.push('flexible_no_confirmado');
    razon.push('Presencial: el horario flexible no se confirma en el texto');
    return { ...r, veredicto: 'DESCARTADO', motivos, razon };
  }

  let veredicto = r.veredicto;
  for (const [texto, etiqueta] of CLAIMS_MODALIDAD) {
    const v = veredictoDe(texto);
    if (v !== undefined && v !== 'verified') {
      veredicto = 'REVISAR';
      motivos.push('modalidad_no_confirmada');
      razon.push(`La etiqueta dice ${etiqueta} pero el texto no lo confirma (puede ser trabajo de campo o sede)`);
    }
  }
  if (veredictoDe(CLAIM_UNIVERSIDAD) === 'contradicted') {
    veredicto = 'REVISAR';
    motivos.push('universidad_contradicha');
    razon.push('El texto sugiere que exige estudios universitarios (revisa la letra chica)');
  }
  if (veredictoDe(CLAIM_FINDE) === 'contradicted') {
    veredicto = 'REVISAR';
    motivos.push('finde_contradicho');
    razon.push('El texto sugiere trabajo en fin de semana (revisa horario)');
  }
  return { ...r, veredicto, motivos, razon };
}

export function claimsDe(flags, { salarioMensualQ, piso }) {
  const claims = [];
  if (flags.finDeSemana === 'si') claims.push(CLAIM_FINDE);
  if (flags.horarioFlexible === 'si') claims.push(CLAIM_FLEXIBLE);
  if (flags.modalidad === 'remoto') claims.push('El puesto es 100% remoto');
  else if (flags.modalidad === 'hibrido') claims.push('El puesto es híbrido');
  if (flags.ingles === 'no_pide') claims.push('El puesto no requiere inglés');
  // 'ambiguo' NO sostiene la afirmación: solo se afirma con un flag que lo excluya de forma firme.
  if (flags.estudios !== 'universitario_o_mas' && flags.estudios !== 'ambiguo') claims.push('El puesto no exige estudios universitarios');
  if (salarioMensualQ != null && salarioMensualQ >= piso) {
    claims.push(`El salario mensual es de al menos Q${piso}`);
  }
  return claims;
}

// Nunca truncar la descripción hacia el juez: se parte en trozos de 45,000 chars y cada trozo
// entra como ITEM de evidencia separado ({id: 'descripcion-1', ...}, {id: 'descripcion-2', ...}).
const TROZO_EVIDENCIA = 45000;

function trozar(texto, tam) {
  const trozos = [];
  for (let i = 0; i < texto.length; i += tam) trozos.push(texto.slice(i, i + tam));
  return trozos;
}

// Las etiquetas que declaran modalidad (TAGS_MODALIDAD) jamás entran como evidencia:
// son el claim mismo. Si pasaran, "El puesto es híbrido" se confirmaría citando la
// propia etiqueta del sitio aunque el texto diga otra cosa. El resto de etiquetas sí
// quedan (ninguna sustenta un claim; una 'Presencial' suelta hasta puede contradecir
// un flag remoto venido del texto).
const ETIQUETAS_MODALIDAD = new Set(Object.values(TAGS_MODALIDAD));

export async function verificarClaims(jev, claims, { descripcion = '', requerimientos = [], salarioTag = null, otrosTags = [] } = {}) {
  if (!claims || claims.length === 0) return [];
  const etiquetas = (Array.isArray(otrosTags) ? otrosTags : []).filter((t) => !ETIQUETAS_MODALIDAD.has(t));
  const r = await jev.call('jev_verify', {
    claims,
    evidence: [
      ...trozar(String(descripcion), TROZO_EVIDENCIA).map((text, i) => ({ id: `descripcion-${i + 1}`, text })),
      { id: 'requerimientos', text: requerimientos.join(' | ') },
      { id: 'ficha', text: `Salario publicado: ${salarioTag ?? 'no publicado'}\nEtiquetas: ${etiquetas.join(', ') || 'ninguna'}` },
    ],
  });
  return (r.results ?? []).map((x) => ({
    claim: x.claim,
    veredicto: x.verdict,
    ok: x.verdict === 'verified',
    probabilidad: x.probabilities ?? {},
  }));
}
