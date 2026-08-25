# Status de implementação

## Implementado

- Fase 1: estrutura, sessão, Argon2, campanhas, roles, CSRF/CORS/headers e isolamento.
- Fase 2: domínio das cinco entidades, CRUD, referências, busca, backlinks, árvore e drops.
- Fase 3: grants por alvo, grupos, gate de existência, auditoria e filtragem no servidor.
- Fase 4: grupos, bindings T20, associações NPC e progresso reconciliável por `objectiveId`.
- Fase 5: pipeline XML, diff seletivo, aplicação transacional, export e conversor JSON legado.
- Fase 6: aplicação React responsiva com os fluxos principais e sincronização por Socket.IO.
- Fase 7: Dockerfiles, Compose, seed, healthcheck e scripts operacionais; testes automatizados são executados como etapa final de validação local.

## Limitações de fonte

Os arquivos Lua/LFM, testes legados e o XSD original citados no texto não estavam anexados. O XSD nesta árvore é um contrato v1 compatível com a estrutura descrita e usa validação semântica Zod para os detalhes. Antes de uma migração de produção do plugin real, o XSD e os defaults devem ser comparados com os arquivos originais.
