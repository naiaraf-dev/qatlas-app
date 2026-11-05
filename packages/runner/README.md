# Motor de pruebas y proxy de salida

- `src/red`: las reglas de salida, el proxy y el agente de Node. El proxy corre en su propio
  `utilityProcess`, sin claves ni base.
- `src/motor/crawler.ts` y `chequeos.ts`: el escaneo (ADR 022 y 024). `urls.ts`: normalización y trampas.
- `src/motor`: el navegador de pruebas y lo que hace con él. Corre en un `utilityProcess` por ejecución.
  No importa red, `child_process` ni `electron`: `security-tests/runner-aislamiento.test.ts` lo verifica.
- `src/protocolo.ts`: lo que estos procesos y el principal se mandan, con esquemas estrictos.

El escaneo autenticado llega en la semana 6b.

Decisiones: [ADR 016](../../docs/decisiones/016-proxy-de-salida.md),
[017](../../docs/decisiones/017-aislamiento-del-runner.md),
[018](../../docs/decisiones/018-perfil-del-navegador.md) y
[020](../../docs/decisiones/020-navegador-de-pruebas.md).
