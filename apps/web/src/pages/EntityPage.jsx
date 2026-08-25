import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import { api } from '../lib/api.js';

const labels = {
  npc: 'Personagens',
  location: 'Locais',
  item: 'Itens',
  monster: 'Monstros',
  quest: 'Missões'
};
const singular = {
  npc: 'Personagem',
  location: 'Local',
  item: 'Item',
  monster: 'Monstro',
  quest: 'Missão'
};
const entityTypes = Object.keys(labels);
const plural = (type) => (type === 'location' ? 'locations' : `${type}s`);
const empty = (value) =>
  value == null ||
  value === '' ||
  (Array.isArray(value) && !value.length) ||
  (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);

const fieldLabels = {
  title: 'Título',
  level: 'Nível',
  race: 'Raça',
  gender: 'Gênero',
  age: 'Idade',
  profession: 'Profissão',
  type: 'Tipo',
  state: 'Estado',
  parentId: 'Local superior',
  environment: 'Ambiente',
  levelRecommended: 'Nível recomendado',
  recommendedLevel: 'Nível recomendado',
  category: 'Categoria',
  rarity: 'Raridade',
  value: 'Valor',
  group: 'Grupo',
  subtitle: 'Subtítulo',
  requirementLogic: 'Lógica',
  objectiveMode: 'Ordem dos objetivos',
  objectivesMode: 'Ordem dos objetivos',
  nd: 'ND',
  subtype: 'Subtipo',
  size: 'Tamanho',
  initiative: 'Iniciativa',
  perception: 'Percepção',
  senses: 'Sentidos',
  defense: 'Defesa',
  fortitude: 'Fortitude',
  reflex: 'Reflexos',
  will: 'Vontade',
  hp: 'PV',
  hpMax: 'PV máximo',
  mp: 'PM',
  mpMax: 'PM máximo',
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
  name: 'Nome',
  action: 'Ação',
  bonus: 'Bônus',
  damage: 'Dano',
  critical: 'Crítico',
  damageType: 'Tipo de dano',
  range: 'Alcance',
  quantity: 'Quantidade',
  notes: 'Notas',
  meters: 'Metros',
  mpCost: 'Custo de PM',
  save: 'Resistência',
  dc: 'CD',
  description: 'Descrição',
  operation: 'Operação',
  currency: 'Moeda',
  amount: 'Valor',
  distanceKm: 'Distância (km)',
  travelMinutes: 'Tempo (min)',
  access: 'Acesso'
};

function starter(type) {
  const base = {
    id: '',
    name: '',
    active: true,
    discoveryRevision: 0,
    tags: [],
    source: { kind: 'local', modifiedLocally: true },
    sectionVisibility: {
      basic: 'discoverable',
      references: 'discoverable',
      additional: 'discoverable'
    },
    fields: {
      shortDescription: { value: '', visibility: 'discoverable' },
      description: { value: '', visibility: 'discoverable' },
      gmNotes: { value: '', visibility: 'gm' }
    },
    references: []
  };
  if (type === 'npc')
    return {
      ...base,
      level: '',
      title: '',
      imageURL: '',
      identity: { race: '', gender: '', age: '', profession: '' },
      mainLocationId: '',
      currentLocationId: '',
      locations: [],
      relations: [],
      services: [],
      sectionVisibility: {
        ...base.sectionVisibility,
        identity: 'discoverable',
        locations: 'discoverable',
        relations: 'discoverable',
        services: 'discoverable',
        t20: 'discoverable'
      },
      fields: {
        ...base.fields,
        appearance: { value: '', visibility: 'discoverable' },
        personality: { value: '', visibility: 'discoverable' },
        history: { value: '', visibility: 'discoverable' }
      },
      t20: { mode: 'none', dataType: 'Ambesek.T20', characterId: '', firecastUri: '' }
    };
  if (type === 'location')
    return {
      ...base,
      type: 'region',
      parentId: '',
      levelRecommended: '',
      state: '',
      imageURL: '',
      services: [],
      connections: [],
      sectionVisibility: { ...base.sectionVisibility, services: 'discoverable' },
      fields: {
        ...base.fields,
        environment: { value: '', visibility: 'discoverable' },
        history: { value: '', visibility: 'discoverable' }
      }
    };
  if (type === 'item')
    return {
      ...base,
      category: 'misc',
      rarity: 'common',
      imageURL: '',
      value: { amount: 0, currency: 'T$' },
      stats: [],
      sectionVisibility: { ...base.sectionVisibility, stats: 'discoverable' }
    };
  if (type === 'monster')
    return {
      ...base,
      group: '',
      imageURL: '',
      sectionVisibility: { ...base.sectionVisibility, t20: 'discoverable' },
      t20: {
        nd: '',
        creatureType: '',
        subtype: '',
        size: '',
        initiative: '',
        perception: '',
        senses: '',
        defense: '',
        fortitude: '',
        reflex: '',
        will: '',
        hp: '',
        hpMax: '',
        mp: '',
        mpMax: '',
        attributes: {
          strength: '',
          dexterity: '',
          constitution: '',
          intelligence: '',
          wisdom: '',
          charisma: ''
        },
        statVisibility: {
          basic: 'discoverable',
          combat: 'discoverable',
          resources: 'discoverable',
          attributes: 'discoverable'
        }
      },
      movements: [],
      attacks: [],
      abilities: [],
      skills: [],
      traits: []
    };
  return {
    ...base,
    subtitle: '',
    type: 'side',
    state: 'available',
    levelRecommended: '',
    requirementLogic: 'all',
    requirements: [],
    objectiveMode: 'free',
    objectives: [],
    rewards: [],
    sectionVisibility: {
      ...base.sectionVisibility,
      requirements: 'discoverable',
      flow: 'discoverable',
      rewards: 'discoverable'
    },
    fields: {
      ...base.fields,
      introduction: { value: '', visibility: 'discoverable' },
      completion: { value: '', visibility: 'discoverable' }
    }
  };
}

