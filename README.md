# Caso de estudio: buscador de empleo automatizado

Un sistema que revisa cada día cinco portales de empleo, juzga cada oferta contra un perfil concreto
y avisa por Telegram solo de las que vale la pena postular. Este repositorio contiene **el motor de
reglas (el «juez») con sus pruebas** y una demo; el resto del sistema vive en un repositorio privado.

> Lo construí con Claude Code (desarrollo asistido por IA). Yo definí el problema, las reglas y los
> criterios de calidad; audité los resultados a mano y convertí cada error en una prueba automática.

## El problema

Buscar trabajo de entrada en Guatemala significa revisar cientos de ofertas por semana para encontrar
unas pocas que encajen. La mayoría falla en algo que solo se ve leyendo el detalle: piden universidad o
inglés, trabajan sábados, son presenciales lejos de la ciudad, o son call centers que se anuncian como
«híbridos». Revisarlas a mano toma horas y se escapan las buenas.

## La solución

```mermaid
flowchart LR
  A[5 portales<br/>Computrabajo · Tecoloco · LinkedIn<br/>Get on Board · Workana] --> B[Extracción y<br/>almacenamiento<br/>SQLite]
  B --> C[Juez de reglas<br/>12 criterios]
  C -->|99% descartadas<br/>con la razón literal| D[Reporte]
  C -->|APTO / REVISAR| E[Ranking por<br/>probabilidad]
  E --> F[Aviso por Telegram<br/>sin repetir]
```

1. **Extracción** (privada): un adaptador por portal, con cursores, relectura periódica y aislamiento
   (si un portal cambia o falla, la corrida sigue con los demás).
2. **Juez** (este repositorio): clasifica cada oferta en 12 criterios (inglés, estudios, fin de semana,
   horario flexible, modalidad, área, perfil contable, nivel, experiencia, formación, vehículo, uso de
   computadora) y aplica reglas duras: descarta lo incompatible y manda a «Por revisar» lo que no se
   puede decidir. **Lo no declarado nunca descarta.**
3. **Ranking:** cada oferta «Por revisar» recibe una probabilidad de ser apta según sus dudas (por
   ejemplo, «salario no publicado: ~74 % de puestos parecidos pagan sobre el piso») y se ordena por
   puntaje × probabilidad.
4. **Aviso:** solo las nuevas sobre el umbral llegan a Telegram, sin duplicar la misma oferta publicada
   en dos portales.

## Resultados (medidos)

| Métrica | Valor |
|---|---|
| Ofertas registradas | 17,572 (sep–oct 2026, 5 portales) |
| Ofertas nuevas por semana | ~2,200 |
| Ofertas juzgadas | 15,060 |
| Descartadas por reglas, con la razón literal | 99.1 % |
| Corridas automáticas (dos al día, tarea programada) | 77 en 31 días |
| Pruebas automáticas (sistema completo) | 298 |

Motivos de descarte más frecuentes: presencial sin horario flexible (59 %), trabajo físico o de campo
(48 %), exige universidad (29 %), trabaja fines de semana (27 %).

## Decisiones clave

**1. Primero las reglas, después la IA.** La primera versión usaba un servicio de IA para clasificar
cada oferta. Una auditoría manual de los 9 primeros «aptos» mostró que **6 eran basura** (call centers
con etiqueta híbrida falsa, horarios rotativos escondidos en el texto). Corregí las reglas, guardé esos 9
casos como **prueba dorada** (`test/golden-aptos.test.mjs`) y desde entonces cada cambio tiene que
pasarla.

**2. El texto gana a la etiqueta.** Si el portal dice «Presencial y remoto» pero el texto dice «sede
zona 2 de Mixco, sábado medio día», gana el texto y el reporte señala la contradicción.

**3. Quitar la IA cuando dejó de estar disponible.** El servicio de IA dejó de responder y, sin aviso,
el sistema empezó a saltarse todas las ofertas (ranking en 0 durante días). Lo reemplacé por un
**clasificador local de reglas de texto** (`src/juez/local.mjs`) con la misma interfaz, así que el resto
del sistema no cambió. Lo validé contra **13,014 clasificaciones** que la IA había dejado guardadas:

| | Con servicio de IA | Juez local |
|---|---|---|
| Coincidencia de veredicto | (referencia) | 99.4 % |
| Re-juzgar 6,208 ofertas | ~3.5 horas | 22 segundos |
| Costo por corrida | pago por uso | 0 |

Las 30 ofertas en que el juez local descarta y la IA no, las revisé a mano: eran descartes correctos
(la IA llamaba «horario flexible» a «trabajar bajo metas»).

**4. Probabilidad en vez de una lista ignorada.** Una lista de «Por revisar» con 50 ofertas nadie la
lee. Cada duda tiene una probabilidad y una acción concreta («pregunta el salario antes de la
entrevista»), y el ranking mezcla aptas y dudosas por valor esperado.

## Lecciones

- Validar con casos reales antes de confiar en un modelo: el 67 % de los primeros «aptos» eran
  errores que ninguna métrica automática habría detectado.
- Un sistema que falla en silencio es peor que uno que se cae: ahora cada clasificación vacía queda en
  el log y se reintenta.
- Una interfaz estable permite cambiar la pieza de IA (o quitarla) sin tocar el resto.

## Probarlo

Requiere Node.js 24 o superior; sin dependencias.

```bash
npm test          # 94 pruebas del juez, incluida la prueba dorada
node demo.mjs     # juzga 3 ofertas de ejemplo y muestra veredicto, razones y probabilidad
```

El perfil y las reglas se configuran en `config.ejemplo.json` (piso salarial, experiencia máxima,
modalidad, vehículo, etc.).

## Qué no incluye y por qué

Los extractores de cada portal, la base de datos, los reportes y el bot de Telegram quedan en el
repositorio privado: publicar código que extrae datos de portales de empleo puede contravenir sus
términos de uso, y las ofertas reales contienen datos de empresas. Las ofertas de las pruebas están
anonimizadas.

## Autor

Héctor Adolfo Rodas Escobar · Ciudad de Guatemala · [LinkedIn](https://www.linkedin.com/in/hector-rodas-ai)

Licencia MIT.
