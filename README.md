# SAO RPG Database — Node/Web

Aplicação multiusuário para campanhas de RPG estilo MMORPG/Sword Art Online, implementada em JavaScript com Node.js 22, Fastify, PostgreSQL/Prisma, React/Vite e Socket.IO.

## Compatibilidade

- `moduleId`: `br.sao.rpg.firecast.database`
- `dataType`: `br.sao.rpg.database`
- T20 atual: `Ambesek.T20`
- alias T20 legado: `Ambesek.Tormenta20`
- JSON: `saoData`, `schemaVersion: "2.0"` (o parser migra pacotes v1)
- Estrutura canônica: `containers`, entidades tipadas, `visibility`, `media`, `links`, `statBlocks` e componentes estáveis
- Guia e migração: [docs/data-v2.md](docs/data-v2.md) e `node scripts/migrate-data-v2.mjs`

A implementação fica em uma pasta própria e não depende de APIs internas do Firecast. O bridge externo é deliberadamente um contrato separado.

## Estrutura

```text
apps/api        Fastify + Prisma + Socket.IO + OpenAPI
apps/web        React + Vite + Router + TanStack Query
packages/domain regras de negócio e Zod
packages/json   JSON versionado, validação, diff, merge e export
packages/shared constantes/contratos
examples        pacote de demonstração
scripts         backup e restore
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

Imagens de NPCs, locais, itens, monstros e missões podem ser enviadas pelo editor. São aceitos
PNG, JPEG, GIF, WebP, AVIF e BMP de até 50 MB. GIFs são armazenados sem recompressão e recebem a
configuração de repetição infinita para permanecerem animados em loop.

Mestres podem usar o seletor **Visualizar como** nas páginas de conteúdo para conferir a visão
efetiva de cada jogador, incluindo permissões individuais, grupos e bloqueios.

### Acesso por IPv6

Os servidores web e API escutam em IPv6. Com um endereço IPv6 global válido na máquina,
acesse usando colchetes ao redor do endereço:

```text
http://[SEU_IPV6]:5173
```

No Docker Compose, somente a porta web `5173` é publicada para acesso remoto; PostgreSQL e a
API direta ficam limitados ao host. Libere a porta TCP 5173 no firewall e, para acesso pela
internet, confirme que o roteador e o provedor permitem conexões IPv6 de entrada. Endereços
locais (`fe80::/10`) precisam do identificador de interface e só funcionam na rede local;
endereços Teredo não são recomendados para hospedar o serviço.

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

## JSON saoData v2

O contrato canônico, exemplos, compatibilidade v1 e procedimento de migração estão em [docs/data-v2.md](docs/data-v2.md).

Importação:

1. colagem direta ou carregamento de `.json`;
2. limite configurável e validação de sintaxe;
3. Zod, versão e `packId`;
4. rejeição de IDs duplicados;
5. referências e avisos;
6. diff `NEW`, `ALTERED`, `EQUAL`, `REMOVED_FROM_JSON`;
7. seleção do usuário;
8. transação única;
9. reconciliação de objetivos/runtime e preservação de grants.

`REMOVED_FROM_JSON` fica desmarcado por padrão. Quando escolhido, a entidade é soft-deleted para não destruir progresso ou referências históricas.

Exportação inclui apenas conteúdo. Progresso, grupos, bindings, grants, auditoria e derivados não são serializados.

Na tela **Importar/Exportar JSON**, o botão **Copiar estrutura para IA** envia ao clipboard um documento completo com personagens, locais, itens, monstros, missões, imagens e referências. Cole o retorno da IA no editor da mesma tela para gerar a prévia.

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

A implementação foi gerada a partir do texto de requisitos fornecido. Os arquivos Lua/LFM e testes legados citados nesse texto não estavam disponíveis na entrada desta execução. Veja `docs/legacy-analysis.md` e `docs/implementation-status.md` para o impacto dessa limitação.

## Fluxo econômico de contexto para Codex

O repositório inclui `AGENTS.md` por escopo e utilitários que evitam carregar arquivos grandes sem necessidade.

```bash
# mapa limitado do módulo
npm run context:tree -- apps/api 3

# localizar símbolos/termos sem imprimir arquivos inteiros
npm run context:search -- createEntity apps/api

# abrir somente um intervalo de um arquivo grande
npm run context:file -- apps/api/src/services/content.js 180 300

# consultar uma entidade dentro de um JSON saoData/backup sem imprimir o pacote inteiro
npm run data:entity -- examples/floor01.v2.sample.json npc.f1.greenfields.ragnar

# procurar entidades por ID, nome ou conteúdo
npm run data:search -- examples/floor01.v2.sample.json ragnar

# listar referências de entrada e saída de uma entidade
npm run data:refs -- examples/floor01.v2.sample.json npc.f1.greenfields.ragnar
```

Os comandos de contexto ignoram `data/backups/`, `node_modules/`, `dist/`, relatórios de teste e `package-lock.json` por padrão. Para mudanças normais, esses diretórios não devem ser lidos pelo agente.
