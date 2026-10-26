// src/juez/salario.mjs
const MESES = { mensual: 1, quincenal: 2, semanal: 52 / 12, diario: 30, anual: 1 / 12, por_hora: 8 * 30 };

// Unidades que marcan cifras que NO son dinero (años, horas, vacantes, teléfonos…).
const NO_DINERO = /^(a[ñn]os?|horas?|vacantes?|d[ií]as?|veces|personas?|puestos?|empleados?|tel[eé]fonos?)$/;

const RE_TOKEN = /\p{L}+|[0-9][0-9.,]*/gu;

// Keywords de periodicidad: una palabra, o frase de dos ("por hora", "al mes", "al año").
function keywordsDe(tokens) {
  const kws = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const w2 = tokens[i + 1];
    if (w === 'por' && w2 === 'hora') { kws.push({ desde: i, hasta: i + 1, periodo: 'por_hora' }); i++; }
    else if (w === 'al' && w2 === 'mes') { kws.push({ desde: i, hasta: i + 1, periodo: 'mensual' }); i++; }
    else if (w === 'al' && (w2 === 'año' || w2 === 'ano')) { kws.push({ desde: i, hasta: i + 1, periodo: 'anual' }); i++; }
    else if (/^mensual(?:es)?$/.test(w)) kws.push({ desde: i, hasta: i, periodo: 'mensual' });
    else if (/^quincenal(?:es)?$/.test(w)) kws.push({ desde: i, hasta: i, periodo: 'quincenal' });
    else if (/^semanal(?:es)?$/.test(w)) kws.push({ desde: i, hasta: i, periodo: 'semanal' });
    else if (/^diari[oa]s?$/.test(w)) kws.push({ desde: i, hasta: i, periodo: 'diario' });
    else if (/^anual(?:es)?$/.test(w)) kws.push({ desde: i, hasta: i, periodo: 'anual' });
  }
  return kws;
}

export function parseSalario(texto) {
  if (!texto) return null;
  const tokens = [...String(texto).toLowerCase().matchAll(RE_TOKEN)].map((m) => m[0]);
  const kws = keywordsDe(tokens);
  const montos = [];
  const periodos = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (!/^[0-9]/.test(w)) continue;
    const n = parseFloat(w.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0 || n >= 1_000_000) continue;
    if (NO_DINERO.test(tokens[i + 1] ?? '')) continue; // "8 horas", "2 años", "5 vacantes"… no son dinero
    // Solo capturan cifras (a) con "Q"/"quetzales" delante, o (b) adyacentes (≤2 palabras) a keyword de periodicidad.
    const adyacentes = kws.filter((k) => {
      const gap = k.desde > i ? k.desde - i - 1 : i - k.hasta - 1;
      return gap <= 2;
    });
    const conQ = /^(q|quetzal|quetzales)$/.test(tokens[i - 1] ?? '');
    if (!conQ && adyacentes.length === 0) continue; // el resto de cifras se IGNORA
    montos.push(n);
    periodos.push(...adyacentes);
  }
  if (montos.length === 0) return null; // "A convenir", "Según capacidades", etc.
  if (periodos.length === 0) return null; // sin periodicidad adyacente a la cifra → prohibido adivinar
  periodos.sort((a, b) => a.desde - b.desde);
  return { minQ: Math.min(...montos), maxQ: Math.max(...montos), periodo: periodos[0].periodo };
}

export function salarioMensual(p) {
  if (!p || !Object.hasOwn(MESES, p.periodo)) return null;
  return Math.round(p.minQ * MESES[p.periodo] * 100) / 100;
}
