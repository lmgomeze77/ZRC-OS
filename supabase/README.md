# Capa 3 — Memoria

Esquema de la base de datos (Supabase / PostgreSQL 15+).

> **Repositorio público.** Aquí va **sólo estructura**. El modelo de scoring
> (pesos y umbrales) y los expedientes son datos de la firma y se aplican
> directamente en Supabase, fuera de este repositorio.

## Ficheros

Se aplican en orden de número. Todos son idempotentes: volver a pasarlos no
duplica nada, así que ante la duda, se repasan.

| Fichero | En el repo | Qué contiene |
|---|---|---|
| `01_schema.sql` | sí | Tablas, RLS, políticas, vistas, índices. Sin datos. |
| `02_modelos.sql` | **no** | Dimensiones, pesos y bandas del modelo de scoring. |
| `03_seed.sql` | **no** | Expedientes reales. |
| `06_dataroom.sql` | sí | Documentos, economics, estrategia, inversores, mandatos. |
| `08_storage.sql` | sí | Cubo privado `expedientes` y políticas por ruta. |
| `09_doctrina.sql` | sí | Rúbricas ancladas, puertas GO/NO-GO, índice de riesgo. |
| `11_cola.sql` | sí | `v_pendientes`: qué es lo siguiente, derivado de los datos. |
| `12_reserva.sql` | sí | Reserva por expediente y reparto de accesos. |
| `13_checklist.sql` | sí | Puntos de verificación previa por expediente. |
| `14_checklist_documento.sql` | sí | Un punto apunta al documento que lo cierra. |
| `15_plazos.sql` | sí | El plazo pasa a ser columna; la cola lleva fecha límite. |
| `16_actividad.sql` | sí | Registro de quién cambió qué y cuándo. Solo de agregar. |
| `17_indice.sql` | sí | El índice de riesgo pasa a derivarse de las mesas del barrido. |
| `18_sectorial.sql` | sí | Atractivo inversor por sector, con rúbricas ancladas. |
| `21_mesas_reales.sql` | sí | Las nueve mesas del briefing y 49 días reconstruidos. |
| `22_metodos.sql` | sí | Dos construcciones, dos series: índice de mesas y lectura. |
| `24_codigo.sql` | sí | El patrón de código admite el `&` del tipo `M&A`. |
| `25_acentos.sql` | sí | Las tildes que faltaban en el texto que se pinta. |

### Ficheros «al día»

Uniones de los anteriores, en orden, para una base que se quedó atrás. No
añaden nada propio: son los mismos ficheros concatenados con una tabla de
comprobación al final, porque el editor de Supabase sólo muestra la última
consulta. Se aplica el más alto que haga falta y nada más.

| Fichero | Une |
|---|---|
| `19_al_dia.sql` | 15 + 16 + 18 |
| `20_al_dia_2.sql` | 14 + 17 |
| `23_al_dia_3.sql` | 21 + 22 |

`99_diagnostico.sql` es una sola consulta de lectura que dice, objeto por
objeto, qué falta por aplicar. Ante la duda, se pasa ese primero.

Los que no están en el repo contienen metodología propia o expedientes
reales, y este repositorio es público.

### Qué pasa si falta uno

Nada se cae. La página carga cada tramo por separado y, si sus tablas no
existen, enseña en su sitio qué fichero falta por aplicar en vez de quedarse
en blanco. Esa degradación está cubierta por pruebas: el simulador que usan
los tests acepta `?sindr=1`, `?sindoct=1`, `?sinout=1` y `?sinact=1` para
fingir cada ausencia. No son parámetros de la aplicación desplegada — ahí la
ausencia la decide lo que haya en la base.

### `18_sectorial.sql` quiere los expedientes ya cargados

Clasifica a mano los cuatro expedientes cuya vertical dice el tipo de
mandato y no el sector (`M&A sell-side`, `M&A minoritaria`). Esos `update`
no hacen nada si el expediente todavía no existe, así que si se aplica
antes de cargar el pipeline, basta con volver a pasarlo después. Es
idempotente.

### Una advertencia sobre `16_actividad.sql`

El registro empieza a existir cuando se aplica. Lo anterior no se puede
reconstruir, porque la base no guardaba quién había escrito qué: cualquier
cosa que apareciese ahí fechada antes sería inventada. Por eso el panel lo
dice en vez de enseñar una lista vacía.

## El reparto ver / editar

Vive en `app_members.rol` y en ningún otro sitio:

| Rol | Lee | Escribe | Gestiona miembros |
|---|---|---|---|
| `reader` | sí | no | no |
| `writer` | sí | sí | no |
| `admin` | sí | sí | sí |

Pasar a alguien de sólo lectura a edición es una fila:

```sql
update app_members set rol = 'writer' where user_id = '<uuid>';
```

Sin redespliegue, sin tocar código, sin claves nuevas. Quien no es miembro
no ve absolutamente nada: las consultas le devuelven cero filas, no un error.

La interfaz puede ocultar controles a un `reader`, pero eso es cortesía: quien
deniega es Postgres, y no se le engaña desde las DevTools del navegador.

## Alta del primer administrador

Las políticas exigen ser `admin` para insertar en `app_members` — así que el
primero no puede darse de alta a sí mismo. Hazlo una sola vez desde el **SQL
Editor de Supabase**, que corre como `service_role` y salta RLS:

```sql
insert into app_members (user_id, nombre, rol)
values ('<tu-uuid-de-auth.users>', 'Luis', 'admin');
```

A partir de ahí, los demás miembros se dan de alta desde la aplicación.

## Decisiones de diseño que conviene no deshacer

**El modelo de scoring está versionado.** El corpus arrastra dos modelos
incompatibles que usan los mismos nombres `D1…D8` con significados y pesos
distintos. Una puntuación guardada bajo uno y leída bajo el otro produce una
banda equivocada **sin ningún error visible**. Por eso cada puntuación apunta
a su modelo, y los pesos son datos en `scoring_dimensions`, no constantes en
el código. No vuelvas a meter pesos en el cliente.

**`invertida` es sólo presentación.** Las rúbricas ya están escritas en la
dirección correcta (10 siempre es mejor), así que el cálculo no invierte nada.
Invertir en SQL contaría la inversión dos veces.

**Un parcial no puntúa.** La vista sólo devuelve `dealscore` con las ocho
dimensiones presentes. Con siete, una suma parcial daría una cifra más baja
que parecería una valoración real.

**Las vistas usan `security_invoker = true`**, de modo que se evalúan con los
permisos de quien consulta. Sin eso, una vista filtra por encima de RLS.

## Verificación

El esquema se aplicó y se probó sobre PostgreSQL 16 con un rol equivalente al
`authenticated` de Supabase (no propietario, para que RLS se le aplique):

- 14 tablas, 3 vistas, 56 políticas; ninguna tabla sin RLS
- `reader`: lee; sus `UPDATE`/`DELETE` devuelven `UPDATE 0` / `DELETE 0`
- `writer`: `UPDATE 1`; no puede ascenderse a `admin`
- No miembro: cero filas
- Cálculo contrastado contra un caso conocido del cuadro de mando

## Decisión: proyecto Supabase compartido

ZRC OS convive con la plataforma ZRC en el mismo proyecto y en el esquema
`public`. Decisión consciente, tomada para avanzar.

**Riesgo asumido**: los nombres de tabla son territorio común. Si la otra
aplicación crea una tabla llamada `companies`, `contacts`, `mandates`,
`theses`, `decisions` u `outcomes`, chocará con las de aquí — o al revés.
Como `01_schema.sql` usa `create table if not exists`, un choque no da error:
la tabla existente se conserva, pero recibe RLS y las políticas de ZRC OS, y
la aplicación que la usaba deja de ver sus filas sin ningún mensaje.

El bloque de RLS lleva la lista de tablas escrita a mano, así que nunca toca
tablas ajenas a esa lista.

**Detección**: hay seis tablas en las que la carga de ZRC OS no inserta nada
(`companies`, `contacts`, `mandates`, `theses`, `decisions`, `outcomes`). Si
alguna tiene filas, ya existía. La consulta de comprobación compara filas
esperadas contra reales por tabla.

**Salida si ocurre**: quitar las cuatro políticas de esa tabla y devolver RLS
a su estado anterior. No hay que tocar los datos.

**Arreglo de fondo, pendiente**: mover ZRC OS a un esquema propio (`zrcos`),
dentro de este mismo proyecto. Elimina la clase entera de problema y conserva
una sola identidad para todo ZRC.

## Edición del data room desde la página

Un `writer` o `admin` puede dar de alta y editar documentos, economics,
estrategia e inversores sin pasar por SQL. Un `reader` no recibe ninguno de
esos formularios.

Eso es cortesía de la interfaz. Quien deniega sigue siendo Postgres: si una
escritura llegara igualmente, la política RLS la rechaza con el código `42501`
y la página lo traduce a un mensaje legible en vez de un fallo mudo.

Dos detalles que conviene no perder al tocar este código:

- **Toda escritura va acotada.** Los borrados y actualizaciones encadenan su
  `.eq()`; sin él, un `delete()` alcanzaría todas las filas visibles para ese
  usuario.
- **La casilla de divulgación del precio.** Marcarla es lo único que hace que
  el precio salga de la base. El formulario lo advierte junto a la casilla,
  porque es una decisión de proceso, no un campo más.
