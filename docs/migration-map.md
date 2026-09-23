# Mapa de migração Lua/LFM → JavaScript

Este mapa relaciona os módulos citados no requisito às responsabilidades equivalentes criadas no novo projeto. Como os arquivos Lua/LFM não foram anexados, a relação é por responsabilidade declarada, não por análise de implementação.

| Legado citado | Equivalente JavaScript | Responsabilidade |
|---|---|---|
| `sao_db.lua` | `apps/api/src/services/content.js`, Prisma `Entity*` | CRUD, IDs, referências e persistência de conteúdo |
| `sao_progress.lua` | `apps/api/src/routes/progress.js`, `packages/domain/src/index.js` | progresso por dono, ordered/free, conclusão derivada |
| `sao_characters.lua` | `apps/api/src/routes/characters.js`, `CharacterProvider` | bindings e snapshots T20 |
| `sao_discovery.lua` | `apps/api/src/routes/grants.js`, `evaluateGrant()` | gates, grants, grupos e auditoria |
| serialização legada | `packages/json/src/index.js`, `apps/api/src/routes/json.js` | validação, diff, merge e exportação JSON |
| `forms/main.lfm` | `apps/web/src/App.jsx`, `styles.css` | shell, menu lateral e identidade visual |
| demais `forms/*.lfm` | `apps/web/src/pages/*.jsx` | listas, detalhes, editor, progresso, grupos, JSON, auditoria |
| `__tests__/*.lua` | `packages/*/tests`, `apps/api/tests`, `apps/web/e2e` | regressões de domínio, API e E2E |
| contrato de dados | `packages/domain/src/v2.js` e `packages/json/src/index.js` | contrato JSON v2 estrito, com adaptador v1 |
| pacote de exemplo | `examples/floor01.sample.json` | seed e round-trip |
