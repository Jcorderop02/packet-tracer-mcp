<!--
Gracias por el PR. Antes de pedir revisión:

1. Lee CONTRIBUTING.md si es tu primer PR.
2. Confirma que `bun test` pasa en local (348+ tests, no necesita PT corriendo).
3. Si tu cambio toca cómo se habla con PT, deja un smoke run o di explícitamente que no has podido probarlo contra PT real.
-->

## Qué cambia

<!-- Una o dos frases. El "qué" se ve en el diff; aquí va el resumen. -->

## Por qué

<!-- El motivo. Si arregla un issue, enlázalo: "Fixes #123". -->

## Cómo lo has probado

<!-- bun test / smoke run / manual contra PT 9.0.0.0810 / no probado -->

## Checklist

- [ ] `bun test` pasa
- [ ] Si añade una tool: registrada en `src/tools/index.ts`, README (ES + EN), `docs/ARCHITECTURE.md` y `docs/COVERAGE.md`
- [ ] Si rompe la firma de una tool existente: lo digo expresamente arriba
- [ ] `CHANGELOG.md` actualizado en la sección `[Unreleased]`
- [ ] Sin `console.log` ni código comentado de paso
