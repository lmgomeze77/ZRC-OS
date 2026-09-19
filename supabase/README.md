# Capa 3 — Memoria

Esquema de la base de datos (Supabase / PostgreSQL 15+).

> **Repositorio público.** Aquí va **sólo estructura**. El modelo de scoring
> (pesos y umbrales) y los expedientes son datos de la firma y se aplican
> directamente en Supabase, fuera de este repositorio.

## Ficheros

| Fichero | En el repo | Qué contiene |
|---|---|---|
| `01_schema.sql` | sí | Tablas, RLS, políticas, vistas, índices. Sin datos. |
| `02_modelos.sql` | **no** | Dimensiones, pesos y bandas del modelo de scoring. |
| `03_seed.sql` | **no** | Expedientes reales. |

Se aplican en ese orden.

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
