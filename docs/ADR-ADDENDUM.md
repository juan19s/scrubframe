# Adenda de decisiones — Fase 0

Decisiones tomadas durante el spike, en el formato de la §2 del SPEC. Pensadas
para pegarse tal cual en `SPEC.md` cuando las revises.

---

## ADR-005 — WXT en vez de `@crxjs/vite-plugin`

**Contexto.** La Fase 0 dejaba abierta la evaluación entre los dos.

**Decisión.** WXT.

Lo que inclinó la balanza:

- Content scripts en `MAIN` world son un campo del entrypoint (`world: 'MAIN'`),
  no un truco de configuración. La §3 los necesita desde la Fase 1: `probe.ts`
  va en MAIN y `picker.ts` en ISOLATED, y son dos archivos distintos.
- `manifest` acepta una función que recibe `mode`. Eso permite el CSP duro solo
  en producción sin partir la configuración en dos (ver nota sobre §7.1 abajo).
- `wxt zip` produce el artefacto de la store; la §7.4 quería un release
  reproducible y esto lo da sin escribir empaquetado a mano.
- `crxjs` ha tenido periodos largos sin mantenimiento activo. Para un proyecto
  que apuesta a durar y a recibir PRs de terceros, es un riesgo evitable.

**Consecuencia.** Adoptamos la convención de directorios de WXT: los
entrypoints tienen que vivir en `src/entrypoints/`. La estructura de la §3 se
respeta en todo lo demás — `src/adapters/`, `src/output/`, `src/shared/` y la
lógica de background siguen donde el SPEC dice. Ver ADR-006.

---

## ADR-006 — Entrypoints separados de la lógica que ejecutan

**Contexto.** WXT obliga a que los entrypoints estén en `src/entrypoints/`. El
SPEC los ponía en `src/background/index.ts` y `src/content/picker.ts`.

**Decisión.** El entrypoint es una cáscara delgada; la lógica queda en el módulo
que le corresponde según la §3.

```
src/entrypoints/background.ts   → router de mensajes, nada más
src/background/cdp-session.ts   → wrapper sobre chrome.debugger
src/background/capture-engine.ts→ el loop de captura
src/background/spike.ts         → diagnóstico de ADR-002
```

**Consecuencia.** La lógica se puede importar desde Vitest sin arrastrar el
runtime de extensión. Los tests de `naming` y del lector de PNG ya corren así,
sin mocks de `chrome.*`. Cuando lleguen los adaptadores, cada uno se testea en
aislamiento como pedía el ADR-003.

---

## Nota sobre §7.1 — el CSP duro solo aplica a producción

El modo dev de WXT abre un WebSocket al servidor de HMR. Un
`connect-src 'self'` fijo lo rompe.

El manifest ahora emite el CSP estricto únicamente cuando `mode === 'production'`.
Lo que se publica lleva la restricción; lo que corre en tu máquina durante
desarrollo, no. Vale la pena decirlo explícitamente en `PRIVACY.md`, porque un
escéptico que cargue un build de dev y vea un WebSocket va a preguntar.

---

## Nota sobre §7.4 — el grep encontró algo real de inmediato

El job de auditoría falló en su primera corrida, y con razón. Dos hallazgos:

1. **`fetch(` dentro del bundle del popup.** No era código nuestro: es el
   polyfill de `modulepreload` que Vite inyecta por defecto. Chrome soporta
   `modulepreload` de forma nativa, así que el polyfill era peso muerto que
   además metía una primitiva de red en un bundle del que afirmamos que no
   tiene ninguna. Desactivado en `wxt.config.ts` con
   `build.modulePreload.polyfill: false`.

2. **Strings de URL remotas.** `react.dev` (React lo mete en sus mensajes de
   error), `www.w3.org` (el namespace de SVG), `tailwindcss.com` (el banner de
   licencia del CSS generado) y `github.com` (nuestro link "View source"). Son
   strings inertes, no peticiones.

El script quedó con dos niveles de severidad, porque la distinción importa:

