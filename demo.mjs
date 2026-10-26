// demo.mjs
// Juzga las ofertas de demo/ofertas-ejemplo.json con el juez local: reglas sobre el
// texto, sin red ni IA. Uso: node demo.mjs
import { readFileSync } from 'node:fs';
import { cargarConfig } from './src/config.mjs';
import { crearJevLocal } from './src/juez/local.mjs';
import { clasificarCriterios, juzgarOferta } from './src/juez/criterios.mjs';
import { ajustarPorClaims, claimsDe, verificarClaims } from './src/juez/verify.mjs';
import { crearBaseSalarial, probabilidadApto } from './src/juez/probabilidad.mjs';

const config = cargarConfig();
const ofertas = JSON.parse(readFileSync(new URL('./demo/ofertas-ejemplo.json', import.meta.url), 'utf8'));
const jev = crearJevLocal(); // mismo contrato que el cliente Jev, pero local
const baseSalarial = crearBaseSalarial([], config.duros.salario_piso_Q); // sin historial: prior neutro

const tanda = ofertas.map(({ card, detalle }) => ({
  id: card.id,
  titulo: detalle.titulo ?? '',
  descripcion: detalle.descripcion ?? '',
  requerimientos: detalle.requerimientos ?? [],
  salarioTag: detalle.salarioTag,
  otrosTags: detalle.otrosTags ?? [],
}));
const flagsPor = await clasificarCriterios(jev, tanda);

const pct = (p) => `${Math.round(p * 100)}%`;
console.log(`Perfil de ejemplo: ${config.candidato.resumen}\n`);

for (const { card, detalle } of ofertas) {
  const flags = flagsPor.get(card.id);
  const r0 = await juzgarOferta(jev, { card, detalle, flags, config });
  const claims = r0.veredicto === 'DESCARTADO' ? []
    : await verificarClaims(
      jev,
      claimsDe(r0.flags, { salarioMensualQ: r0.salarioMensualQ, piso: config.duros.salario_piso_Q }),
      { descripcion: detalle.descripcion, requerimientos: detalle.requerimientos, salarioTag: detalle.salarioTag, otrosTags: detalle.otrosTags },
    );
  const r = ajustarPorClaims(r0, claims);
  const prob = probabilidadApto({ veredicto: r.veredicto, motivos: r.motivos, flags: r.flags, claims, baseSalarial, config });

  console.log(`── ${card.titulo} (${card.empresa}, ${detalle.ubicacion})`);
  console.log(`   Veredicto: ${r.veredicto}`);
  console.log(`   Probabilidad de que sea apto: ${prob ? pct(prob.p) : 'n/a (descartada)'}`);
  console.log('   Razones:');
  for (const razon of r.razon) console.log(`     - ${razon}`);
  if (prob?.dudas.length) {
    console.log('   Dudas:');
    for (const duda of prob.dudas) console.log(`     - ${duda.texto} → ${duda.accion}`);
  }
  console.log('');
}
