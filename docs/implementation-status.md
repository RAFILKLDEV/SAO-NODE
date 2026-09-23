# Status de implementação

## Implementado

- Consolidação saoData v2: contrato único, adaptação v1, hierarquia por `parentId`/`placement.floor`, links normalizados, IDs estáveis, migração verificável e formulários canônicos. Procedimentos e testes em [data-v2.md](data-v2.md).

- Fase 1: estrutura, sessão, Argon2, campanhas, roles, CSRF/CORS/headers e isolamento.
- Fase 2: domínio das cinco entidades, CRUD, referências, busca, backlinks, árvore e drops.
- Fase 3: grants por alvo, grupos, gate de existência, auditoria e filtragem no servidor.
- Fase 4: grupos, bindings T20, associações NPC e progresso reconciliável por `objectiveId`.
- Fase 5: pipeline JSON, diff seletivo, aplicação transacional, export e modelo copiável para IA.
- Fase 6: aplicação React responsiva com os fluxos principais e sincronização por Socket.IO.
- Fase 7: Dockerfiles, Compose, seed, healthcheck e scripts operacionais; testes automatizados são executados como etapa final de validação local.

## Limitações de fonte

Os arquivos Lua/LFM e testes legados citados no texto não estavam anexados. O contrato JSON v2 usa validação semântica Zod e adapta pacotes v1. Antes de uma migração de produção do plugin Firecast, os defaults devem ser comparados com os arquivos originais.
