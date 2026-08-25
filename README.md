# SAO RPG Database — Node/Web

Aplicação multiusuário para campanhas de RPG estilo MMORPG/Sword Art Online, implementada em JavaScript com Node.js 22, Fastify, PostgreSQL/Prisma, React/Vite e Socket.IO.

## Compatibilidade

- `moduleId`: `br.sao.rpg.firecast.database`
- `dataType`: `br.sao.rpg.database`
- T20 atual: `Ambesek.T20`
- alias T20 legado: `Ambesek.Tormenta20`
- XML: `saoData`, `schemaVersion="1.0"`

A implementação fica em uma pasta própria e não depende de APIs internas do Firecast. O bridge externo é deliberadamente um contrato separado.

## Estrutura

```text
apps/api        Fastify + Prisma + Socket.IO + OpenAPI
apps/web        React + Vite + Router + TanStack Query
packages/domain regras de negócio e Zod
packages/xml    XML seguro, XSD, diff, merge e export
packages/shared constantes/contratos
schemas         XSD saoData v1
examples        pacote de demonstração
scripts         backup, restore e conversão JSON legado
docs            arquitetura, domínio e migração
```

## Requisitos

- Node.js 22+
- npm 10+
- PostgreSQL 16+ ou Docker

## Instalação local — Windows/Linux/macOS

1. Copie `.env.example` para `.env`.
2. Suba PostgreSQL e ajuste `DATABASE_URL`.
3. Instale dependências:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Frontend: `http://localhost:5173`  
API: `http://localhost:3001`  
OpenAPI: `http://localhost:3001/docs`

Usuários da seed:

- mestre: `gm` / `gm123`
- jogador: `player` / `player123`

As credenciais acima são apenas de desenvolvimento.

## Docker Compose

```bash
docker compose up --build -d
docker compose exec api npm run prisma:seed -w @sao/api
```

Acesse `http://localhost:5173`.

## Banco e migrations

Criar migration durante desenvolvimento:

```bash
npm run prisma:migrate:dev -w @sao/api -- --name descricao
```

Aplicar migrations versionadas:

```bash
npm run db:migrate
```

## Testes e qualidade

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Os testes E2E exigem aplicação e banco em execução com a seed aplicada.

## Segurança

A API usa sessão opaca armazenada no PostgreSQL, cookie HttpOnly/SameSite, `Secure` configurável, CSRF para mutações autenticadas, Argon2, rate limit em login/importação, CORS explícito, Helmet, validação Zod e isolamento obrigatório por `campaignId`.

Conteúdo secreto é removido no servidor antes da resposta. O frontend nunca recebe campos apenas para escondê-los visualmente. URLs remotas são armazenadas como dados e o backend não faz download automático de imagens.

## XML saoData v1

Importação:

1. upload multipart `.xml` com MIME XML e limite configurável;
2. rejeição de DTD/ENTITY;
3. well-formed;
4. XSD;
5. intermediário;
6. Zod e versão/packId;
7. IDs duplicados;
8. referências e warnings;
9. diff `NEW`, `ALTERED`, `EQUAL`, `REMOVED_FROM_XML`;
10. seleção do usuário;
11. transação única;
12. reconciliação de objetivos/runtime e preservação de grants.

`REMOVED_FROM_XML` fica desmarcado por padrão. Quando escolhido, a entidade é soft-deleted para não destruir progresso ou referências históricas.

Exportação inclui apenas conteúdo. Progresso, grupos, bindings, grants, auditoria e derivados não são serializados.

## JSON intermediário legado

Não interprete XML interno do NodeDatabase como `saoData`. Para um JSON intermediário já exportado do plugin:

```bash
node scripts/import-legacy-json.mjs legado.json convertido.xml
```

Formato esperado: objeto com containers opcionais `npcs`, `locations`, `items`, `monsters`, `quests`, cada um contendo entidades no modelo de domínio documentado.

## Backup e restore

Com `pg_dump`/`pg_restore` instalados:

```bash
export DATABASE_URL='postgresql://...'
./scripts/backup.sh backup.dump
./scripts/restore.sh backup.dump
```

No PowerShell, os mesmos executáveis podem ser chamados diretamente com a URL do banco definida em `$env:DATABASE_URL`.

## Firecast/T20

O projeto não inventa acesso Node.js às APIs internas do Firecast. `CharacterProvider` define o contrato para um bridge futuro; o provider local/manual e o mock são funcionais. Snapshots são informativos e a ficha externa permanece fonte de verdade.

## Observação sobre as fontes legadas

A implementação foi gerada a partir do texto de requisitos fornecido. Os arquivos Lua/LFM, testes legados e o XSD original citados nesse texto não estavam disponíveis na entrada desta execução. Veja `docs/legacy-analysis.md` e `docs/implementation-status.md` para o impacto dessa limitação.
