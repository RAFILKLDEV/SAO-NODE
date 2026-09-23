# apps/api

- Mantenha isolamento obrigatório por `campaignId`.
- Autorização, grants e filtragem de conteúdo secreto devem permanecer no servidor.
- Mutações concorrentes usam `version`/`If-Match`; não introduza sobrescrita silenciosa.
- Operações de importação/aplicação que alterem várias entidades devem preservar atomicidade transacional.
- Ao investigar uma rota, comece no arquivo em `src/routes/` e siga somente os serviços/lib chamados por ela.
- Para conteúdo de entidades, `src/services/content.js` é o ponto central; leia apenas as funções necessárias.
- Não use backups JSON como fonte de verdade do estado atual do banco.
- Prefira testes específicos em `apps/api/tests/` antes da suíte completa.