- **Primitivas de red** — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`, `importScripts` — fallan sin excepción posible. Si una está en
  el bundle, la afirmación deja de ser verificable por inspección.
- **URLs remotas** — fallan salvo que estén en `scripts/network-allowlist.json`
  con una razón escrita. Un string no es una petición, pero obligarse a
  justificar cada uno por escrito es exactamente el tipo de fricción que
  queremos.

La versión ingenua ("grep `fetch(` y ya") habría fallado eternamente por culpa
de React y el equipo habría terminado desactivando el check. Este sobrevive.

---

## Riesgo nuevo detectado — descargas vía `data:` URL

La Fase 0 descarga con `chrome.downloads.download({ url: 'data:image/png;base64,...' })`.
Funciona, y evita tener que crear un documento offscreen solo para llamar a
`URL.createObjectURL` (que no existe en un service worker MV3).

No escala. Las `data:` URL tienen límite práctico de tamaño en Chrome, y a
partir de la Fase 2 vamos a escribir un contact sheet de varios MB y un ZIP.

**Mitigación:** cuando llegue la Fase 2, mover la escritura de archivos a un
documento offscreen (`chrome.offscreen`), que sí tiene `Blob` y
`URL.createObjectURL`. Ese documento ya hace falta de todos modos: `OffscreenCanvas`
para el contact sheet vive ahí. Agregar el permiso `offscreen` a la tabla de la
§7.3 en ese momento, no antes.

---

## ADR-007 — El spike original no podía responder la pregunta de ADR-002

**Contexto.** La primera versión del spike attacheaba a la pestaña donde
hiciste click en el ícono, corría un comando, y si funcionaba declaraba
*"ADR-002 holds: activeTab alone is enough"*.

Ese experimento no tiene control negativo. Un attach exitoso es compatible con
dos explicaciones distintas:

1. `activeTab` concedió el acceso — que es lo que ADR-002 asume.
2. El permiso `debugger` alcanza por sí solo, sin ningún acceso por pestaña.

Y son respuestas distintas a la misma pregunta. La segunda **invalida la premisa
de privacidad de ADR-002**, no solo el detalle técnico.

**Lo que dice el código de Chromium.** En
`chrome/browser/extensions/api/debugger/debugger_api.cc`, la función
`ExtensionMayAttachToURL` lleva este comentario:

> the `debugger` permission implies all URLs access (and indicates such to the
> user), so we don't check explicit page access

Los únicos filtros que quedan son targets de tipo extensión, `IsRestrictedUrl()`,
acceso a `file://` y la lista de bloqueo por política empresarial. Ni
`host_permissions` ni la concesión temporal de `activeTab` se consultan para
targets `http(s)`.

Y en la tabla de advertencias de instalación, `debugger` dispara por sí solo
**"Read and change all your data on all websites"**. `activeTab` no muestra
ninguna advertencia.

**Consecuencia, si el spike lo confirma:**

> Omitir `host_permissions` **no reduce el prompt de instalación** mientras
> declaremos `debugger`. La §7.2 del SPEC insinúa lo contrario y hay que
> corregirla.

Esto no significa que ADR-002 se tire. La decisión operativa — enviar sin
`host_permissions` fijos — sigue siendo correcta: es menos superficie declarada
y `activeTab` sí gobierna `chrome.scripting` para el picker de la Fase 1. Lo que
cambia es **la justificación**, y esa justificación es literalmente el argumento
de confianza de la §7.

La versión honesta, que además es mejor argumento: la contención no la impone
Chrome, la impone el código, y por eso el proyecto es open source, tiene la barra
amarilla como kill switch, y el attach dura lo que dura una captura. "Confía en
el permiso" es débil; "verifica el código y mira la barra" es verificable.

**Decisión.** El spike ahora corre con control negativo. Necesita **dos
pestañas**:

| Pestaña | Estado de activeTab | Qué mide |
|---|---|---|
| donde hiciste click | concedido | que el attach funciona en el caso feliz |
| una de fondo, nunca invocada | **no** concedido | si `activeTab` es realmente la puerta |

Veredictos posibles, ahora cinco:

- `adr-002-holds` — la invocada attachea, la de control es rechazada. `activeTab`
  es la puerta. Es el único caso que valida el ADR.
- `debugger-permission-suffices` — la de control también attachea. `activeTab` no
  gobierna nada aquí; hay que reescribir la §7.
- `adr-002-needs-revision` — ni la invocada attachea, por falta de host access.
- `dev-build` — el manifest cargado trae permisos inyectados (`tabs`,
  `host_permissions: http://localhost/*`). Se rehúsa a dar veredicto.
- `inconclusive` — incluido el caso de **no haber pestaña de control**. Un attach
  verde solo, sin control, ya no produce veredicto verde.

**Consecuencia.** El caso que antes salía verde con una sola pestaña ahora sale
`inconclusive` y te pide abrir una segunda. Es más fricción y es correcta: el
resultado anterior no significaba lo que decía.

---

## Otros arreglos de la misma revisión

Cuatro defectos confirmados con verificación adversarial, todos ya corregidos:

**Timeout en cada comando CDP** (`cdp-session.ts`). No había ninguno. Una página
con un `alert()` abierto bloquea el renderer, `Page.captureScreenshot` nunca
resuelve, el `finally` de `withSession` nunca corre y **la barra amarilla se
queda puesta para siempre** — exactamente la fuga que el comentario de
`withSession` presumía de evitar. Ahora cada `sendCommand` corre contra 15s.

**El popup ya no se queda colgado.** `send()` no rechaza nunca: cualquier fallo
—background caído al arrancar, canal cerrado, popup cerrado a media operación—
vuelve como valor. Antes la promesa rechazada escapaba de un `onClick` que nadie
esperaba, y el popup quedaba en "Attaching…" con los dos botones muertos y el
único rastro en una consola que nadie está mirando.

**`attachSucceeded` mentía.** El `try` envolvía todo `withSession`, así que un
attach exitoso cuyo comando fallaba después se reportaba como `attach: failed`.
Con la barra amarilla visible en pantalla. El campo que el experimento entero
existe para medir. Ahora attach y round-trip se rastrean por separado.

**"Saved" para archivos que no existen.** `chrome.downloads.download()` resuelve
cuando la descarga *se crea*, no cuando termina. Un `data:` URL por encima del
techo de Chrome se crea y luego se interrumpe, y el popup imprimía "Saved …
4021 KB" tan feliz. Ahora espera el estado terminal vía `downloads.onChanged` y
distingue `FILE_TOO_LARGE`, que es la señal temprana del riesgo ya anotado
arriba sobre mover esto a un offscreen document en la Fase 2.

**Y un bug en el propio auditor de red.** Escaneaba todo `.output/`, incluido
`chrome-mv3-dev`, que legítimamente trae el WebSocket de HMR. Habría fallado en
CI en cuanto alguien corriera `pnpm dev` antes de `pnpm build`. Ahora audita solo
los builds que se envían y lo dice en su salida.

---

## RESULTADO DEL SPIKE — 2026-08-30

Corrido en Chrome 151, build de producción, sin `host_permissions`.

| Pestaña | activeTab | url legible | attach | round trip |
|---|---|---|---|---|
| invocada — `https://www.wikipedia.org/` | concedido | sí | ok | ok |
| **control — nunca invocada** | **no concedido** | **no** | **ok** | **ok** |

`host perm: absent` en ambas.

**Veredicto: `debugger-permission-suffices`.** Confirmado empíricamente, no
inferido de la documentación.

El dato que lo cierra: en la pestaña de control **no teníamos permiso ni para
leer su URL** — la tarjeta muestra `(not readable)` porque sin `tabs` ni
`activeTab` Chrome nos oculta la dirección. Y aun así el attach funcionó y se
ejecutó JavaScript dentro de esa página.

> Permiso insuficiente para saber en qué página estás.
> Permiso suficiente para ejecutar código en ella.

Esa frase debería ir en el README. Explica el permiso `debugger` mejor que tres
párrafos.

---

## ADR-002 (reemplazo) — Permisos mínimos con `activeTab`, sin ilusiones sobre `debugger`

> Reemplaza al ADR-002 original en `SPEC.md` §2.

**Contexto.** `debugger` + `<all_urls>` es la combinación que más asusta en la
store. El ADR original pedía `activeTab` en lugar de `host_permissions` fijos,
asumiendo que eso acotaba el alcance de la extensión.

**Esa suposición era falsa,** y el spike de Fase 0 lo comprobó en Chrome 151. El
permiso `debugger` attachea a cualquier pestaña por sí solo. No consulta
`host_permissions` ni la concesión temporal de `activeTab`. En el código de
Chromium (`debugger_api.cc`, `ExtensionMayAttachToURL`) está escrito así:

> the `debugger` permission implies all URLs access (and indicates such to the
> user), so we don't check explicit page access

Y en el prompt de instalación, `debugger` dispara solo la advertencia **"Read and
change all your data on all websites"**. `activeTab` no muestra ninguna. Omitir
`host_permissions` **no reduce el prompt**.

**Decisión.** Se mantiene el manifest: `activeTab`, sin `host_permissions` fijos,
`<all_urls>` en `optional_host_permissions`. Pero por razones distintas y
verdaderas:

- `activeTab` **sí gobierna** `chrome.scripting`, que es como se inyecta el
  picker y el probe de la Fase 1. Ahí no es decorativo.
- Menos permisos declarados sigue siendo menos superficie, aunque no cambie el
  peor caso.
- No lo hacemos por el prompt. El prompt ya dice todos-los-sitios y va a seguir
  diciéndolo.

**Consecuencia — y esto es lo que hay que reescribir en la §7.** El argumento de
confianza no puede ser *"pedimos poco permiso"*. Es falso y un revisor técnico
lo detecta en un minuto, lo cual es peor que no decir nada.

El argumento verdadero, que además es más fuerte porque es verificable:

> Scrubframe **puede** hacer más de lo que hace. La contención no la impone Chrome,
> la impone el código, y el código está abierto para que lo leas. El attach dura
> lo que dura una captura. La barra amarilla de Chrome se queda puesta todo ese
> tiempo a propósito: es tu interruptor de emergencia y no lo esquivamos. Cero
> peticiones de red, verificable con un grep en el bundle y con la pestaña
> Network vacía del service worker.

"Confía en el permiso" es débil. "Verifica el código, mira la barra, corre el
grep" es comprobable. Cambiar de uno a otro mejora la §7, no la degrada.

**Sin cambios de código.** El manifest queda igual. Lo que cambia es la §7.2
(README), la §7.3 (`PERMISSIONS.md`) y la §7.6 (justificación para la store),
que hoy insinúan lo contrario.


---

## Corrección al riesgo de `data:` URL — el permiso `offscreen` no hace falta

Arriba quedó escrito que la Fase 2 necesitaría un documento offscreen, porque
`OffscreenCanvas` viviría ahí y de paso resolvería el techo de las `data:` URL.

**Las dos mitades eran falsas y se midieron.**

`OffscreenCanvas`, `getContext('2d')`, `createImageBitmap` y `convertToBlob` están
declarados `Exposed=(Window,Worker)`, y un `ServiceWorkerGlobalScope` cae dentro
del conjunto `Worker`. Blink incluso mantiene un reftest,
`OffscreenCanvas-text-rendering-in-worker.html`, que exige que el texto dibujado
en un worker sea idéntico píxel a píxel al de un canvas de documento.

Lo único que al worker le falta es `URL.createObjectURL` — y componer no lo
necesita.

Y el techo de `data:` se resolvió por otro lado: al panel lateral se le puede
entregar el `Blob` directamente al handle de File System Access
(`writable.write(blob)`), así que la conversión a base64 solo se paga en el
camino de respaldo a Descargas.

> **No se agrega el permiso `offscreen` a la §7.3.** Predecirlo estaba bien;
> darlo por hecho habría costado un permiso declarado que nada necesita, en un
> proyecto cuyo argumento entero de la §7 es *"puede hacer más de lo que hace, y
> puedes comprobar que no lo hace"*.

---

## Corrección a la §5.1 — el tope de 16 frames por hoja no se sostiene

El SPEC pone "máximo 16 frames por hoja **para que no se pierda detalle al
reescalar**". El razonamiento es correcto; el número está invertido.

**Lo que decide no es la resolución de origen, es la que se entrega.** Claude
parte las imágenes en parches de 28×28 y su nivel estándar tope en 1568px de
lado largo y 1568 parches (~1.22 MP). ChatGPT usa parches de 32×32 y tope
`detail: high` en 2048px. Todo lo que pase de ahí se tira antes de que el modelo
lo vea, y lo primero que se come el reescalado es justo lo que aquí importa:
bordes de 1px y texto chico.

Con 16 por hoja, cada celda aterriza en **279×194px — el 26% del original**. Una
letra de 16px de la página capturada queda en 4px. Un `translate` de 10px queda
en 2.6px, por debajo del piso de ruido del codificador.

Y el presupuesto de tokens es **por imagen, no por corrida**. Dos hojas de 6
entregan el doble de píxeles por frame que una hoja de 12, por el doble de
tokens — menos de un centavo. La restricción real es el tope de 20 imágenes por
mensaje de claude.ai, que queda lejísimos.

**Decisión.** El tope se deriva en vez de fijarse: se busca el mayor número de
frames por hoja cuya celda conserve **≥300px de lado corto**, con **200px como
piso duro** (Anthropic advierte que el modelo "puede alucinar" con imágenes bajo
200px). Para el frame real de 1061×736 eso da **6 por hoja**, no 16.

## Corrección a la §5.1 — las columnas siguen la forma del frame

El SPEC fija "máximo 4 columnas". Cuatro es una coincidencia, no una regla.

Una tira de una sola columna con 8 frames apaisados tiene proporción 1:11. Ahí
el tope de lado largo se alcanza mucho antes que el de área: la hoja usa **504 de
1568 tokens** y las celdas salen **4× más chicas**. Al revés, forzar 4 columnas
sobre un banner de 1200×400 da una hoja 5.4:1 con celdas de 377×126; dejar 2
columnas da 679×226 — **3.23× más área de celda** para la misma corrida.

La rejilla existe para que la hoja quede cuadrada-ish y los dos topes se
alcancen a la vez. Así que se prueban todas las cantidades de columnas y se
queda la mejor. Verificado contra el planificador: 1061×736 → 2 columnas;
1200×400 → 1; 400×800 → 4.

## Corrección a la §5.1 — el header deja de ser un bloque renderizado

El SPEC pide un header con URL, selector, adaptador, total de frames y fecha,
dibujado en la imagen.

Renderizar texto a pixeles para que un modelo lo saque de vuelta por OCR es una
decisión rara cuando el mismo dato puede ser una línea de markdown. Todo eso se
va a `ANIMATION.md`. En la hoja queda **una sola línea de leyenda**, con lo
mínimo para que la imagen se explique sola si viaja suelta: proyecto, elemento,
adaptador, número de hoja y el orden de lectura.

## Trampa nueva — la fuente que se calcula a 0px

`OffscreenCanvas` resuelve fuentes con `FontStyleResolver`, que arma sus datos de
conversión con viewport cero y 10px por defecto. Consecuencia medida: `4vw`,
`150%` y `larger` se calculan a **0px**. Sin excepción, sin nada en consola, y la
hoja sale con las etiquetas simplemente ausentes.

Peor: una cadena *inválida* se ignora y conserva la fuente anterior, pero una que
*parsea a cero* tiene éxito y la pisa.

**Mitigación, una línea:** asignar la fuente y luego exigir
`ctx.measureText(muestra).width > 0`.

Y siempre terminar la lista de familias en una genérica: una familia que no
resuelve nunca queda invisible, pero el último recurso de Blink es una **serif**,
así que `20px "SF Mono"` sale en algo parecido a Times.
