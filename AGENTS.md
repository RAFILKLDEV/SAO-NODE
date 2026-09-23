# SAO-NODE — instruções para agentes

## Objetivo

Trabalhe com o menor contexto possível. Antes de abrir arquivos grandes, localize o ponto exato da alteração e leia somente o trecho necessário.

## Mapa do repositório

- `apps/api/`: Fastify, Prisma, autenticação, rotas e serviços.
- `apps/web/`: React/Vite, páginas e utilitários de UI.
- `packages/domain/`: contrato de domínio, normalização, validação e regras saoData 2.0.
- `packages/json/`: parse, importação/exportação, diff e schema JSON.
- `packages/shared/`: constantes e contratos compartilhados.
- `schemas/`: schema JSON gerado/publicado.
- `scripts/`: migração, validação e utilitários.
- `docs/`: documentação de arquitetura e migração.

## Contrato de dados

- Formato canônico atual: `saoData` 2.0.
- IDs são estáveis e namespaced: `npc.`, `loc.`, `item.`, `monster.`, `quest.`.
- `location.parentId` representa hierarquia.
- `location.connections` representa deslocamento/conexões entre locais.
- Não use `parentId` como conexão e não duplique backlinks persistidos.
- Preserve IDs fornecidos e compatibilidade de migração v1/v2.
- Permissões/descobertas são aplicadas no servidor; o frontend não deve receber conteúdo secreto para apenas escondê-lo visualmente.

## Economia de contexto

- NÃO leia `data/backups/` inteiro. Esses arquivos são snapshots grandes e históricos.
- NÃO leia `node_modules/`, `dist/`, `coverage/`, `playwright-report/` ou `test-results/`.
- Evite abrir `package-lock.json` salvo quando a tarefa for dependência/lockfile.
- Não leia arquivos grandes por completo se `rg`, `npm run context:search -- ...` ou um intervalo de linhas resolver.
- Para arquivos grandes, use `npm run context:file -- caminho inicio fim`.
- Para procurar código, prefira `npm run context:search -- termo [diretorio]`.
- Para ver a estrutura, use `npm run context:tree -- [diretorio] [profundidade]`.
- Para JSONs saoData/backups, use `npm run data:entity`, `data:search` ou `data:refs` em vez de imprimir o JSON inteiro.
- Não reabra arquivos que já estão suficientemente presentes no contexto.
- Depois de editar, revise primeiro `git diff -- <arquivos alterados>`; não releia o repositório inteiro.

## Estratégia de alteração

1. Identifique o ponto de entrada do problema.
2. Siga apenas imports/chamadas diretamente relacionadas.
3. Faça o menor patch que resolva o problema.
4. Não refatore código fora do escopo sem necessidade concreta.
5. Preserve APIs, IDs, contratos e comportamento não relacionado.
6. Rode primeiro testes diretamente relacionados.
7. Rode testes mais amplos somente quando a alteração puder afetar múltiplos módulos.
8. Na resposta final, resuma causa, arquivos alterados e testes executados; não cole logs longos.

## Comandos úteis

```bash
npm run context:tree -- apps/api 3
npm run context:search -- createEntity apps/api
npm run context:file -- apps/api/src/services/content.js 180 300
npm run data:entity -- examples/floor01.v2.sample.json loc.algum-id
npm run data:search -- examples/floor01.v2.sample.json nome-ou-termo
npm run data:refs -- examples/floor01.v2.sample.json loc.algum-id
```

## Testes

- API: `npm run test -w @sao/api -- <arquivo-ou-filtro>` quando possível.
- Domínio/JSON: use Vitest no workspace/pasta relevante.
- Frontend: rode os testes relacionados ao helper/componente alterado antes de testes amplos.
- `npm test`, `npm run build` e E2E completos ficam para validação final quando justificável.
