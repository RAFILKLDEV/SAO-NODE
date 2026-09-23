# Validação e migração local — 09/09/2026

A instalação local foi atualizada para saoData v2. API e web foram reconstruídas e iniciadas via Docker Compose. O sistema está disponível em `http://localhost:5173`; API e PostgreSQL passaram nos healthchecks.

## Resultado dos dados

| Verificação | Resultado |
| --- | --- |
| Entidades migradas | 119 |
| Registros sem soft-delete | 111 |
| Registros com soft-delete preservado | 8 |
| Grants preservados | 1.050 |
| Registros de progresso preservados | 3 |
| Auditoria | Comparada integralmente com o backup, sem alterações |
| IDs, datas e versões existentes | Preservados |
| Checks de banco validados | 10 |
| Nova execução do normalizador | Nenhuma alteração pendente |
| Exportação v2 → parser → diff | Todas as entidades `EQUAL` |

O ensaio usou uma restauração do dump original em outro banco PostgreSQL. Depois da migração real, `verify-data-migration.mjs` comparou conteúdo e metadados com o backup e reexportou a campanha. A validação foi repetida após a abertura do sistema.

## Resolução de alias

`npc.noobtownmayor` possuía `subtitle: "Renan"` e `title: "Ladino"`. Conforme a precedência canônica prevista, `subtitle` foi mantido. Ambos os valores e o caminho foram preservados em `extensions.legacyConflicts`, usando a opção explícita `--preserve-alias-conflicts`. Nenhum dos valores foi eliminado do conteúdo migrado.

## Referências antigas sem destino

Foram preservadas oito referências não resolvidas, distribuídas entre três destinos:

| Destino ausente | Origens |
| --- | --- |
| `loc.andar-1.cidade-do-inicio.banco` | Cidade do Início e Praça Central |
| `loc.andar-1.cidade-do-inicio.distrito-das-hospedarias` | Cidade do Início e Praça Central |
| `loc.cidade_inicio` | `loc.andar-1.vale-de-rovia`, `loc.andar-1.vale-de-rovia.estrada-sul`, `loc.estrada_sul_rovia`, `loc.vale_rovia` |

Esses avisos já existiam no conteúdo anterior. Os destinos não foram substituídos por aproximação de nome nem criados artificialmente.

## Validação de software

- 103 testes Vitest passaram em 14 arquivos, com PostgreSQL real para integração e segurança.
- O E2E Playwright passou: importação v2, exportação v1/v2, descobertas de jogador, progresso, reimportação, seleção de campanha e edição React preservando recompensas.
- `npm run lint`, `npm run build` e `git diff --check` passaram.
- Os artefatos gerados foram conferidos com `data:artifacts -- --check`.
- O pacote demonstrativo v2 e a exportação da campanha local passaram pelo parser real do backend.
- No ambiente local atualizado, foram verificadas listagem v2 e abertura dos editores dos cinco tipos, sem erros JavaScript no navegador.

O build emite o aviso de bundle maior que 500 kB. No encerramento do E2E, o proxy WebSocket do Vite registrou desconexões; o teste concluiu com sucesso.

## Backups e relatórios

Os arquivos ficam em `data/backups/`, fora do Git:

- `sao-before-v2-20260909.dump`: dump completo anterior à mudança de schema, restaurado no ensaio.
- `local-content-before-v2-20260909.json`: entidades/filhos, grants, progresso e auditoria antes da conversão de conteúdo.
- `local-migration-v2-20260909.json`: relatório de aplicação e diagnósticos por entidade.
- `local-content-before-v2-20260909.json.cmtdmj4tw0002fk5o7xgh6w66.v2.json`: campanha reexportada e validada.

SHA-256 do dump completo: `339cdd1b312e2bf74610416ad2eee357d7796f045144db7ec30e2d6b98d5b8bb`.

O container de testes `sao-v2-validation` foi separado do banco da aplicação. Os bancos de teste/ensaio podem ser reutilizados após iniciar esse container. O procedimento geral está em [data-v2.md](data-v2.md).