function cleanForEditor(entity) {
  if (!entity) return null;
  const { entityType: _entityType, version: _version, _technical: technical, ...data } = entity;
  return { ...data, baseVisibility: technical?.baseVisibility ?? 'public' };
}

function VisibilityBadge({ visibility }) {
  if (!visibility) return null;
  return <span className={`visibility ${visibility}`}>{visibility}</span>;
}

function DiscoveryButton({ isGm, onGrant, kind = 'field', targetKey, label, targets }) {
  if (!isGm) return null;
  return (
    <button
      className="discovery-button"
      title={`Liberar ${label}`}
      onClick={() => onGrant({ label, targets: targets ?? [{ kind, key: targetKey }] })}
    >
      ◇ Liberar
    </button>
  );
}

function ModuleCard({
  title,
  children,
  isGm,
  onGrant,
  targetKey,
  kind = 'field',
  targets,
  className = ''
}) {
  return (
    <section className={`module-card ${className}`}>
      <header>
        <h3>{title}</h3>
        <DiscoveryButton
          isGm={isGm}
          onGrant={onGrant}
          kind={kind}
          targetKey={targetKey}
          label={title}
          targets={targets}
        />
      </header>
      <div className="module-content">{children}</div>
    </section>
  );
}

function ReferenceCombobox({ references = [], campaignId, label = 'Referência' }) {
  const navigate = useNavigate();
  const normalized = references.filter(Boolean).map((reference) => reference.target ?? reference);
  const [selected, setSelected] = useState('');
  const signature = normalized.map((reference) => `${reference.type}:${reference.id}`).join('|');
  useEffect(() => {
    setSelected(normalized[0] ? `${normalized[0].type}:${normalized[0].id}` : '');
  }, [signature]);
  if (!normalized.length) return <span className="muted">Sem referências.</span>;
  const current =
    normalized.find((reference) => `${reference.type}:${reference.id}` === selected) ??
    normalized[0];
  const available =
    current.available !== false && !current.broken && entityTypes.includes(current.type);
  return (
    <div className="reference-combobox">
      <label>
        <span>{label}</span>
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {normalized.map((reference, index) => (
            <option
              key={`${reference.type}:${reference.id}:${reference.role}:${index}`}
              value={`${reference.type}:${reference.id}`}
            >
              {reference.available === false ? '🔒 ' : ''}
              {reference.name ?? reference.id} · {singular[reference.type] ?? reference.type}
              {reference.role ? ` · ${reference.role}` : ''}
              {reference.chance ? ` · ${reference.chance}%` : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!available}
        onClick={() =>
          navigate(
            `/campaigns/${campaignId}/${plural(current.type)}?selected=${encodeURIComponent(current.id)}`
          )
        }
      >
        {available ? 'Abrir original' : 'Conteúdo não descoberto'}
      </button>
    </div>
  );
}

function DataGrid({ data, omit = [] }) {
  const entries = Object.entries(data ?? {}).filter(
    ([key, value]) => !omit.includes(key) && !empty(value)
  );
  if (!entries.length) return <span className="muted">Nenhuma informação cadastrada.</span>;
  return (
    <dl className="data-grid">
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt>{fieldLabels[key] ?? key}</dt>
          <dd>
            {typeof value === 'object' ? (
              <pre>{JSON.stringify(value, null, 2)}</pre>
            ) : (
              String(value)
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function EntityReferences({ entity, campaignId, isGm, onGrant }) {
  return (
    <ModuleCard title="Referências" targetKey="section.references" isGm={isGm} onGrant={onGrant}>
      <ReferenceCombobox
        references={entity.references}
        campaignId={campaignId}
        label="Registro relacionado"
      />
    </ModuleCard>
  );
}

function MonsterDetails({ entity, campaignId, isGm, onGrant }) {
  const sheet = entity.sheet ?? {};
  const basicTargets = ['basic', 'nd', 'type', 'subtype', 'size'].map((key) => ({
    kind: 'monster_stat',
    key
  }));
  const componentGroups = [
    ['movement', 'Deslocamentos', entity.movements],
    ['attack', 'Ataques', entity.attacks],
    ['ability', 'Habilidades', entity.abilities],
    ['skill', 'Perícias', entity.skills],
    ['trait', 'Características', entity.traits]
  ];
  return (
    <div className="module-stack">
      <ModuleCard
        title="Informações básicas do monstro"
        isGm={isGm}
        onGrant={onGrant}
        targets={basicTargets}
      >
        <DataGrid
          data={{ nd: sheet.nd, type: sheet.type, subtype: sheet.subtype, size: sheet.size }}
        />
      </ModuleCard>
      {['combat', 'resources', 'resistances', 'attributes'].map((module) => (
        <ModuleCard
          key={module}
          title={
            {
              combat: 'Combate',
              resources: 'Recursos',
              resistances: 'Resistências',
              attributes: 'Atributos'
            }[module]
          }
          kind="monster_stat"
          targetKey={module}
          isGm={isGm}
          onGrant={onGrant}
        >
          <DataGrid data={sheet[module]} />
        </ModuleCard>
      ))}
      {componentGroups.map(([kind, title, entries = []]) => (
        <ModuleCard key={kind} title={title} isGm={false} onGrant={onGrant}>
          <div className="component-grid">
            {entries.length ? (
              entries.map((entry) => (
                <article className="component-card" key={entry.id}>
                  <div className="component-head">
                    <strong>{entry.data?.name ?? entry.data?.type ?? entry.id}</strong>
                    <DiscoveryButton
                      isGm={isGm}
                      onGrant={onGrant}
                      kind={`monster_${kind}`}
                      targetKey={entry.id}
                      label={`${title}: ${entry.data?.name ?? entry.id}`}
                    />
                  </div>
                  <DataGrid data={entry.data} omit={['name']} />
                </article>
              ))
            ) : (
              <span className="muted">Nenhum registro visível.</span>
            )}
          </div>
        </ModuleCard>
      ))}
      <ModuleCard
        title="Itens equipados e drops"
        targetKey="section.references"
        isGm={isGm}
        onGrant={onGrant}
      >
        <ReferenceCombobox
          references={(entity.references ?? []).filter((reference) => reference.type === 'item')}
          campaignId={campaignId}
          label="Item"
        />
      </ModuleCard>
      <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />
    </div>
  );
}

function QuestDetails({ entity, campaignId, isGm, onGrant }) {
  return (
    <div className="module-stack">
      <ModuleCard title="Requisitos" targetKey="section.requirements" isGm={isGm} onGrant={onGrant}>
        <DataGrid
          data={{ requirementLogic: entity.requirementLogic, prerequisites: entity.prerequisites }}
        />
        <div className="component-grid">
          {entity.requirements?.map((requirement, index) => (
            <article
              className="component-card"
              key={`${requirement.type}-${requirement.id}-${index}`}
            >
              <DataGrid data={requirement} omit={['target']} />
              {requirement.target && (
                <ReferenceCombobox
                  references={[requirement.target]}
                  campaignId={campaignId}
                  label="Requisito vinculado"
                />
              )}
            </article>
          ))}
        </div>
      </ModuleCard>
      <ModuleCard title="Fluxo da missão" targetKey="section.flow" isGm={isGm} onGrant={onGrant}>
        <div className="component-grid">
          {entity.startSource && (
            <ReferenceCombobox
              references={[entity.startSource]}
              campaignId={campaignId}
              label="Início da missão"
            />
          )}
          {entity.completionReceiver && (
            <ReferenceCombobox
              references={[entity.completionReceiver]}
              campaignId={campaignId}
              label="Entrega da missão"
            />
          )}
          {entity.nextQuestReferences?.length > 0 && (
            <ReferenceCombobox
              references={entity.nextQuestReferences}
              campaignId={campaignId}
              label="Próximas missões"
            />
          )}
          {!entity.startSource &&
            !entity.completionReceiver &&
            !entity.nextQuestReferences?.length && (
              <span className="muted">Nenhum vínculo de fluxo visível.</span>
            )}
        </div>
      </ModuleCard>
      <ModuleCard title="Objetivos" isGm={false} onGrant={onGrant}>
        <div className="component-grid">
          {entity.objectives?.length ? (
            entity.objectives.map((objective) => (
              <article className="component-card" key={objective.objectiveId}>
                <div className="component-head">
                  <strong>
                    {objective.order}. {objective.text}
                  </strong>
                  <DiscoveryButton
                    isGm={isGm}
                    onGrant={onGrant}
                    kind="objective"
                    targetKey={objective.objectiveId}
                    label={`Objetivo: ${objective.text}`}
                  />
                </div>
                <small>
                  {objective.type} · {objective.requiredQuantity}x
                  {objective.optional ? ' · opcional' : ''}
                </small>
                {objective.target && (
                  <ReferenceCombobox
                    references={[objective.target]}
                    campaignId={campaignId}
                    label="Alvo"
                  />
                )}
              </article>
            ))
          ) : (
            <span className="muted">Sem objetivos visíveis.</span>
          )}
        </div>
      </ModuleCard>
      <ModuleCard title="Recompensas" targetKey="section.rewards" isGm={isGm} onGrant={onGrant}>
        <div className="component-grid">
          {entity.rewards?.length ? (
            entity.rewards.map((reward, index) => (
              <article className="component-card" key={`${reward.type}-${index}`}>
                <DataGrid data={reward} omit={['target']} />
                {reward.target && (
                  <ReferenceCombobox
                    references={[reward.target]}
                    campaignId={campaignId}
                    label="Recompensa vinculada"
                  />
                )}
              </article>
            ))
          ) : (
            <span className="muted">Nenhuma recompensa visível.</span>
          )}
        </div>
      </ModuleCard>
      <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />
    </div>
  );
}

function TypeDetails({ entity, type, campaignId, isGm, onGrant }) {
  if (type === 'monster')
    return <MonsterDetails entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />;
  if (type === 'quest')
    return <QuestDetails entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />;
  if (type === 'npc')
    return (
      <div className="module-stack">
        <ModuleCard title="Identidade" targetKey="section.identity" isGm={isGm} onGrant={onGrant}>
          <DataGrid
            data={
              entity.identity ?? {
                race: entity.race,
                gender: entity.gender,
                age: entity.age,
                profession: entity.profession
              }
            }
          />
        </ModuleCard>
        <ModuleCard title="Locais" targetKey="section.locations" isGm={isGm} onGrant={onGrant}>
          <ReferenceCombobox
            references={
              entity.locations ?? [
                entity.mainLocationId && { type: 'location', id: entity.mainLocationId },
                entity.currentLocationId && { type: 'location', id: entity.currentLocationId }
              ]
            }
            campaignId={campaignId}
            label="Local vinculado"
          />
        </ModuleCard>
        <ModuleCard title="Relações" targetKey="section.relations" isGm={isGm} onGrant={onGrant}>
          <ReferenceCombobox
            references={entity.relations}
            campaignId={campaignId}
            label="NPC relacionado"
          />
        </ModuleCard>
        <ModuleCard title="Serviços" targetKey="section.services" isGm={isGm} onGrant={onGrant}>
          <DataGrid data={{ services: entity.services }} />
        </ModuleCard>
        <ModuleCard title="Ficha T20" targetKey="section.t20" isGm={isGm} onGrant={onGrant}>
          <DataGrid data={entity.t20} />
        </ModuleCard>
        <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />
      </div>
    );
  if (type === 'location')
    return (
      <div className="module-stack">
        <ModuleCard title="Hierarquia" targetKey="section.basic" isGm={isGm} onGrant={onGrant}>
          <ReferenceCombobox
            references={entity.parent ? [entity.parent] : []}
            campaignId={campaignId}
            label="Local superior"
          />
        </ModuleCard>
        <ModuleCard title="Serviços" targetKey="section.services" isGm={isGm} onGrant={onGrant}>
          <DataGrid data={{ services: entity.services }} />
        </ModuleCard>
        <ModuleCard title="Conexões" isGm={false} onGrant={onGrant}>
          <div className="component-grid">
            {entity.connections?.length ? (
              entity.connections.map((connection) => (
                <article className="component-card" key={connection.connectionId}>
                  <div className="component-head">
                    <strong>
                      {connection.direction || '→'} {connection.target?.name ?? connection.targetId}
                    </strong>
                    <DiscoveryButton
                      isGm={isGm}
                      onGrant={onGrant}
                      kind="location_connection"
                      targetKey={connection.connectionId}
                      label={`Conexão: ${connection.direction || connection.targetId}`}
                    />
                  </div>
                  <DataGrid
                    data={{
                      distanceKm: connection.distanceKm,
                      travelMinutes: connection.travelMinutes,
                      access: connection.access
                    }}
                  />
                  {connection.target && (
                    <ReferenceCombobox
                      references={[connection.target]}
                      campaignId={campaignId}
                      label="Destino"
                    />
                  )}
                </article>
              ))
            ) : (
              <span className="muted">Sem conexões visíveis.</span>
            )}
          </div>
        </ModuleCard>
        <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />
      </div>
    );
  return (
    <div className="module-stack">
      <ModuleCard title="Atributos do item" targetKey="section.stats" isGm={isGm} onGrant={onGrant}>
        <div className="component-grid">
          {entity.stats?.length ? (
            entity.stats.map((stat) => (
              <article className="component-card" key={stat.key}>
                <DataGrid data={stat} />
              </article>
            ))
          ) : (
            <span className="muted">Sem atributos visíveis.</span>
          )}
        </div>
      </ModuleCard>
      <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />
    </div>
  );
}

function EntityDetail({ entity, type, campaignId, isGm, onEdit, onDelete, onGrant }) {
  if (!entity) return <div className="empty-detail">Selecione um registro.</div>;
  const basic =
    type === 'npc'
      ? { title: entity.title, level: entity.level }
      : type === 'location'
        ? {
            type: entity.type,
            state: entity.state,
            levelRecommended: entity.levelRecommended ?? entity.recommendedLevel
          }
        : type === 'item'
          ? { category: entity.category, rarity: entity.rarity, value: entity.value }
          : type === 'monster'
            ? { group: entity.group }
            : {
                subtitle: entity.subtitle,
                type: entity.type,
                state: entity.state,
                levelRecommended: entity.levelRecommended ?? entity.recommendedLevel
              };
  return (
    <article className="detail-card">
      <div className="detail-heading">
        <div>
          <small>{singular[type]}</small>
          <h2>{entity.name}</h2>
        </div>
        <div className="actions">
          <DiscoveryButton
            isGm={isGm}
            onGrant={onGrant}
            kind="entity"
            targetKey="existence"
            label={`Existência de ${entity.name}`}
          />
          {isGm && <button onClick={onEdit}>Editar</button>}
          {isGm && (
            <button className="danger" onClick={onDelete}>
              Excluir
            </button>
          )}
        </div>
      </div>
      {(entity.imageURL || entity.imageUrl || entity.portraitUrl || entity.mapUrl) && (
        <img
          className="hero-image"
          src={entity.imageURL ?? entity.imageUrl ?? entity.portraitUrl ?? entity.mapUrl}
          alt=""
        />
      )}
      <div className="chips">
        {entity.tags?.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <ModuleCard
        title="Informações básicas"
        targetKey="section.basic"
        isGm={isGm}
        onGrant={onGrant}
      >
        <DataGrid data={basic} />
      </ModuleCard>
      <div className="field-grid">
        {entity.fields?.map((field) => (
          <section key={field.key}>
            <div className="component-head">
              <strong>{fieldLabels[field.key] ?? field.key}</strong>
              <div className="actions">
                <VisibilityBadge visibility={field.visibility} />
                <DiscoveryButton
                  isGm={isGm}
                  onGrant={onGrant}
                  kind="field"
                  targetKey={field.key}
                  label={fieldLabels[field.key] ?? field.key}
                />
              </div>
            </div>
            <p>{field.value}</p>
          </section>
        ))}
      </div>
      <TypeDetails
        entity={entity}
        type={type}
        campaignId={campaignId}
        isGm={isGm}
        onGrant={onGrant}
      />
      {isGm && (
        <details className="technical">
          <summary>Dados técnicos</summary>
          <div className="technical-row">
            <code>{entity.id}</code>
            <button onClick={() => navigator.clipboard.writeText(entity.id)}>Copiar ID</button>
          </div>
          <pre>{JSON.stringify(entity._technical ?? {}, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}

function ReferenceBuilder({ type, text, setText }) {
  const { campaignId } = useParams();
  const queries = useQueries({
    queries: entityTypes.map((entityType) => ({
      queryKey: ['reference-options', campaignId, entityType],
      queryFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(entityType)}?pageSize=100`)
    }))
  });
  const [targetType, setTargetType] = useState(type === 'location' ? 'location' : 'npc');
  const [targetId, setTargetId] = useState('');
  const [role, setRole] = useState('related');
  const slots = [{ value: 'references', label: 'Referências gerais' }];
  if (type === 'npc')
    slots.push(
      { value: 'locations', label: 'Locais visitados' },
      { value: 'relations', label: 'Relações' },
      { value: 'mainLocationId', label: 'Local principal' },
      { value: 'currentLocationId', label: 'Local atual' }
    );
  if (type === 'location')
    slots.push(
      { value: 'parentId', label: 'Local superior' },
      { value: 'connection', label: 'Conexão' }
    );
  if (type === 'quest')
    slots.push(
      { value: 'requirement', label: 'Requisito' },
      { value: 'reward', label: 'Recompensa' }
    );
  const [slot, setSlot] = useState('references');
  const options = queries[entityTypes.indexOf(targetType)]?.data?.items ?? [];
  useEffect(() => {
    if (options.length && !options.some((item) => item.id === targetId)) setTargetId(options[0].id);
  }, [options, targetId]);
  const add = () => {
    const data = JSON.parse(text);
    const reference = { type: targetType, id: targetId, role };
    if (['references', 'locations', 'relations'].includes(slot))
      data[slot] = [...(data[slot] ?? []), reference];
    else if (['mainLocationId', 'currentLocationId', 'parentId'].includes(slot))
      data[slot] = targetId;
    else if (slot === 'connection')
      data.connections = [
        ...(data.connections ?? []),
        {
          connectionId: `${data.id || 'loc'}.connection.${(data.connections?.length ?? 0) + 1}`,
          to: targetId,
          direction: '',
          distanceKm: 0,
          travelMinutes: 0,
          visibility: 'discoverable'
        }
      ];
    else if (slot === 'requirement')
      data.requirements = [...(data.requirements ?? []), { type: targetType, id: targetId }];
    else if (slot === 'reward')
      data.rewards = [...(data.rewards ?? []), { type: targetType, id: targetId, quantity: '1' }];
    setText(JSON.stringify(data, null, 2));
  };
  return (
    <div className="reference-builder">
      <strong>Vincular por referência</strong>
      <select value={slot} onChange={(event) => setSlot(event.target.value)}>
        {slots.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <select
        value={targetType}
        onChange={(event) => {
          setTargetType(event.target.value);
          setTargetId('');
        }}
      >
        {entityTypes.map((entityType) => (
          <option key={entityType} value={entityType}>
            {singular[entityType]}
          </option>
        ))}
      </select>
      <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
        <option value="">Selecione…</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <input
        value={role}
        onChange={(event) => setRole(event.target.value)}
        placeholder="Papel da referência"
      />
      <button onClick={add} disabled={!targetId}>
        Adicionar vínculo
      </button>
    </div>
  );
}

function EntityEditor({ type, initial, version, onClose, onSaved, campaignId }) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const data = JSON.parse(text);
      if (!data.id || !data.name) throw new Error('id e name são obrigatórios.');
      const endpoint = `/api/v1/campaigns/${campaignId}/${plural(type)}${version ? `/${encodeURIComponent(initial.id)}` : ''}`;
      return api(endpoint, {
        method: version ? 'PUT' : 'POST',
        headers: version ? { 'if-match': String(version) } : {},
        body: data
      });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err.message)
  });
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal entity-editor" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <small>REGISTRO DO SISTEMA</small>
            <h2>{version ? 'Editar' : 'Nova entidade'}</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <p className="muted">
          O modelo completo da especificação fica disponível abaixo. IDs são permanentes.
        </p>
        <ReferenceBuilder type={type} text={text} setText={setText} />
        <textarea
          className="json-editor"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck="false"
        />
        {error && <div className="alert error">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscoveryModal({ request, campaignId, entityType, entityId, onClose }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const [allowance, setAllowance] = useState('allow');
  const memberships = useQuery({
    queryKey: ['memberships', campaignId],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`)
  });
  const players = (memberships.data ?? []).filter(
    (entry) => !['owner', 'gm', 'assistant_gm'].includes(entry.role)
  );
  const save = useMutation({
    mutationFn: () =>
      api(`/api/v1/campaigns/${campaignId}/discoveries/batch`, {
        method: 'POST',
        body: {
          grants: [...selected].flatMap((subjectId) =>
            request.targets.map((target) => ({
              subjectType: 'user',
              subjectId,
              entityType,
              entityId,
              targetKind: target.kind,
              targetKey: target.key,
              allowance
            }))
          )
        }
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['discoveries', campaignId] });
      await queryClient.invalidateQueries({
        queryKey: ['entity', campaignId, entityType, entityId]
      });
      onClose();
    }
  });
  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  return (
    <div className="modal-backdrop">
      <div className="modal discovery-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <small>PERMISSÃO MODULAR</small>
            <h2>{request.label}</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <p>Selecione os jogadores que receberão esta permissão.</p>
        <div className="permission-mode">
          <button
            className={allowance === 'allow' ? 'selected' : ''}
            onClick={() => setAllowance('allow')}
          >
            ✓ Permitir visualizar
          </button>
          <button
            className={allowance === 'deny' ? 'selected deny' : ''}
            onClick={() => setAllowance('deny')}
          >
            × Bloquear visualização
          </button>
        </div>
        <div className="player-picker">
          {memberships.isLoading && <span>Carregando jogadores…</span>}
          {players.map((entry) => (
            <label key={entry.user.id} className={selected.has(entry.user.id) ? 'selected' : ''}>
              <input
                type="checkbox"
                checked={selected.has(entry.user.id)}
                onChange={() => toggle(entry.user.id)}
              />
              <span>
                <strong>{entry.user.name}</strong>
                <small>
                  @{entry.user.login} · {entry.role}
                </small>
              </span>
            </label>
          ))}
          {!memberships.isLoading && !players.length && (
            <span className="muted">Nenhum jogador cadastrado nesta campanha.</span>
          )}
        </div>
        {save.error && <div className="alert error">{save.error.message}</div>}
        <div className="modal-actions">
          <span className="muted">
            {selected.size} selecionado(s) · {request.targets.length} regra(s) por jogador
          </span>
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            disabled={!selected.size || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Aplicando…' : 'Confirmar permissões'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationHierarchy({ items, onSelect }) {
  const byId = new Map(items.map((item) => [item.id, { ...item, children: [] }]));
  const roots = [];
  for (const item of byId.values()) {
    if (item.parentId && byId.has(item.parentId) && item.parentId !== item.id)
      byId.get(item.parentId).children.push(item);
    else roots.push(item);
  }
  const seen = new Set();
  const render = (item, depth = 0) => {
    if (seen.has(item.id))
      return (
        <div key={`${item.id}-cycle`} className="tree-cycle">
          ↻ {item.name}
        </div>
      );
    seen.add(item.id);
    const node = (
      <div key={item.id}>
        <button
          className="tree-node"
          style={{ paddingLeft: `${10 + depth * 16}px` }}
          onClick={() => onSelect(item.id)}
        >
          {item.name}
        </button>
        {item.children.map((child) => render(child, depth + 1))}
      </div>
    );
    seen.delete(item.id);
    return node;
  };
  return (
    <div className="tree">
      {roots.sort((a, b) => a.name.localeCompare(b.name)).map((item) => render(item))}
    </div>
  );
}

export function EntityPage({ type }) {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('selected');
  const [editor, setEditor] = useState(null);
  const [grantRequest, setGrantRequest] = useState(null);
  const [hierarchy, setHierarchy] = useState(false);
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['entities', campaignId, type],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(type)}?pageSize=100`)
  });
  const detail = useQuery({
    queryKey: ['entity', campaignId, type, selectedId],
    queryFn: () =>
      api(`/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(selectedId)}`),
    enabled: Boolean(selectedId)
  });
  useEffect(() => {
    if (!selectedId && list.data?.items?.length)
      setParams({ selected: list.data.items[0].id }, { replace: true });
  }, [selectedId, list.data, setParams]);
  const remove = useMutation({
    mutationFn: () =>
      api(`/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE'
      }),
    onSuccess: async () => {
      setParams({});
      await queryClient.invalidateQueries({ queryKey: ['entities', campaignId, type] });
    }
  });
  const itemMap = useMemo(
    () => new Map((list.data?.items ?? []).map((item) => [item.id, item])),
    [list.data]
  );
  if (list.isLoading)
    return <div className="state-card">Carregando {labels[type].toLowerCase()}…</div>;
  if (list.isError) return <div className="state-card error">{list.error.message}</div>;
  const current = detail.data ?? itemMap.get(selectedId);
  return (
    <>
      <div className="page-heading">
        <div>
          <small className="eyebrow">BASE DE DADOS DE AINCRAD</small>
          <h1>{labels[type]}</h1>
          <p>{list.data.returned} registros visíveis</p>
        </div>
        <div className="actions">
          {type === 'location' && (
            <button onClick={() => setHierarchy((value) => !value)}>
              {hierarchy ? 'Lista' : 'Hierarquia'}
            </button>
          )}
          {isGm && (
            <button className="primary" onClick={() => setEditor({ data: starter(type) })}>
              ＋ Novo
            </button>
          )}
        </div>
      </div>
      <div className="split-view">
        <aside className="entity-list">
          {hierarchy && type === 'location' ? (
            <LocationHierarchy
              items={list.data.items}
              onSelect={(id) => setParams({ selected: id })}
            />
          ) : (
            list.data.items.map((item) => (
              <button
                key={item.id}
                className={selectedId === item.id ? 'selected' : ''}
                onClick={() => setParams({ selected: item.id })}
              >
                <span className="list-diamond">◇</span>
                <strong>{item.name}</strong>
                <small>{item.id}</small>
              </button>
            ))
          )}
          {!list.data.items.length && <div className="empty-list">Nenhum registro visível.</div>}
        </aside>
        <section className="detail-pane">
          {detail.isLoading ? (
            <div className="state-card">Carregando detalhes…</div>
          ) : (
            <EntityDetail
              entity={current}
              type={type}
              campaignId={campaignId}
              isGm={isGm}
              onGrant={setGrantRequest}
              onEdit={() =>
                setEditor({ data: cleanForEditor(detail.data), version: detail.data.version })
              }
              onDelete={() => {
                if (window.confirm(`Excluir ${current?.name}?`)) remove.mutate();
              }}
            />
          )}
        </section>
      </div>
      {editor && (
        <EntityEditor
          type={type}
          initial={editor.data}
          version={editor.version}
          campaignId={campaignId}
          onClose={() => setEditor(null)}
          onSaved={async (saved) => {
            setEditor(null);
            await queryClient.invalidateQueries({ queryKey: ['entities', campaignId, type] });
            if (saved?.id) setParams({ selected: saved.id });
          }}
        />
      )}
      {grantRequest && (
        <DiscoveryModal
          request={grantRequest}
          campaignId={campaignId}
          entityType={type}
          entityId={selectedId}
          onClose={() => setGrantRequest(null)}
        />
      )}
    </>
  );
}
