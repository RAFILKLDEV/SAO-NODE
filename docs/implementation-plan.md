# Plano de implementação

## Fase 1 — fundação

Monorepo, Prisma/PostgreSQL, sessão opaca com Argon2, campanhas, memberships, CSRF, CORS e isolamento por campanha.

## Fase 2 — domínio

Schemas Zod para NPC/Location/Item/Monster/Quest, CRUD, campos narrativos normalizados, referências, busca, backlinks, árvore e drops.

## Fase 3 — permissões

Gate de existência, grants por usuário/grupo, auditoria, filtragem server-side e eventos de invalidação.

## Fase 4 — runtime

Grupos, bindings, associações de NPC, progresso por jogador/grupo, ordered/free, edição segura e reconciliação de objetivos.

## Fase 5 — JSON

Documento versionado, validação Zod, avisos, diff seletivo, transação, soft-delete e exportação determinística.

## Fase 6 — interface

React responsivo, navegação, CRUD estrutural, pesquisa, hierarquia, abas de Monstro, progresso, Descobertas, JSON e auditoria.

## Fase 7 — operação e validação

Seed, Docker, migrations, healthcheck, backup/restore, unit/integration/E2E, lint e documentação.
