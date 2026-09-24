import { labels, bulkEntityLabels, entityTypeLabels, singular, entityTypes, objectiveTypeLabels, referenceRoleLabels, referenceRoleOptions, operationOptions, questTypeOptions, questStateOptions, requirementLogicOptions, objectiveModeOptions, locationTypeOptions, locationStateOptions, itemCategoryOptions, itemRarityOptions, monsterSizeOptions, monsterTypeOptions, idPrefixes, visibilityLabels, fieldLabels, sectionLabels, monsterStatLabels } from '@sao/domain';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';

import { api } from '../lib/api.js';
import { LocationImage, LocationImagePicker } from '../components/LocationImage.jsx';
import { locationImageUrlError } from '../lib/locationImage.js';

import { createEntityDraft, draftControls, updateEntityDraft, prepareCanonicalPayload, discoverableCreation } from '../lib/entityDraft.js';

import { hasRenderableContent } from '../lib/entityContent.js';

import { formatEntityName } from '../lib/entityDisplay.js';

import {

  getEntityChangeState,

  getEntitySeenStorageKey,

  readEntityActivityAt,

  readEntitySeenAt

} from '../lib/notifications.js';

import {

  locationFloor,

  resolveLocationMenuClick,

  resolveLocationMenuEntries,

  resolveLocationMenuRegions,

  resolveLocationMenuState,

  shouldShowLocationList

} from '../lib/locationMenu.js';

import { filterMonstersByLocation } from '../lib/monsterLocationFilter.js';
import { locationBranchEntries, locationDiscoveryRows } from '../lib/locationDiscovery.js';
import { baseDiscoveryTargets, discoveryTargetKey, npcDiscoveryTargets, questDiscoveryTargets, categorizedDiscoveryTypes, categorizedDiscoveryTargets, availableDiscoveryTargets, expandDiscoveryTargets, groupDiscoveryTargetsForDisplay } from '../lib/discoveryTargets.js';


const autoIdTypes = new Set(entityTypes);



function idFromName(type, name) {

  const slug = String(name ?? '')

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, '-')

    .replace(/^-+|-+$/g, '') || 'sem-nome';

  return `${idPrefixes[type]}${slug}`;

}

const ViewersContext = createContext(null);

const plural = (type) => (type === 'location' ? 'locations' : `${type}s`);

const entityImage = (entity) =>

  entity?.imageURL ?? entity?.imageUrl ?? entity?.portraitUrl ?? entity?.mapUrl ?? '';

const empty = (value) =>

  value == null ||

  value === '' ||

  (Array.isArray(value) && !value.length) ||

  (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);



function starter(type) {

  const base = {

    id: idPrefixes[type],

    name: '',

    active: true,

    discoveryRevision: 0,

    tags: [],

    source: { kind: 'local', modifiedLocally: true },

    baseVisibility: 'discoverable',

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

    imageURL: '',

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



function VisibilityBadge({ visibility }) {

  if (!visibility) return null;

  return <span className={`visibility ${visibility}`}>{visibilityLabels[visibility] ?? visibility}</span>;

}



function referenceRoleLabel(role) {

  if (!role) return '';

  const backlinkPrefix = 'referenciado por · ';

  if (role.startsWith(backlinkPrefix)) {

    const targetRole = role.slice(backlinkPrefix.length);

    return `Referenciado por · ${referenceRoleLabels[targetRole] ?? targetRole}`;

  }

  return referenceRoleLabels[role] ?? role;

}



function DiscoveryButton({ isGm, onGrant, kind = 'field', targetKey, label, targets }) {

  const viewerData = useContext(ViewersContext);

  if (!isGm) return null;

  const effectiveTargets = targets ?? [{ kind, key: targetKey }];

  const viewerIds = effectiveTargets.length

    ? effectiveTargets.reduce((current, target, index) => {

        const ids = viewerData?.viewers?.[`${target.kind}:${target.key}`] ?? [];

        return index === 0 ? ids : current.filter((id) => ids.includes(id));

      }, [])

    : [];

  const viewers = viewerIds

    .map((id) => viewerData?.users?.find((user) => user.id === id))

    .filter(Boolean);

  return (

    <div className="discovery-control">

      <div className="viewer-avatars" aria-label={`${viewers.length} pessoa(s) podem visualizar`}>

        {viewers.map((viewer) => (

          <span className="viewer-avatar" key={viewer.id} title={viewer.name}>

            {viewer.characterImageUrl ? <img src={viewer.characterImageUrl} alt="" /> : viewer.name

              .split(/\s+/)

              .filter(Boolean)

              .slice(0, 2)

              .map((part) => part[0])

              .join('')

              .toUpperCase()}

          </span>

        ))}

      </div>

      <button

        className="discovery-button"

        title={`Liberar ${label}`}

        onClick={() => onGrant({ label, targets: effectiveTargets })}

      >

        ◇ Liberar

      </button>

    </div>

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

  bulkTargets,

  bulkLabel,

  className = ''

}) {

  const showBulkButton = isGm && Array.isArray(bulkTargets) && bulkTargets.length > 1;

  return (

    <section className={`module-card ${className}`}>

      <header>

        <h3>{title}</h3>

        {showBulkButton && (

          <button

            className="discovery-button"

            title={bulkLabel ?? `Liberar campos de ${title.toLowerCase()}`}

            onClick={() => onGrant({

              label: bulkLabel ?? `Liberar campos de ${title.toLowerCase()}`,

              targets: bulkTargets,

              bulk: true

            })}

          >

            ◇ Liberar campos

          </button>

        )}

        {(targetKey || targets) && (

          <DiscoveryButton

            isGm={isGm}

            onGrant={onGrant}

            kind={kind}

            targetKey={targetKey}

            label={title}

            targets={targets}

          />

        )}

      </header>

      <div className="module-content">{children}</div>

    </section>

  );

}



function ReferenceViewerAvatars({ campaignId, itemId }) {

  const viewers = useQuery({

    queryKey: ['entity-viewers', campaignId, 'item', itemId],

    queryFn: () => api(`/api/v1/campaigns/${campaignId}/discoveries/item/${encodeURIComponent(itemId)}/viewers`),

    enabled: Boolean(itemId)

  });

  const knownIds = viewers.data?.viewers?.['entity:existence'] ?? [];

  const users = (viewers.data?.users ?? []).filter((user) => knownIds.includes(user.id));

  if (!users.length) return null;

  return (

    <div className="viewer-avatars" aria-label={`${users.length} pessoa(s) sabem deste drop`}>

      {users.map((viewer) => (

        <span className="viewer-avatar" key={viewer.id} title={viewer.name}>

          {viewer.characterImageUrl ? <img src={viewer.characterImageUrl} alt="" /> : (viewer.name ?? 'P')

            .split(/\s+/)

            .filter(Boolean)

            .slice(0, 2)

            .map((part) => part[0])

            .join('')

            .toUpperCase()}

        </span>

      ))}

    </div>

  );

}



export function canOpenReference(reference) {

  return Boolean(

    reference &&

      reference.available !== false &&

      !reference.broken &&

      entityTypes.includes(reference.type)

  );

}



export function ReferenceCombobox({ references = [], campaignId, label = 'Referência' }) {

  const navigate = useNavigate();

  const normalized = references

    .filter(Boolean)

    .map((reference) => reference.target ?? reference)

    .filter((reference) => reference && !reference.broken);

  const [selected, setSelected] = useState(0);

  const signature = normalized

    .map((reference) => `${reference.type}:${reference.id}:${reference.role ?? ''}`)

    .join('|');

  useEffect(() => {

    setSelected(0);

  }, [signature]);

  if (!normalized.length) return null;

  const current = normalized[selected] ?? normalized[0];

  const available = canOpenReference(current);



  return (

    <div className="reference-combobox">

      <div className="reference-list-wrap">

        <span className="reference-label">{label}</span>

        <ul className="reference-list">

          {normalized.map((reference, index) => {

            const isSelected = index === selected;

            return (

              <li key={`${reference.type}:${reference.id}:${reference.role}:${index}`}>

                <button

                  type="button"

                  className={isSelected ? 'selected' : ''}

                  onClick={() => setSelected(index)}

                  title={`${formatEntityName(reference, 'Referência indisponível')} · ${singular[reference.type] ?? reference.type}${reference.role ? ` · ${referenceRoleLabel(reference.role)}` : ''}${reference.chance ? ` · ${reference.chance}%` : ''}${reference.quantityMin != null && reference.quantityMax != null ? ` · ${reference.quantityMin}-${reference.quantityMax}` : ''}`}

                >

                  {reference.available === false ? '🔒 ' : ''}

                  <span>{formatEntityName(reference, 'Referência indisponível')}</span>

                  <small>

                    {singular[reference.type] ?? reference.type}

                    {reference.role ? ` · ${referenceRoleLabel(reference.role)}` : ''}

                    {reference.chance ? ` · ${reference.chance}%` : ''}

                    {reference.quantityMin != null && reference.quantityMax != null ? ` · ${reference.quantityMin}-${reference.quantityMax}` : ''}

                  </small>

                  {reference.type === 'item' && (reference.role === 'drops' || reference.role === 'drop') && (

                    <ReferenceViewerAvatars campaignId={campaignId} itemId={reference.id} />

                  )}

                </button>

              </li>

            );

          })}

        </ul>

      </div>

      <button

        type="button"

        disabled={!available}

        aria-label={`Abrir referência ${formatEntityName(current, current.id)}`}

        onClick={() => {

          navigate(

            `/campaigns/${campaignId}/${plural(current.type)}?selected=${encodeURIComponent(current.id)}`

          );

        }}

      >

        {available ? 'Abrir referência' : 'Conteúdo não descoberto'}

      </button>

    </div>

  );

}



function QuestAssign({ campaignId, questId, questName }) {

  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);

  const [selectedOwners, setSelectedOwners] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  const memberships = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`) });

  const progress = useQuery({
    queryKey: ['progress', campaignId, 'quest', questId, 'assignment'],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/progress`),
    enabled: open
  });

  const players = (memberships.data ?? []).filter((entry) => !['owner', 'gm', 'assistant_gm'].includes(entry.role));
  const assignedIds = new Set((progress.data ?? [])
    .filter((entry) => entry.questId === questId && entry.ownerType === 'player')
    .map((entry) => entry.ownerId));
  const availablePlayers = players.filter((entry) => !assignedIds.has(entry.user.login) && !assignedIds.has(entry.user.id));
  const assignedPlayers = players.filter((entry) => assignedIds.has(entry.user.login) || assignedIds.has(entry.user.id));
  const matchesSearch = ({ user }) => `${user.name} ${user.login}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'));
  const filteredAvailable = availablePlayers.filter(matchesSearch);
  const loading = memberships.isLoading || progress.isLoading;
  const loadError = memberships.isError || progress.isError;
  const toggleOwner = (ownerId) => setSelectedOwners((current) => {
    const next = new Set(current);
    next.has(ownerId) ? next.delete(ownerId) : next.add(ownerId);
    return next;
  });
  const toggleAll = () => setSelectedOwners((current) =>
    filteredAvailable.every((entry) => current.has(entry.user.login))
      ? new Set([...current].filter((id) => !filteredAvailable.some((entry) => entry.user.login === id)))
      : new Set([...current, ...filteredAvailable.map((entry) => entry.user.login)])
  );
  const assign = useMutation({
    mutationFn: () => Promise.all([...selectedOwners].map((ownerId) => api(`/api/v1/campaigns/${campaignId}/progress`, {
      method: 'POST',
      body: { questId, ownerType: 'player', ownerId }
    }))),
    onSettled: async () => {
      setSelectedOwners(new Set());
      await queryClient.invalidateQueries({ queryKey: ['progress', campaignId] });
    }
  });

  const avatar = (user) => <span className="quest-assignment-avatar" aria-hidden="true">{user.characterImageUrl ? <img src={user.characterImageUrl} alt="" /> : (user.name ?? 'J').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('')}</span>;

  return <div className="quest-assign"><button type="button" onClick={() => { setSelectedOwners(new Set()); setSearch(''); assign.reset(); setOpen(true); }}>Atribuir missão</button>
    <dialog ref={dialogRef} className="modal quest-assign-modal" aria-labelledby="quest-assign-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
    <div className="modal-head"><div><small>MISSÕES · JOGADORES</small><h2 id="quest-assign-title">Atribuir missão</h2><p>{questName}</p></div><button type="button" aria-label="Fechar atribuição" onClick={() => setOpen(false)}>×</button></div>
    <div className="modal-content quest-assign-form">
    <label className="quest-assignment-search">Buscar jogador<input type="search" value={search} placeholder="Nome ou login…" onChange={(event) => setSearch(event.target.value)} /></label>
    {loading ? <p className="quest-assignment-empty">Carregando jogadores…</p> : loadError ? <div role="alert">Não foi possível carregar os jogadores. <button onClick={() => { memberships.refetch(); progress.refetch(); }}>Tentar novamente</button></div> : <div className="quest-assignment-columns">
    <section aria-label="Jogadores disponíveis"><div className="quest-assignment-section-head"><h3>Disponíveis <span>{availablePlayers.length}</span></h3><button type="button" onClick={toggleAll} disabled={!filteredAvailable.length || assign.isPending}>{filteredAvailable.length > 0 && filteredAvailable.every((entry) => selectedOwners.has(entry.user.login)) ? 'Limpar seleção' : 'Selecionar todos'}</button></div>
    <p className="quest-assignment-hint">Marque quem vai iniciar esta missão.</p>
    <div className="quest-assignment-list">
      {filteredAvailable.map((entry) => {
        const ownerId = entry.user.login;
        return <label key={entry.user.id} className={`quest-assignment-row ${selectedOwners.has(ownerId) ? 'selected' : ''}`}>
          <input type="checkbox" checked={selectedOwners.has(ownerId)} disabled={assign.isPending} onChange={() => toggleOwner(ownerId)} />
          {avatar(entry.user)}<span className="quest-assignment-name"><strong>{entry.user.name}</strong><small>@{entry.user.login}</small></span>
        </label>;
      })}
      {!filteredAvailable.length && <p className="quest-assignment-empty">{search ? 'Nenhum jogador encontrado.' : 'Nenhum jogador disponível para atribuição.'}</p>}
    </div></section>
    <section className="quest-assignment-existing" aria-label="Jogadores com a missão"><div className="quest-assignment-section-head"><h3>Já possuem <span>{assignedPlayers.length}</span></h3></div><p className="quest-assignment-hint">Jogadores que receberam esta missão.</p><div className="quest-assignment-list">{assignedPlayers.filter(matchesSearch).map(({ user }) => <div className="quest-assignment-row" key={user.id}>{avatar(user)}<span className="quest-assignment-name"><strong>{user.name}</strong><small>@{user.login}</small></span><span className="quest-assignment-badge" aria-label="Missão atribuída">✓</span></div>)}{!assignedPlayers.filter(matchesSearch).length && <p className="quest-assignment-empty">{search ? 'Nenhum jogador encontrado.' : 'Ninguém recebeu esta missão ainda.'}</p>}</div></section>
    </div>}
    {assign.isSuccess && <small className="success" role="status">Missão atribuída aos jogadores selecionados.</small>}
    {assign.error && <small className="error">{assign.error.message}</small>}
    </div>
    <div className="modal-actions"><span className="quest-assignment-count" role="status"><strong>{selectedOwners.size}</strong> selecionado{selectedOwners.size === 1 ? '' : 's'}</span><button type="button" onClick={() => setOpen(false)}>Fechar</button><button className="primary" disabled={loading || loadError || !selectedOwners.size || assign.isPending} onClick={() => assign.mutate()}>{assign.isPending ? 'Atribuindo…' : 'Confirmar atribuição'}</button></div>
  </dialog></div>;

}



function DataGrid({ data, omit = [] }) {

  const entries = Object.entries(data ?? {}).filter(

    ([key, value]) =>

      !omit.includes(key) &&

      key !== 'id' &&

      !key.toLowerCase().endsWith('id') &&

      !empty(value)

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

            ) : key === 'rarity' ? (

              <span className={rarityClass(value)}>{String(dataValueLabel(key, value))}</span>

            ) : (

              String(dataValueLabel(key, value))

            )}

          </dd>

        </React.Fragment>

      ))}

    </dl>

  );

}



const optionLabel = (options, value) => options.find((option) => option.value === value)?.label ?? value;
const rarityClass = (value) => {
  const normalized = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return ({
    incomum: 'rarity-uncommon',
    uncommon: 'rarity-uncommon',
    raro: 'rarity-rare',
    rare: 'rarity-rare',
    epico: 'rarity-mythic',
    mitico: 'rarity-mythic',
    epic: 'rarity-mythic',
    lendario: 'rarity-legendary',
    legendary: 'rarity-legendary',
    imortal: 'rarity-immortal',
    unico: 'rarity-immortal',
    unique: 'rarity-immortal'
  })[normalized] ?? '';
};

const itemCategoryFilters = [
  { value: 'all', label: 'Todos', emoji: '✦' },
  { value: 'weapon', label: 'Armas', emoji: '⚔️' },
  { value: 'armor', label: 'Armaduras', emoji: '🛡️' },
  { value: 'shield', label: 'Escudos', emoji: '🔰' },
  { value: 'ammunition', label: 'Munições', emoji: '🎯' },
  { value: 'consumable', label: 'Consumíveis', emoji: '🧪' },
  { value: 'equipment', label: 'Equipamentos', emoji: '🎒' },
  { value: 'tool', label: 'Ferramentas', emoji: '🔧' },
  { value: 'material', label: 'Materiais', emoji: '🪵' },
  { value: 'treasure', label: 'Tesouros', emoji: '💎' },
  { value: 'quest', label: 'Missões', emoji: '📜' },
  { value: 'misc', label: 'Diversos', emoji: '📦' }
];


function dataValueLabel(key, value) {

  if (key === 'requirementLogic') return optionLabel(requirementLogicOptions, value);

  if (key === 'objectiveMode' || key === 'objectivesMode') return optionLabel(objectiveModeOptions, value);

  if (key === 'type') return entityTypeLabels[value] ?? value;

  return value;

}

function formatItemValue(value) {

  if (!value || value.amount == null || value.amount === '') return undefined;

  return `${value.amount} ${value.currency ?? ''}`.trim();

}



function formatLocationFloor(entity) {

  if (!entity) return undefined;

  const floor = locationFloor(entity);

  if (floor === 'sem-andar') return undefined;

  return floorLabel(floor);

}



function NamedDescriptionCards({ values = [], emptyMessage = 'Nenhum registro visível.' }) {

  const normalized = values.map((value) =>

    typeof value === 'string'

      ? { name: value, description: '' }

      : { name: value.name ?? value.type ?? 'Registro sem nome', description: value.description ?? '' }

  );

  if (!normalized.length) return <span className="muted">{emptyMessage}</span>;

  return <div className="component-grid">{normalized.map((value, index) => <article className="component-card" key={`${value.name}:${index}`}><strong>{value.name}</strong>{value.description && <p>{value.description}</p>}</article>)}</div>;

}



export function isDropReference(reference) {

  return reference?.role === 'drops' || reference?.role === 'drop' || reference?.role === 'referenciado por · drops' || reference?.role === 'referenciado por · drop';

}



function EntityReferences({ entity, campaignId, isGm, onGrant }) {

  const references = [...(entity.references ?? []), ...(entity.backlinks ?? [])].filter((reference) => !isDropReference(reference));

  if (!references.length) return null;

  return (

    <ModuleCard title="Referências" targetKey="section.references" isGm={isGm} onGrant={onGrant}>

      <ReferenceCombobox

        references={references}

        campaignId={campaignId}

        label="Registro relacionado"

      />

    </ModuleCard>

  );

}



function MonsterDetails({ entity, campaignId, isGm, onGrant }) {

  const sheet = entity.sheet ?? {};

  const [dropRoll, setDropRoll] = useState(null);

  const [rollError, setRollError] = useState('');

  const [copyState, setCopyState] = useState('');

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

  const basicData = { nd: sheet.nd, type: sheet.type, subtype: sheet.subtype, size: sheet.size };

  const hasBasicData = hasRenderableContent(basicData);

  const monsterModules = ['combat', 'resources', 'resistances', 'attributes'];

  const equipmentReferences = (entity.references ?? []).filter((reference) => reference.type === 'item');

  const dropReferences = equipmentReferences.filter((reference) => reference.role === 'drops' || reference.role === 'drop');

  const rollDrops = async () => {

    try {

      setRollError('');

      const data = await api(`/api/v1/campaigns/${campaignId}/monsters/${encodeURIComponent(entity.id)}/drops/roll`, { method: 'POST' });

      setDropRoll(data.results ?? []);

    } catch (error) {

      setRollError(error.message || 'Não foi possível rolar os drops.');

      setDropRoll([]);

    }

  };

  const copyRollText = async () => {

    if (!dropRoll?.length) return;

    const text = dropRoll

      .map((entry) => `${entry.name ?? entry.id}${entry.chance ? ` (${entry.chance}%)` : ''}${entry.quantity != null ? ` x${entry.quantity}` : ''}`)

      .join('\n');

    try {

      await navigator.clipboard.writeText(text);

      setCopyState('Copiado');

    } catch {

      setCopyState('Não foi possível copiar automaticamente');

    }

  };

  return (

    <div className="module-stack">

      {hasBasicData && (

        <ModuleCard

          title="Informações básicas do monstro"

          isGm={isGm}

          onGrant={onGrant}

          targets={basicTargets}

        >

          <DataGrid data={basicData} />

        </ModuleCard>

      )}

      {monsterModules.map((module) => {

        const data = sheet[module];

        if (!hasRenderableContent(data)) return null;

        return (

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

            <DataGrid data={data} />

          </ModuleCard>

        );

      })}

      {componentGroups.map(([kind, title, entries = []]) => {

        const visibleEntries = entries.filter((entry) => hasRenderableContent(entry.data));

        if (!visibleEntries.length) return null;

        const bulkLabel = `Liberar campos de ${title.toLowerCase()}`;

        return (

          <ModuleCard

            key={kind}

            title={title}

            isGm={isGm}

            onGrant={onGrant}

            bulkTargets={monsterComponentTargets(entity, kind)}

            bulkLabel={bulkLabel}

          >

            <div className="component-grid">

              {visibleEntries.map((entry) => (

                <article className="component-card" key={entry.id}>

                  <div className="component-head">

                    <strong>{entry.data?.name ?? entry.data?.type ?? 'Registro sem nome'}</strong>

                    <DiscoveryButton

                      isGm={isGm}

                      onGrant={onGrant}

                      kind={`monster_${kind}`}

                      targetKey={entry.id}

                      label={entry.data?.name ?? 'Registro sem nome'}

                    />

                  </div>

                  <DataGrid data={entry.data} omit={['name']} />

                </article>

              ))}

            </div>

          </ModuleCard>

        );

      })}

      {dropReferences.length > 0 && (

        <ModuleCard

          title="Drops"

          targetKey="section.references"

          isGm={isGm}

          onGrant={onGrant}

        >

          <div className="editor-list-head" style={{ justifyContent: 'space-between', gap: '0.5rem' }}>

            <strong>Possíveis itens</strong>

            <button type="button" onClick={rollDrops}>Sortear drop</button>

          </div>

          <ReferenceCombobox

            references={dropReferences}

            campaignId={campaignId}

            label="Drop possível"

          />

          {rollError && <div className="alert error">{rollError}</div>}

        </ModuleCard>

      )}

      {equipmentReferences.length > 0 && (

        <ModuleCard

          title="Itens equipados"

          targetKey="section.references"

          isGm={isGm}

          onGrant={onGrant}

        >

          <ReferenceCombobox

            references={equipmentReferences.filter((reference) => reference.role !== 'drops' && reference.role !== 'drop')}

            campaignId={campaignId}

            label="Item"

          />

        </ModuleCard>

      )}

      {dropRoll && (

        <div className="modal-backdrop" role="presentation">

          <div className="modal" role="dialog" aria-modal="true">

            <div className="modal-head">

              <div>

                <small>ROLAGEM DE DROP</small>

                <h2>Resultado</h2>

              </div>

              <button type="button" onClick={() => { setDropRoll(null); setCopyState(''); }}>×</button>

            </div>

            <div className="modal-content">

              <pre>{dropRoll.length ? dropRoll.map((entry) => `${entry.name ?? entry.id}${entry.chance ? ` (${entry.chance}%)` : ''}${entry.quantity != null ? ` x${entry.quantity}` : ''}`).join('\n') : 'Nenhum item foi sorteado.'}</pre>

              {copyState && <p className="muted">{copyState}</p>}

            </div>

            <div className="modal-actions">

              <button type="button" onClick={() => setDropRoll(null)}>Fechar</button>

              <button type="button" className="primary" onClick={copyRollText}>Copiar</button>

            </div>

          </div>

        </div>

      )}

      <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />

    </div>

  );

}



function QuestDetails({ entity, campaignId, isGm, onGrant }) {

  const requirementsData = { requirementLogic: entity.requirementLogic, prerequisites: entity.prerequisites };

  const hasRequirementData = hasRenderableContent(requirementsData) || hasRenderableContent(entity.requirements);

  const hasFlowData = Boolean(entity.startSource || entity.completionReceiver || entity.nextQuestReferences?.length);

  const hasObjectivesData = hasRenderableContent(entity.objectives);

  const hasRewardsData = hasRenderableContent(entity.rewards);



  return (

    <div className="module-stack">

      {hasRequirementData && (

        <ModuleCard title="Requisitos" targetKey="section.requirements" isGm={isGm} onGrant={onGrant}>

          <DataGrid data={requirementsData} />

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

      )}

      {hasFlowData && (

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

          </div>

        </ModuleCard>

      )}

      {hasObjectivesData && (

        <ModuleCard title="Objetivos" isGm={false} onGrant={onGrant}>

          <div className="component-grid">

            {[...(entity.objectives ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((objective) => (

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

                    label={objective.text || 'Objetivo sem nome'}

                  />

                </div>

                <small>

                  {objectiveTypeLabels[objective.type] ?? objective.type} · {objective.requiredQuantity}x

                  {objective.optional ? ' · opcional' : ''}

                  {objective.dependsOn?.length ? ` · após ${objective.dependsOn.join(', ')}` : ''}

                </small>

                {objective.target && (

                  <ReferenceCombobox

                    references={[objective.target]}

                    campaignId={campaignId}

                    label="Alvo"

                  />

                )}

              </article>

            ))}

          </div>

        </ModuleCard>

      )}

      {hasRewardsData && (

        <ModuleCard title="Recompensas" targetKey="section.rewards" isGm={isGm} onGrant={onGrant}>

          <div className="component-grid">

            {entity.rewards?.map((reward, index) => (

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

            ))}

          </div>

        </ModuleCard>

      )}

      <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />

    </div>

  );

}



function TypeDetails({ entity, type, campaignId, isGm, onGrant }) {

  if (type === 'monster')

    return <MonsterDetails entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />;

  if (type === 'quest')

    return <QuestDetails entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />;

  if (type === 'npc') {

    const identityData = entity.identity ?? {

      race: entity.race,

      gender: entity.gender,

      age: entity.age,

      profession: entity.profession

    };

    const hasIdentityData = hasRenderableContent(identityData);

    const hasLocationData = hasRenderableContent(entity.locations ?? [

      entity.mainLocationId && { type: 'location', id: entity.mainLocationId },

      entity.currentLocationId && { type: 'location', id: entity.currentLocationId }

    ]);

    const hasRelationData = hasRenderableContent(entity.relations);

    const hasServicesData = hasRenderableContent(entity.services);

    const hasT20Data = hasRenderableContent(entity.t20);

    return (

      <div className="module-stack">

        {hasIdentityData && (

          <ModuleCard title="Identidade" targetKey="section.identity" isGm={isGm} onGrant={onGrant}>

            <DataGrid data={identityData} />

          </ModuleCard>

        )}

        {hasLocationData && (

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

        )}

        {hasRelationData && (

          <ModuleCard title="Relações" targetKey="section.relations" isGm={isGm} onGrant={onGrant}>

            <ReferenceCombobox

              references={entity.relations}

              campaignId={campaignId}

              label="NPC relacionado"

            />

          </ModuleCard>

        )}

        {hasServicesData && (

          <ModuleCard title="Serviços" targetKey="section.services" isGm={isGm} onGrant={onGrant}>

            <NamedDescriptionCards values={entity.services} emptyMessage="Nenhum serviço cadastrado." />

          </ModuleCard>

        )}

        {hasT20Data && (

          <ModuleCard title="Ficha T20" targetKey="section.t20" isGm={isGm} onGrant={onGrant}>

            <DataGrid data={entity.t20} />

          </ModuleCard>

        )}

        <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />

      </div>

    );

  }

  if (type === 'location') {

    const hasServicesData = hasRenderableContent(entity.services);

    const hasConnectionsData = hasRenderableContent(entity.connections);

    return (

      <div className="module-stack">

        {hasServicesData && (

          <ModuleCard title="Serviços" targetKey="section.services" isGm={isGm} onGrant={onGrant}>

            <NamedDescriptionCards values={entity.services} emptyMessage="Nenhum serviço cadastrado." />

          </ModuleCard>

        )}

        {hasConnectionsData && (

          <ModuleCard title="Conexões" isGm={false} onGrant={onGrant}>

            <div className="component-grid">

              {entity.connections?.length ? (

                entity.connections.map((connection) => (

                  <article className="component-card" key={connection.connectionId}>

                    <div className="component-head">

                      <strong>

                        {connection.direction || '→'} {formatEntityName(connection.target, 'Local indisponível')}

                      </strong>

                      <DiscoveryButton

                        isGm={isGm}

                        onGrant={onGrant}

                        kind="location_connection"

                        targetKey={connection.connectionId}

                        label={formatEntityName(connection.target, connection.direction ?? 'Local')}

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

        )}

        <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />

      </div>

    );

  }

  const hasStatsData = hasRenderableContent(entity.stats);

  return (

    <div className="module-stack">

      {hasStatsData && (

        <ModuleCard title="Atributos do item" targetKey="section.stats" isGm={isGm} onGrant={onGrant}>

          <div className="component-grid">

            {entity.stats?.length ? (

              entity.stats.map((stat) => (

                <article className="component-card" key={stat.key}>

                  <strong>{stat.key}</strong>

                  <p>{String(stat.value)}</p>

                  <small>{operationOptions.find((option) => option.value === stat.operation)?.label ?? 'Definir valor'}</small>

                </article>

              ))

            ) : (

              <span className="muted">Sem atributos visíveis.</span>

            )}

          </div>

        </ModuleCard>

      )}

      <EntityReferences entity={entity} campaignId={campaignId} isGm={isGm} onGrant={onGrant} />

    </div>

  );

}



function QuestPlayers({ campaignId, questId, questObjectives = [] }) {

  const viewers = useQuery({

    queryKey: ['entity-viewers', campaignId, 'quest', questId],

    queryFn: () => api(`/api/v1/campaigns/${campaignId}/discoveries/quest/${encodeURIComponent(questId)}/viewers`)

  });

  const playerIds = new Set(viewers.data?.viewers?.['entity:existence'] ?? []);

  const discoveredPlayers = (viewers.data?.users ?? []).filter(

    (user) => playerIds.has(user.id) && !['owner', 'gm', 'assistant_gm'].includes(user.role)

  );

  const progress = useQuery({

    queryKey: ['progress', campaignId, 'quest', questId],

    queryFn: () => api(`/api/v1/campaigns/${campaignId}/progress`)

  });

  const progressFor = (player) => (progress.data ?? []).find(

    (entry) => entry.questId === questId && entry.ownerType === 'player' &&

      (entry.ownerId === player.login || entry.ownerId === player.id)

  );

  const players = discoveredPlayers.filter((player) => progressFor(player));
  const currentObjectiveIds = new Set(questObjectives.map((objective) => objective.objectiveId));



  return (

    <ModuleCard title="Players com esta missão">

      {viewers.isLoading || progress.isLoading ? <p className="muted">Carregando players…</p> : viewers.isError || progress.isError ? (

        <div className="alert error">Não foi possível carregar os players. <button onClick={() => viewers.refetch()}>Tentar novamente</button></div>

      ) : players.length ? (

        <div className="component-grid">

          {players.map((player) => (

            <article className="component-card" key={player.id}>

              <div className="component-head">

                <span className="viewer-avatar" aria-hidden="true">

                  {player.characterImageUrl ? <img src={player.characterImageUrl} alt="" /> : (player.name ?? 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}

                </span>

                <strong>{player.name}</strong>

              </div>

              {progressFor(player) ? <div className="quest-player-progress">

                <strong>{progressFor(player).percentage ?? 0}% concluído</strong>

                {progressFor(player).objectives?.filter((objective) => currentObjectiveIds.has(objective.objectiveId) && objective.text !== 'Objetivo removido' && !objective.secret).map((objective) => (

                  <small key={objective.objectiveId}>{objective.text || 'Objetivo'}: {objective.value ?? 0}/{objective.requiredQuantity ?? 1}</small>

                ))}

              </div> : <small className="muted">Sem progresso iniciado</small>}

            </article>

          ))}

        </div>

      ) : <p className="muted">Nenhum player possui esta missão.</p>}

    </ModuleCard>

  );

}



function EntityDetail({ entity, type, campaignId, isGm, onEdit, onDelete, onGrant }) {

  if (!entity) return <div className="empty-detail">Selecione um registro.</div>;

  const basic =

    type === 'npc'

      ? { title: entity.title, subtitle: entity.subtitle, level: entity.level }

        : type === 'location'

          ? {

            subtitle: entity.subtitle,

            type: optionLabel(locationTypeOptions, entity.type),

            state: optionLabel(locationStateOptions, entity.state),

            levelRecommended: entity.levelRecommended ?? entity.recommendedLevel,

            ...(formatLocationFloor(entity) ? { andar: formatLocationFloor(entity) } : {})

          }

        : type === 'item'

          ? {

              subtitle: entity.subtitle,

              category: optionLabel(itemCategoryOptions, entity.category),

              rarity: optionLabel(itemRarityOptions, entity.rarity),

              value: formatItemValue(entity.value)

            }

          : type === 'monster'

            ? { subtitle: entity.subtitle, group: entity.group }

            : {

                subtitle: entity.subtitle,

                type: entity.type,

                state: entity.state,

                levelRecommended: entity.levelRecommended ?? entity.recommendedLevel

              };

  const hasBasicData = hasRenderableContent(basic);

  return (

    <article className={`detail-card detail-card-${type}`}>

      <div className="detail-heading">

        <div>

          <small>{singular[type]}</small>

          <h2 title={formatEntityName(entity)}>{formatEntityName(entity)}</h2>

        </div>

        <div className="actions">

          {isGm && <button onClick={() => onGrant(type === 'npc' ? { ...buildBulkEntityDiscoveryRequest({ type, items: [entity] }), label: 'Liberar campos', initialSelectedEntities: [`npc:${entity.id}`] } : { label: 'Liberar campos', targets: bulkTargets(entity, type), bulk: true })}>◇ Liberar campos</button>}

          <DiscoveryButton

            isGm={isGm}

            onGrant={onGrant}

            kind="entity"

            targetKey="existence"

            label={`Existência de ${formatEntityName(entity)}`}

          />

          {isGm && <button onClick={onEdit}>Editar</button>}

          {isGm && (

            <button className="danger" onClick={onDelete}>

              Excluir

            </button>

          )}

        </div>

      </div>

      <div className="chips">

        {entity.tags?.map((tag) => (

          <span key={tag}>{tag}</span>

        ))}

      </div>

      {(type === 'location' || type === 'npc' || type === 'item' || hasBasicData || entityImage(entity)) && (

        <div className={`entity-overview ${type === 'location' || type === 'npc' || type === 'item' || entityImage(entity) ? 'has-image' : ''}`}>

          {(type === 'location' || type === 'npc' || type === 'item')
            ? <LocationImage variant={type} key={`${entity.id}:${entityImage(entity)}`} src={entityImage(entity)} name={formatEntityName(entity)} onEdit={isGm ? onEdit : undefined} />
            : entityImage(entity) && <img className="entity-portrait" src={entityImage(entity)} alt={formatEntityName(entity)} />}

          {hasBasicData && (

            <ModuleCard title="Informações básicas" targetKey="section.basic" isGm={isGm} onGrant={onGrant}>

              <DataGrid data={basic} />

            </ModuleCard>

          )}

        </div>

      )}

      {type === 'quest' && isGm && <QuestAssign key={entity.id} campaignId={campaignId} questId={entity.id} questName={formatEntityName(entity)} />}

      {type === 'quest' && isGm && <QuestPlayers campaignId={campaignId} questId={entity.id} questObjectives={entity.objectives ?? []} />}

      <div className="field-grid">

        {(entity.fields ?? [])

          .filter((field) => hasRenderableContent(field.value))

          .map((field) => (

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

    </article>

  );

}



export function monsterComponentTargets(entity, kind) {

  const componentKeys = { movement: 'movements', attack: 'attacks', ability: 'abilities', skill: 'skills', trait: 'traits' };

  const collection = componentKeys[kind];

  if (!collection) return [];

  return (entity?.[collection] ?? [])

    .filter((entry) => hasRenderableContent(entry.data))

    .map((entry) => ({

      kind: `monster_${kind}`,

      key: entry.id,

      label: entry.data?.name ?? entry.data?.type ?? 'Registro sem nome'

    }));

}



function bulkTargets(entity, type) {

  if (categorizedDiscoveryTypes.includes(type)) return categorizedDiscoveryTargets(type, [entity]);

  if (type === 'quest') return questDiscoveryTargets(entity);

  const targets = [];

  for (const field of entity.fields ?? []) targets.push({ kind: 'field', key: field.key, label: fieldLabels[field.key] ?? field.key });

  for (const section of Object.keys(entity.sectionVisibility ?? {})) targets.push({ kind: 'field', key: `section.${section}`, label: sectionLabels[section] ?? fieldLabels[section] ?? section });

  if (type === 'monster') {

    for (const key of ['basic', 'nd', 'type', 'subtype', 'size', 'combat', 'resources', 'resistances', 'attributes']) targets.push({ kind: 'monster_stat', key, label: monsterStatLabels[key] });

    for (const kind of Object.keys({ movement: 'movements', attack: 'attacks', ability: 'abilities', skill: 'skills', trait: 'traits' }))

      targets.push(...monsterComponentTargets(entity, kind));

  }

  if (type === 'location') for (const connection of entity.connections ?? []) targets.push({ kind: 'location_connection', key: connection.connectionId, label: formatEntityName(connection.target, 'Local indisponível') });

  return targets.length ? targets : [{ kind: 'entity', key: 'existence', label: 'Existência do registro' }];

}



export function ReferenceBuilder({ type, text, setText }) {

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

      { value: 'reward', label: 'Recompensa' },

      { value: 'nextQuest', label: 'Próxima missão' }

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

          connectionId: crypto.randomUUID(),

          to: targetId,

          direction: '',

          distanceKm: 0,

          travelMinutes: 0,

          access: 'public',

          visibility: 'discoverable'

        }

      ];

    else if (slot === 'requirement')

      data.requirements = [...(data.requirements ?? []), { type: targetType, id: targetId }];

    else if (slot === 'reward')

      data.rewards = [...(data.rewards ?? []), { type: targetType, id: targetId, quantity: '1' }];

    else if (slot === 'nextQuest')

      data.nextQuests = [...(data.nextQuests ?? []), targetId];

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



function CharacterImagePicker({ campaignId, value, onChange, label = 'Foto do personagem' }) {

  const inputRef = useRef(null);

  const currentUrl = value?.imageURL ?? value?.imageUrl ?? '';
  const setRemoteUrl = (url) => {
    const data = { ...value, imageURL: url };
    delete data.imageUrl;
    onChange(data);
  };

  const upload = useMutation({

    mutationFn: (file) => {

      const body = new FormData();

      body.append('image', file);

      return api(`/api/v1/campaigns/${campaignId}/media`, { method: 'POST', body });

    },

    onSuccess: ({ url }) => {

      const data = { ...value, imageURL: url };

      delete data.imageUrl;

      onChange(data);

    }

  });

  return (

    <div className="character-image-picker">

      <input

        ref={inputRef}

        className="visually-hidden"

        type="file"

        aria-label={label}

        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp"

        onChange={(event) => {

          const file = event.target.files?.[0];

          if (file) upload.mutate(file);

          event.target.value = '';

        }}

      />

      <button type="button" className="character-image-trigger" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>

        {currentUrl ? <img src={currentUrl} alt={label} /> : <span>Adicionar foto</span>}

        {upload.isPending && <span className="character-image-status">Enviando...</span>}

      </button>

      <span className="muted">Clique na foto para trocar.</span>
      <label>
        Ou cole o link da imagem
        <input
          type="url"
          value={currentUrl}
          placeholder="https://…"
          onChange={(event) => setRemoteUrl(event.target.value)}
        />
      </label>

      {upload.error && <div className="alert error">{upload.error.message}</div>}

    </div>

  );

}



function FormField({ label, value = '', onChange, type = 'text', options, wide = false, step }) {

  const normalizedOptions = options && value && !options.some((option) => option.value === value)

    ? [{ value, label: String(value) }, ...options]

    : options;

  return (

    <label className={wide ? 'wide' : ''}>

      {label}

      {options ? (

        <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>

          {normalizedOptions.map((option) => (

            <option key={option.value} value={option.value}>{option.label}</option>

          ))}

        </select>

      ) : type === 'textarea' ? (

        <textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} />

      ) : (

        <input type={type} step={step} value={value ?? ''} onChange={(event) => onChange(type === 'number' ? Number(event.target.value) : event.target.value)} />

      )}

    </label>

  );

}



const visibilityOptions = [

  { value: 'public', label: 'Público' },

  { value: 'discoverable', label: 'Descobrível' },

  { value: 'gm', label: 'Somente mestre' }

];



function narrativeFields(data) {

  if (Array.isArray(data.fields)) return data.fields;

  return Object.entries(data.fields ?? {}).map(([key, field]) => ({ key, ...field }));

}



function NarrativeEditor({ data, setData, fieldKey, label }) {

  const fields = narrativeFields(data);

  const field = fields.find((entry) => entry.key === fieldKey) ?? {

    key: fieldKey,

    value: '',

    visibility: 'discoverable'

  };

  const update = (patch) => {

    const next = fields.filter((entry) => entry.key !== fieldKey);

    next.push({ ...field, ...patch });

    setData({ ...data, fields: next });

  };

  return (

    <div className="narrative-editor">

      <FormField label={label} type="textarea" value={field.value} onChange={(value) => update({ value })} />

      <FormField label="Visibilidade" value={field.visibility} options={visibilityOptions} onChange={(visibility) => update({ visibility })} />

    </div>

  );

}



function ServiceEditor({ values = [], onChange }) {

  const normalized = values.map((service) =>

    typeof service === 'string'

      ? { name: service, description: '' }

      : { name: service.name ?? service.type ?? '', description: service.description ?? '' }

  );

  const update = (index, patch) => onChange(normalized.map((service, itemIndex) => itemIndex === index ? { ...service, ...patch } : service));

  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>Serviços oferecidos</strong><button onClick={() => onChange([...normalized, { name: '', description: '' }])}>＋ Adicionar</button></div>

      {normalized.map((service, index) => (

        <div className="editor-row named-description-row" key={index}>

          <FormField label="Nome" value={service.name} onChange={(name) => update(index, { name })} />

          <FormField label="Descrição" type="textarea" value={service.description} onChange={(description) => update(index, { description })} />

          <button className="danger" onClick={() => onChange(normalized.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>

        </div>

      ))}

      {!normalized.length && <span className="muted">Nenhum serviço cadastrado.</span>}

    </div>

  );

}



function AbilityEditor({ values = [], onChange }) {

  const update = (index, patch) => onChange(values.map((ability, itemIndex) => itemIndex === index ? { ...ability, data: { ...(ability.data ?? {}), ...patch } } : ability));

  return <div className="editor-list"><div className="editor-list-head"><strong>Habilidades</strong><button onClick={() => onChange([...values, { id: crypto.randomUUID(), visibility: 'discoverable', data: { name: '', description: '' } }])}>＋ Adicionar</button></div>{values.map((ability, index) => <div className="editor-row named-description-row" key={`${ability.id}:${index}`}><FormField label="Nome" value={ability.data?.name ?? ''} onChange={(name) => update(index, { name })} /><FormField label="Descrição" type="textarea" value={ability.data?.description ?? ''} onChange={(description) => update(index, { description })} /><button className="danger" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></div>)}{!values.length && <span className="muted">Nenhuma habilidade cadastrada.</span>}</div>;

}



function ReferencePicker({ value, onChange, allowedTypes = entityTypes, label = 'Referência' }) {

  const { campaignId } = useParams();

  const currentType = allowedTypes.includes(value?.type) ? value.type : allowedTypes[0];

  const query = useQuery({

    queryKey: ['reference-options', campaignId, currentType],

    queryFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(currentType)}?pageSize=100`)

  });

  const options = query.data?.items ?? [];

  const orderedOptions = currentType === 'location' ? orderLocationTargets(options) : options;

  return (

    <div className="reference-picker">

      <label>{label}<select value={currentType} onChange={(event) => onChange({ type: event.target.value, id: '', role: value?.role ?? 'related', chance: value?.chance })}>{allowedTypes.map((type) => <option key={type} value={type}>{singular[type]}</option>)}</select></label>

      <label>Registro<select disabled={query.isLoading || query.isError} value={value?.id ?? ''} onChange={(event) => onChange({ type: currentType, id: event.target.value, role: value?.role ?? 'related', chance: value?.chance })}>

        <option value="">{query.isLoading ? 'Carregando…' : query.isError ? 'Não foi possível carregar' : 'Selecione…'}</option>

        {value?.id && !options.some((item) => item.id === value.id) && <option value={value.id} title={formatEntityName(value, 'Referência indisponível')}>{formatEntityName(value, 'Referência indisponível')}</option>}

        {orderedOptions.map((item) => {

          const itemLabel = currentType === 'location' ? formatLocationTarget(item, options) : formatEntityName(item);

          return <option key={item.id} value={item.id} title={itemLabel}>{itemLabel}</option>;

        })}

      </select></label>

    </div>

  );

}



function orderLocationTargets(items) {

  const byId = new Map(items.map((item) => [item.id, item]));

  const path = (item) => { const result = []; const seen = new Set(); let current = item; while (current && !seen.has(current.id)) { seen.add(current.id); result.unshift(current); current = byId.get(current.parentId); } return result; };

  const floor = (item) => { const value = Number(locationFloor(item, items)); return Number.isFinite(value) ? value : Infinity; };

  return [...items].sort((a, b) => floor(a) - floor(b) || path(a).map(formatEntityName).join(' / ').localeCompare(path(b).map(formatEntityName).join(' / '), 'pt-BR', { numeric: true, sensitivity: 'base' }));

}



export function formatLocationTarget(item, items = []) {

  const byId = new Map(items.map((entry) => [entry.id, entry]));

  const seen = new Set();

  let current = item;

  let region = null;

  while (current && !seen.has(current.id)) {

    if (current.type === 'region') {

      region = current;

      break;

    }

    seen.add(current.id);

    current = byId.get(current.parentId);

  }

  const name = formatEntityName(item);

  if (!region || region.id === item?.id) return name;

  return `${formatEntityName(region)} - ${name}`;

}



function ReferenceListEditor({ values = [], onChange, title = 'Referências', allowedTypes = entityTypes, role = 'related', roleOptions = referenceRoleOptions }) {

  const clean = values.filter(Boolean).map((reference) => reference.target ?? reference);

  const updateReference = (index, patch) => onChange(clean.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>{title}</strong><button onClick={() => onChange([...clean, { type: allowedTypes[0], id: '', role, chance: role === 'drops' ? 100 : undefined }])}>＋ Adicionar</button></div>

      {clean.map((reference, index) => {

        const effectiveRole = reference.role ?? role;

        const showChance = effectiveRole === 'drops' || effectiveRole === 'drop';

        const showQuantityRange = showChance && reference.type === 'item' && (reference.category === 'material' || reference.quantityMin != null || reference.quantityMax != null);

        return (

          <div className="editor-row reference-edit-row" key={`${reference.type}:${reference.id}:${index}`}>

            <ReferencePicker value={reference} allowedTypes={allowedTypes} onChange={(next) => updateReference(index, { ...next, role: reference.role ?? role, chance: reference.chance ?? next.chance, quantityMin: reference.quantityMin ?? next.quantityMin, quantityMax: reference.quantityMax ?? next.quantityMax })} />

            <label className="reference-role-field">Relação<select aria-label="Tipo de relação" value={effectiveRole} onChange={(event) => updateReference(index, { role: event.target.value, chance: reference.chance })}>{roleOptions.some((option) => option.value === effectiveRole) ? null : <option value={effectiveRole}>{referenceRoleLabel(effectiveRole)}</option>}{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>

            {showChance && (

              <label className="reference-role-field">Chance<input type="number" min="1" max="100" value={reference.chance ?? 100} onChange={(event) => {

                const nextChance = Number(event.target.value);

                updateReference(index, { chance: Number.isFinite(nextChance) ? Math.min(100, Math.max(1, nextChance)) : 100 });

              }} /></label>

            )}

            {showQuantityRange && (

              <>

                <label className="reference-role-field">Qtd. mín<input type="number" min="1" value={reference.quantityMin ?? 1} onChange={(event) => {

                  const nextValue = Number(event.target.value);

                  updateReference(index, { quantityMin: Number.isFinite(nextValue) ? Math.max(1, nextValue) : 1, quantityMax: reference.quantityMax ?? Math.max(1, nextValue) });

                }} /></label>

                <label className="reference-role-field">Qtd. máx<input type="number" min="1" value={reference.quantityMax ?? reference.quantityMin ?? 1} onChange={(event) => {

                  const nextValue = Number(event.target.value);

                  updateReference(index, { quantityMax: Number.isFinite(nextValue) ? Math.max(1, nextValue) : 1, quantityMin: reference.quantityMin ?? Math.max(1, nextValue) });

                }} /></label>

              </>

            )}

            <button className="danger" onClick={() => onChange(clean.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>

          </div>

        );

      })}

      {!clean.length && <span className="muted">Nenhuma referência cadastrada.</span>}

    </div>

  );

}



function RewardListEditor({ values = [], onChange }) {

  const rewards = values;

  const update = (index, patch) => onChange(rewards.map((reward, rewardIndex) => rewardIndex === index ? { ...reward, ...patch } : reward));

  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>Recompensas</strong><button onClick={() => onChange([...rewards, { rewardId: crypto.randomUUID(), type: 'item', id: '', quantity: 1 }])}>＋ Adicionar</button></div>

      {rewards.map((reward, index) => (

        <div className="editor-row reference-edit-row" key={`${reward.type}:${reward.id}:${index}`}>

          <FormField label="Tipo" value={reward.type} options={[...entityTypes, 'currency', 'xp', 'custom'].map(value => ({ value, label: entityTypeLabels[value] ?? ({ currency: 'Moeda', xp: 'Experiência', custom: 'Personalizada' })[value] }))} onChange={(type) => update(index, { type, id: undefined, target: undefined })} />

          {entityTypes.includes(reward.type) ? <ReferencePicker label="Recompensa" value={reward.target ?? reward} allowedTypes={[reward.type]} onChange={(next) => update(index, { id: next.id, target: next.id ? { type: next.type, id: next.id } : undefined })} /> : <FormField label="Valor" value={reward.amount ?? ''} onChange={(amount) => update(index, { amount })} />}

          {reward.type === 'currency' && <FormField label="Moeda" value={reward.currency ?? ''} onChange={(currency) => update(index, { currency })} />}

          <FormField label="Quantidade" type="number" value={reward.quantity ?? 1} onChange={(quantity) => update(index, { quantity })} />

          <button className="danger" onClick={() => onChange(rewards.filter((_, rewardIndex) => rewardIndex !== index))}>Remover</button>

        </div>

      ))}

      {!rewards.length && <span className="muted">Nenhuma recompensa cadastrada.</span>}

    </div>

  );

}



function KeyValueEditor({ title, value = {}, onChange }) {

  const entries = Object.entries(value ?? {});

  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>{title}</strong><button onClick={() => onChange({ ...value, [`campo${entries.length + 1}`]: '' })}>＋ Campo</button></div>

      {entries.map(([key, entryValue], index) => (

        <div className="editor-row key-value-row" key={`${key}:${index}`}>

          <input aria-label="Nome do campo" value={key} onChange={(event) => { const next = Object.fromEntries(entries.map(([entryKey, item], itemIndex) => [itemIndex === index ? event.target.value : entryKey, item])); onChange(next); }} />

          <input aria-label="Valor do campo" value={typeof entryValue === 'object' ? JSON.stringify(entryValue) : entryValue ?? ''} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />

          <button className="danger" onClick={() => onChange(Object.fromEntries(entries.filter((_, itemIndex) => itemIndex !== index)))}>Remover</button>

        </div>

      ))}

    </div>

  );

}



function MonsterComponentEditor({ title, values = [], onChange }) {

  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>{title}</strong><button onClick={() => onChange([...values, { id: crypto.randomUUID(), visibility: 'discoverable', data: { name: '' } }])}>＋ Adicionar</button></div>

      {values.map((entry, index) => (

        <article className="component-editor" key={`${entry.id}:${index}`}>

          <div className="form-grid">

            <FormField label="Nome" value={entry.data?.name ?? ''} onChange={(name) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, data: { ...item.data, name } } : item))} />

            <FormField label="Visibilidade" value={entry.visibility ?? 'discoverable'} options={visibilityOptions} onChange={(visibility) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, visibility } : item))} />

          </div>

          <KeyValueEditor title="Detalhes" value={Object.fromEntries(Object.entries(entry.data ?? {}).filter(([key]) => key !== 'name'))} onChange={(details) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, data: { name: item.data?.name ?? '', ...details } } : item))} />

          <button className="danger" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>Remover {title.toLowerCase()}</button>

        </article>

      ))}

    </div>

  );

}



function QuestObjectiveEditor({ data, setData }) {

  const objectives = data.objectives ?? [];

  const nextObjectiveId = () => crypto.randomUUID();

  const update = (index, patch) => setData({ ...data, objectives: objectives.map((objective, itemIndex) => itemIndex === index ? { ...objective, ...patch } : objective) });

  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>Objetivos</strong><button type="button" onClick={() => setData({ ...data, objectives: [...objectives, { objectiveId: nextObjectiveId(), type: 'talk', text: '', order: objectives.length + 1, requiredQuantity: 1, optional: false, secret: false, visibility: 'discoverable', dependsOn: [], playerEditable: false }] })}>＋ Objetivo</button></div>

      {objectives.map((objective, index) => (

        <article className="component-editor" key={`${objective.objectiveId}:${index}`}>

          <div className="form-grid">

            <FormField label="Tipo" value={objective.type} options={Object.entries(objectiveTypeLabels).map(([value, label]) => ({ value, label }))} onChange={(type) => update(index, { type })} />

            <FormField label="Quantidade" type="number" value={objective.requiredQuantity ?? 1} onChange={(requiredQuantity) => update(index, { requiredQuantity: Math.max(1, requiredQuantity || 1) })} />

            <FormField label="Descrição" wide value={objective.text} onChange={(text) => update(index, { text })} />

            <FormField label="Visibilidade" value={objective.visibility ?? 'discoverable'} options={visibilityOptions} onChange={(visibility) => update(index, { visibility })} />

            <label>Depende de<select multiple value={objective.dependsOn ?? []} onChange={(event) => update(index, { dependsOn: [...event.target.selectedOptions].map((option) => option.value) })}>{objectives.filter((_, itemIndex) => itemIndex !== index).map((item) => <option key={item.objectiveId} value={item.objectiveId}>{item.order}. {item.text || item.objectiveId}</option>)}</select></label>

            <label className="check-field"><input type="checkbox" checked={Boolean(objective.optional)} onChange={(event) => update(index, { optional: event.target.checked })} /> Opcional</label>

            <label className="check-field"><input type="checkbox" checked={Boolean(objective.secret)} onChange={(event) => update(index, { secret: event.target.checked })} /> Secreto</label>

            <label className="check-field"><input type="checkbox" checked={Boolean(objective.playerEditable)} onChange={(event) => update(index, { playerEditable: event.target.checked })} /> Jogador pode atualizar</label>

          </div>

          <ReferencePicker label="Alvo do objetivo" value={objective.target} onChange={(target) => update(index, { target })} />

          <button className="danger" onClick={() => setData({ ...data, objectives: objectives.filter((_, itemIndex) => itemIndex !== index).map((item, order) => ({ ...item, order: order + 1 })) })}>Remover objetivo</button>

        </article>

      ))}

    </div>

  );

}



function LocationRegionPicker({ campaignId, data, onChange, currentId }) {

  const locations = useQuery({ queryKey: ['reference-options', campaignId, 'location'], queryFn: () => api(`/api/v1/campaigns/${campaignId}/locations?pageSize=100`) });

  const items = locations.data?.items ?? [];

  const excluded = new Set([currentId, ...resolveLocationMenuEntries({ items, selectedRegion: currentId }).map(item => item.id)]);

  const parents = items.filter(item => !excluded.has(item.id));

  return <>

    <FormField label="Andar" value={data.placement?.floor ?? ''} onChange={floor => onChange({ ...data, placement: floor === '' ? {} : { floor } })} />

    <label>Local pai<select value={data.parentId ?? ''} disabled={locations.isLoading} onChange={event => onChange({ ...data, parentId: event.target.value || undefined })}>

      <option value="">Raiz</option>

      {parents.map(parent => <option key={parent.id} value={parent.id}>{formatEntityName(parent)}</option>)}

    </select></label>

  </>;

}



function LocationConnectionEditor({ data, setData }) {

  const connections = data.connections ?? [];

  const update = (index, patch) => setData({

    ...data,

    connections: connections.map((connection, itemIndex) => itemIndex === index ? { ...connection, ...patch } : connection)

  });

  const add = () => setData({

    ...data,

    connections: [...connections, {

      connectionId: crypto.randomUUID(),

      targetId: '',

      direction: '',

      distanceKm: 0,

      travelMinutes: 0,

      access: 'public',

      visibility: 'discoverable'

    }]

  });



  return (

    <div className="editor-list">

      <div className="editor-list-head"><strong>Locais conectados</strong><button type="button" onClick={add}>＋ Conexão</button></div>

      {connections.map((connection, index) => (

        <article className="component-editor" key={connection.connectionId ?? index}>

          <div className="form-grid">

            <FormField label="Direção" value={connection.direction ?? ''} onChange={(direction) => update(index, { direction })} />

            <FormField label="Distância (km)" type="number" value={connection.distanceKm ?? 0} onChange={(distanceKm) => update(index, { distanceKm: Math.max(0, distanceKm || 0) })} />

            <FormField label="Tempo (min)" type="number" value={connection.travelMinutes ?? 0} onChange={(travelMinutes) => update(index, { travelMinutes: Math.max(0, travelMinutes || 0) })} />

            <FormField label="Acesso" value={connection.access ?? 'public'} options={[{ value: 'public', label: 'Público' }, { value: 'discoverable', label: 'Descobrível' }, { value: 'hidden', label: 'Oculto' }, { value: 'conditional', label: 'Condicional' }, { value: 'blocked', label: 'Bloqueado' }]} onChange={(access) => update(index, { access })} />

            <FormField label="Visibilidade" value={connection.visibility ?? 'discoverable'} options={visibilityOptions} onChange={(visibility) => update(index, { visibility })} />

          </div>

          <ReferencePicker label="Local conectado" value={{ type: 'location', id: connection.targetId ?? connection.to ?? '', role: 'connection' }} allowedTypes={['location']} onChange={(target) => update(index, { targetId: target.id, to: undefined })} />

          <button className="danger" type="button" onClick={() => setData({ ...data, connections: connections.filter((_, itemIndex) => itemIndex !== index) })}>Remover conexão</button>

        </article>

      ))}

      {!connections.length && <span className="muted">Nenhuma conexão cadastrada.</span>}

    </div>

  );

}



function EntityStructuredEditor({ type, data, setData, activeTab, setActiveTab, isNew, campaignId, locationImage, onLocationImageChange }) {

  const commonTabs = [{ id: 'general', label: 'Geral' }];

  const tabsByType = {

    npc: [...commonTabs, { id: 'description', label: 'Descrição' }, { id: 't20', label: 'T20' }, { id: 'services', label: 'Serviços' }, { id: 'locations', label: 'Locais' }, { id: 'relations', label: 'Relações' }, { id: 'references', label: 'Referências' }],

    location: [...commonTabs, { id: 'description', label: 'Descrição' }, { id: 'environment', label: 'Ambiente' }, { id: 'history', label: 'História' }, { id: 'services', label: 'Serviços' }, { id: 'connections', label: 'Conexões' }, { id: 'references', label: 'Referências' }],

    item: [...commonTabs, { id: 'description', label: 'Descrição' }, { id: 'references', label: 'Referências' }],

    monster: [...commonTabs, { id: 'description', label: 'Descrição' }, { id: 'sheet', label: 'Ficha' }, { id: 'movements', label: 'Deslocamentos' }, { id: 'attacks', label: 'Ataques' }, { id: 'abilities', label: 'Habilidades' }, { id: 'skills', label: 'Perícias' }, { id: 'traits', label: 'Características' }, { id: 'drops', label: 'Drops' }, { id: 'references', label: 'Referências' }],

    quest: [...commonTabs, { id: 'description', label: 'Descrição' }, { id: 'objectives', label: 'Objetivos' }, { id: 'flow', label: 'Fluxo' }, { id: 'requirements', label: 'Requisitos' }, { id: 'rewards', label: 'Recompensas' }]

  };

  const tabs = tabsByType[type];

  const set = (key, value) => setData({ ...data, [key]: value });

  const identity = data.identity ?? { race: data.race ?? '', gender: data.gender ?? '', age: data.age ?? '', profession: data.profession ?? '' };

  return (

    <>

      <div className="editor-tabs" role="tablist">{tabs.map((tab) => <button role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div>

      <div className="structured-editor-panel">

        {activeTab === 'general' && <div className="form-grid">

          {(type === 'npc' || type === 'monster' || type === 'item') && <CharacterImagePicker campaignId={campaignId} value={data} onChange={setData} label={type === 'monster' ? 'Imagem do monstro' : type === 'item' ? 'Imagem do item' : 'Foto do personagem'} />}

          <FormField label="Nome" value={data.name} onChange={(value) => setData({ ...data, name: value, ...(autoIdTypes.has(type) && isNew ? { id: idFromName(type, value) } : {}) })} />

          <FormField label="Tags (separadas por vírgula)" value={(data.tags ?? []).join(', ')} onChange={(value) => set('tags', value.split(',').map((tag) => tag.trim()).filter(Boolean))} />

          {type !== 'npc' && <FormField label="Subtítulo" value={data.subtitle ?? ''} onChange={(value) => set('subtitle', value)} />}

          {type === 'npc' && <><FormField label="Título" value={data.title} onChange={(value) => set('title', value)} /><FormField label="Subtítulo" value={data.subtitle ?? ''} onChange={(value) => set('subtitle', value)} /><FormField label="Nível" value={data.level} onChange={(value) => set('level', value)} />{Object.entries({ race: 'Raça', gender: 'Gênero', age: 'Idade', profession: 'Profissão' }).map(([key, label]) => <FormField key={key} label={label} value={identity[key]} onChange={(value) => set('identity', { ...identity, [key]: value })} />)}</>}

          {type === 'location' && <><LocationRegionPicker campaignId={campaignId} data={data} onChange={setData} currentId={data.id} /><FormField label="Tipo" value={data.type} options={locationTypeOptions} onChange={(value) => set('type', value)} /><FormField label="Estado" value={data.state} options={locationStateOptions} onChange={(value) => set('state', value)} /><FormField label="Nível recomendado" value={data.recommendedLevel} onChange={(value) => set('recommendedLevel', value)} /></>}

          {type === 'location' && <LocationImagePicker selection={locationImage} onChange={onLocationImageChange} />}

          {type === 'item' && <><FormField label="Categoria" value={data.category} options={itemCategoryOptions} onChange={(value) => set('category', value)} /><FormField label="Raridade" value={data.rarity} options={itemRarityOptions} onChange={(value) => set('rarity', value)} /><FormField label="Valor (T$)" type="number" step="10" value={data.value?.amount ?? 0} onChange={(amount) => set('value', { ...(data.value ?? {}), amount, currency: 'T$' })} /></>}

          {type === 'monster' && <FormField label="Grupo" value={data.group} onChange={(value) => set('group', value)} />}

          {type === 'quest' && <><FormField label="Subtítulo" value={data.subtitle} onChange={(value) => set('subtitle', value)} /><FormField label="Tipo" value={data.type} options={questTypeOptions} onChange={(value) => set('type', value)} /><FormField label="Estado" value={data.state} options={questStateOptions} onChange={(value) => set('state', value)} /><FormField label="Nível recomendado" value={data.recommendedLevel} onChange={(value) => set('recommendedLevel', value)} /><FormField label="Critério dos requisitos" value={data.requirementLogic ?? 'all'} options={requirementLogicOptions} onChange={(value) => set('requirementLogic', value)} /><FormField label="Ordem dos objetivos" value={data.objectiveMode ?? 'free'} options={objectiveModeOptions} onChange={(value) => set('objectiveMode', value)} /></>}

        </div>}

        {activeTab === 'description' && <NarrativeEditor data={data} setData={setData} fieldKey="description" label="Descrição" />}

        {activeTab === 'environment' && <NarrativeEditor data={data} setData={setData} fieldKey="environment" label="Ambiente" />}

        {activeTab === 'history' && <NarrativeEditor data={data} setData={setData} fieldKey="history" label="História" />}

        {activeTab === 't20' && <div className="form-grid"><FormField label="Modo" value={data.t20?.mode ?? 'none'} options={[{ value: 'none', label: 'Nenhum' }, { value: 'embedded', label: 'Incorporado' }, { value: 'linked', label: 'Vinculado' }]} onChange={(mode) => set('t20', { ...(data.t20 ?? {}), mode })} /></div>}

        {activeTab === 'services' && <ServiceEditor values={data.services} onChange={(value) => set('services', value)} />}

        {activeTab === 'locations' && <ReferenceListEditor title="Locais do personagem" values={data.locations} allowedTypes={['location']} role="visited" onChange={(value) => set('locations', value)} />}

        {activeTab === 'relations' && <ReferenceListEditor title="Relações do personagem" values={data.relations} allowedTypes={entityTypes} role="related" onChange={(value) => set('relations', value)} />}

        {activeTab === 'references' && <ReferenceListEditor values={(data.references ?? []).filter((reference) => !isDropReference(reference))} onChange={(value) => set('references', [...(data.references ?? []).filter(isDropReference), ...value])} />}

        {activeTab === 'sheet' && <div className="sheet-editor"><div className="form-grid"><FormField label="ND" value={data.sheet?.nd ?? ''} onChange={(value) => set('sheet', { ...(data.sheet ?? {}), nd: value })} /><FormField label="Tipo" value={data.sheet?.type ?? ''} options={monsterTypeOptions} onChange={(value) => set('sheet', { ...(data.sheet ?? {}), type: value })} /><FormField label="Subtipo" value={data.sheet?.subtype ?? ''} options={[{ value: 'none', label: 'Nenhum' }, { value: 'goblinoid', label: 'Goblinóide' }, { value: 'dragon', label: 'Dragão' }, { value: 'elemental', label: 'Elemental' }, { value: 'other', label: 'Outro' }]} onChange={(value) => set('sheet', { ...(data.sheet ?? {}), subtype: value })} /><FormField label="Tamanho" value={data.sheet?.size ?? ''} options={monsterSizeOptions} onChange={(value) => set('sheet', { ...(data.sheet ?? {}), size: value })} /></div>{['combat', 'resources', 'resistances', 'attributes'].map((key) => <KeyValueEditor key={key} title={{ combat: 'Combate', resources: 'Recursos', resistances: 'Resistências', attributes: 'Atributos' }[key]} value={data.sheet?.[key]} onChange={(value) => set('sheet', { ...(data.sheet ?? {}), [key]: value })} />)}</div>}

        {activeTab === 'abilities' && <AbilityEditor values={data.abilities} onChange={(value) => set('abilities', value)} />}

        {['movements', 'attacks', 'skills', 'traits'].includes(activeTab) && <MonsterComponentEditor title={tabs.find((tab) => tab.id === activeTab)?.label} values={data[activeTab]} onChange={(value) => set(activeTab, value)} />}

        {activeTab === 'drops' && (

          <ReferenceListEditor

            title="Drops do monstro"

            values={(data.references ?? []).filter((reference) => reference.type === 'item' && (reference.role === 'drops' || reference.role === 'drop'))}

            allowedTypes={['item']}

            role="drops"

            roleOptions={[{ value: 'drops', label: 'Drop' }]}

            onChange={(values) => {

              const otherReferences = (data.references ?? []).filter((reference) => !(reference.type === 'item' && (reference.role === 'drops' || reference.role === 'drop')));

              set('references', [...otherReferences, ...values.map((reference) => ({ ...reference, type: 'item', role: 'drops', chance: reference.chance ?? 100, quantityMin: reference.quantityMin, quantityMax: reference.quantityMax }))]);

            }}

          />

        )}

        {activeTab === 'objectives' && <QuestObjectiveEditor data={data} setData={setData} />}

        {activeTab === 'flow' && <div className="editor-list"><ReferencePicker label="Início da missão" value={data.startSource} onChange={(value) => set('startSource', { ...value, role: 'start' })} /><ReferencePicker label="Entrega da missão" value={data.completionReceiver} onChange={(value) => set('completionReceiver', { ...value, role: 'completion' })} /><ReferenceListEditor title="Próximas missões" values={(data.nextQuests ?? []).map((id) => ({ type: 'quest', id, role: 'next' }))} allowedTypes={['quest']} role="next" onChange={(values) => set('nextQuests', values.filter((value) => value.id).map((value) => value.id))} /><ReferenceListEditor title="Referências gerais" values={(data.references ?? []).filter((reference) => !isDropReference(reference))} onChange={(value) => set('references', [...(data.references ?? []).filter(isDropReference), ...value.filter((reference) => reference.id)])} /></div>}

        {activeTab === 'connections' && <LocationConnectionEditor data={data} setData={setData} />}

        {activeTab === 'requirements' && <ReferenceListEditor title="Requisitos vinculados" values={data.requirements} role="requirement" onChange={(values) => set('requirements', values.filter((value) => value.id).map(({ type: targetType, id }) => ({ type: targetType, id })))} />}

        {activeTab === 'rewards' && <RewardListEditor values={data.rewards} onChange={(values) => set('rewards', values)} />}

      </div>

    </>

  );

}



function EntityEditor({ type, initial, version, onClose, onSaved, campaignId }) {

  const [draft, setDraft] = useState(() => {
    const data = createEntityDraft(type, initial);
    return version ? data : discoverableCreation(type, data);
  });
  const [locationImage, setLocationImage] = useState(() => ({ file: null, url: draft.media?.image ?? '' }));
  const uploadedImage = useRef(null);
  const savingRef = useRef(false);
  const [savePhase, setSavePhase] = useState('');

  const data = draftControls(type, draft);

  const setData = (value) => setDraft(updateEntityDraft(type, typeof value === 'function' ? value(data) : value));

  const [activeTab, setActiveTab] = useState('general');

  const [error, setError] = useState('');

  const save = useMutation({

    mutationFn: async () => {

      setError('');
      setSavePhase('Salvando…');
      if (type === 'location' && locationImageUrlError(locationImage.url)) {
        setActiveTab('general');
        throw new Error('Confira o link da imagem na aba Geral.');
      }
      const payload = prepareCanonicalPayload(type, type === 'location'
        ? { ...draft, media: { ...draft.media, image: locationImage.url.trim() } }
        : draft);

      if (autoIdTypes.has(type) && !version) payload.id = idFromName(type, payload.name);

      if (!payload.name) throw new Error('O nome é obrigatório.');

      if (!payload.id.startsWith(idPrefixes[type]) || payload.id === idPrefixes[type])

        throw new Error('Informe um nome válido.');

      if (type === 'location' && locationImage.file) {
        if (uploadedImage.current?.file !== locationImage.file) {
          setSavePhase('Enviando imagem…');
          const body = new FormData();
          body.append('image', locationImage.file);
          const { url } = await api(`/api/v1/campaigns/${campaignId}/media`, { method: 'POST', body });
          uploadedImage.current = { file: locationImage.file, url };
        }
        payload.media.image = uploadedImage.current.url;
        setSavePhase('Salvando…');
      }

      const endpoint = `/api/v1/campaigns/${campaignId}/${plural(type)}${version ? `/${encodeURIComponent(initial.id)}` : ''}`;

      return api(endpoint, {

        method: version ? 'PUT' : 'POST',

        headers: version ? { 'if-match': String(version) } : {},

        body: version ? payload : discoverableCreation(type, payload)

      });

    },

    onSuccess: onSaved,

    onError: (err) => setError(err.message),
    onSettled: () => { savingRef.current = false; setSavePhase(''); }

  });

  return (

    <div className="modal-backdrop" role="presentation">

      <div className="modal entity-editor" role="dialog" aria-modal="true">

        <div className="modal-head">

          <div>

            <small>REGISTRO DO SISTEMA</small>

            <h2>{version ? `Editar ${singular[type].toLowerCase()}` : `Novo ${singular[type].toLowerCase()}`}</h2>

          </div>

          <button onClick={onClose} disabled={save.isPending} aria-label="Fechar editor">×</button>

        </div>

        <div className="modal-content">

          <p className="muted">Preencha as informações pelos menus.</p>

          <fieldset className="entity-editor-fields" disabled={save.isPending}>
            <EntityStructuredEditor type={type} data={data} setData={setData} activeTab={activeTab} setActiveTab={setActiveTab} isNew={!version} campaignId={campaignId} locationImage={locationImage} onLocationImageChange={(selection) => {
              uploadedImage.current = null;
              setLocationImage(selection);
            }} />
          </fieldset>

          {error && <div className="alert error">{error}</div>}

          {save.isPending && <span className="visually-hidden" role="status">{savePhase}</span>}

        </div>

        <div className="modal-actions">

          <button onClick={onClose} disabled={save.isPending}>Cancelar</button>

          <button className="primary" onClick={() => {
            if (savingRef.current) return;
            savingRef.current = true;
            save.mutate();
          }} disabled={save.isPending}>

            {save.isPending ? savePhase || 'Salvando…' : 'Salvar'}

          </button>

        </div>

      </div>

    </div>

  );

}



function locationRegionName(item, items) {

  const byId = new Map(items.map((location) => [location.id, location]));

  const seen = new Set();

  let current = item;

  while (current && !seen.has(current.id)) {

    if (current.type === 'region') return current.name;

    seen.add(current.id);

    current = byId.get(current.parentId);

  }

  return '';

}



function locationBreadcrumbLabel(item, items) {

  const floor = floorLabel(locationFloor(item, items));

  const region = locationRegionName(item, items);

  if (item.type === 'region') return region ? `${floor} - ${region}` : `${floor} - ${item.name}`;

  return region ? `${floor} - ${region} - ${item.name}` : `${floor} - ${item.name}`;

}



function BulkDeleteModal({ items, type, isPending, error, onConfirm, onClose }) {

  const isLocation = type === 'location';

  const orderedItems = useMemo(() => {

    if (!isLocation) return items;

    return [...items].sort((a, b) =>

      locationBreadcrumbLabel(a, items).localeCompare(locationBreadcrumbLabel(b, items), 'pt-BR')

    );

  }, [items, isLocation]);

  const [selected, setSelected] = useState(() => new Set(items.map((item) => item.id)));

  const toggle = (id) =>

    setSelected((current) => {

      const next = new Set(current);

      next.has(id) ? next.delete(id) : next.add(id);

      return next;

    });

  const selectAll = () => setSelected(new Set(items.map((item) => item.id)));

  const clearAll = () => setSelected(new Set());

  return (

    <div className="modal-backdrop">

      <div className="modal discovery-modal" role="dialog" aria-modal="true">

        <div className="modal-head">

          <div>

            <small>EXCLUSÃO EM MASSA</small>

            <h2>Excluir registros</h2>

          </div>

          <button onClick={onClose}>×</button>

        </div>

        <div className="modal-content">

          <p>Selecione os registros que serão excluídos permanentemente.</p>

          <div className="bulk-target-picker">

            <div className="bulk-picker-head">

              <strong>Registros</strong>

              <div className="bulk-picker-actions">

                <button onClick={selectAll}>Selecionar tudo</button>

                <button onClick={clearAll}>Desselecionar tudo</button>

              </div>

            </div>

            {orderedItems.map((item) => {

              const label = isLocation ? locationBreadcrumbLabel(item, items) : formatEntityName(item);

              return (

                <label key={item.id} className={selected.has(item.id) ? 'selected' : ''}>

                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />

                  <span title={label}>{label}</span>

                </label>

              );

            })}

            {!items.length && <div className="empty-list">Nenhum registro disponível.</div>}

          </div>

          {error && <div className="alert error">{error.message}</div>}

        </div>

        <div className="modal-actions">

          <span className="muted">{selected.size} registro(s) selecionado(s)</span>

          <button onClick={onClose}>Cancelar</button>

          <button

            className="danger"

            disabled={!selected.size || isPending}

            onClick={() => {

              if (window.confirm(`Excluir ${selected.size} registro(s)? Esta ação não pode ser desfeita.`)) {

                onConfirm([...selected]);

              }

            }}

          >

            {isPending ? 'Excluindo…' : 'Excluir selecionados'}

          </button>

        </div>

      </div>

    </div>

  );

}



function DiscoveryModal({ request, campaignId, entityType, entityId, locations = [], onClose }) {

  const queryClient = useQueryClient();

  const [regionId, setRegionId] = useState(request.initialRegionId ?? '');
  const hasRegionFilter = entityType === 'monster' && Boolean(request.entities?.length);
  const regions = hasRegionFilter ? resolveLocationMenuRegions({ items: locations }) : [];

  const targets = request.entities?.length
    ? [
      ...(request.categories ?? request.targets ?? baseDiscoveryTargets),
      ...(entityType === 'npc' ? npcDiscoveryTargets(request.entities).filter((target) => !(request.targets ?? []).some((item) => discoveryTargetKey(item) === discoveryTargetKey(target))) : []),
      ...request.entities.flatMap((entry) => (entry.objectives ?? []).map((objective) => ({
        kind: 'objective',

        key: objective.objectiveId,

        label: objective.text || objective.objectiveId

      })))

    ]

    : (request.categories?.length ? request.categories : (request.targets?.length ? request.targets : [{ kind: 'entity', key: 'existence', label: 'Existência do registro' }]));

  const entities = request.entities?.length

    ? hasRegionFilter ? filterMonstersByLocation({ monsters: request.entities, locations, regionId }) : request.entities

    : [{ entityType, entityId, name: request.label ?? 'Registro' }];

  const [selected, setSelected] = useState(new Set());

  const [selectedEntities, setSelectedEntities] = useState(() => new Set(request.initialSelectedEntities ?? []));
  const requiredTargetKeys = new Set(['entity:existence', 'field:section.basic', 'field:imageURL']);
  const optionalTargets = availableDiscoveryTargets(targets.filter((target) => !requiredTargetKeys.has(discoveryTargetKey(target))), entities, selectedEntities, entityType, entityId);
  const displayTargets = groupDiscoveryTargetsForDisplay(optionalTargets);
  const [selectedTargets, setSelectedTargets] = useState(() => new Set(

    request.bulk
      ? targets.filter((target) => requiredTargetKeys.has(`${target.kind}:${target.key}`)).map((target) => `${target.kind}:${target.key}`)
      : targets.map((target) => `${target.kind}:${target.key}`)

  ));

  const [allowance, setAllowance] = useState('allow');

  const memberships = useQuery({

    queryKey: ['memberships', campaignId],

    queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`)

  });

  const players = (memberships.data ?? []).filter(

    (entry) => !['owner', 'gm', 'assistant_gm'].includes(entry.role)

  );

  const resolvedSelectedTargets = new Set(selectedTargets);

  const resolvedSelectedEntities = new Set(selectedEntities);

  const grantsToSend = buildDiscoveryGrantBatch({

    request: { ...request, targets },

    selected,

    selectedEntities: resolvedSelectedEntities,

    selectedTargets: resolvedSelectedTargets,

    allowance,

    entityType,

    entityId,

    entities

  });

  const exceedsBatchLimit = grantsToSend.length > 500;
  const grantBatches = chunkDiscoveryGrants(grantsToSend);

  const canConfirm = canConfirmDiscoveryGrant({

    selected,

    selectedTargets: resolvedSelectedTargets,

    selectedEntities: resolvedSelectedEntities,

    requireSelectedEntities: Boolean(request.entities?.length)

  });

  const save = useMutation({

    mutationFn: async () => {
      for (const grants of grantBatches) {
        await api(`/api/v1/campaigns/${campaignId}/discoveries/batch`, {
          method: 'POST',
          body: { grants }
        });
      }
    },

    onSuccess: async () => {

      const entityKeys = [...selectedEntities];

      await queryClient.invalidateQueries({ queryKey: ['discoveries', campaignId] });

      for (const entityKey of entityKeys) {

        const entry = entities.find((item) => `${item.entityType ?? entityType}:${item.entityId ?? entityId}` === entityKey);

        if (!entry) continue;

        await queryClient.invalidateQueries({

          queryKey: ['entity-viewers', campaignId, entry.entityType ?? entityType, entry.entityId ?? entityId]

        });

        await queryClient.invalidateQueries({

          queryKey: ['entity', campaignId, entry.entityType ?? entityType, entry.entityId ?? entityId]

        });

        if (typeof window !== 'undefined') {

          window.localStorage.setItem(

            `sao-entity-granted:${campaignId}:${entry.entityType ?? entityType}:${entry.entityId ?? entityId}`,

            String(Date.now())

          );

        }

      }

      onClose();

    }

  });

  const toggle = (id) =>

    setSelected((current) => {

      const next = new Set(current);

      next.has(id) ? next.delete(id) : next.add(id);

      return next;

    });

  const toggleTarget = (target) => setSelectedTargets((current) => {
    const targetsToToggle = target.kind === 'group' ? [target, ...(target.children ?? target.targets ?? [])] : [target];
    const keys = targetsToToggle.map((item) => discoveryTargetKey(item));
    const next = new Set(current);
    const allSelected = keys.every((key) => next.has(key));
    for (const key of keys) allSelected ? next.delete(key) : next.add(key);

    return next;

  });

  const discoveryEntityKey = (entry) => `${entry.entityType ?? entityType}:${entry.entityId ?? entry.id ?? entityId}`;

  const toggleEntity = (entry) => setSelectedEntities((current) => {

    const key = discoveryEntityKey(entry);

    const next = new Set(current);

    next.has(key) ? next.delete(key) : next.add(key);

    return next;

  });

  const toggleLocationBranch = (entry) => setSelectedEntities((current) => {
    const branchEntries = locationBranchEntries(entities, entry);
    const keys = branchEntries.map(discoveryEntityKey);
    const next = new Set(current);
    const allSelected = keys.length > 0 && keys.every((key) => next.has(key));
    for (const key of keys) allSelected ? next.delete(key) : next.add(key);
    return next;
  });

  const selectAll = () => {

    const allTargets = new Set(targets.map((target) => `${target.kind}:${target.key}`));

    setSelectedTargets(allTargets);

    if (request.entities?.length) {

      setSelectedEntities(new Set(entities.map((entry) => `${entry.entityType ?? entityType}:${entry.entityId ?? entityId}`)));

    }

  };

  const clearAll = () => {

    if (request.entities?.length) setSelectedEntities(new Set());

    else setSelectedTargets(new Set());

  };

  const toggleAllPlayers = () => setSelected((current) => current.size === players.length ? new Set() : new Set(players.map((entry) => entry.user.id)));

  const toggleAllEntities = () => setSelectedEntities((current) => current.size === entities.length ? new Set() : new Set(entities.map((entry) => `${entry.entityType ?? entityType}:${entry.entityId ?? entityId}`)));

  const toggleAllTargets = () => setSelectedTargets((current) => {

    const optional = targets.filter((target) => !requiredTargetKeys.has(`${target.kind}:${target.key}`));

    const optionalKeys = optional.map((target) => `${target.kind}:${target.key}`);

    return optional.length && optionalKeys.every((key) => current.has(key))

      ? new Set([...requiredTargetKeys].filter((key) => targets.some((target) => `${target.kind}:${target.key}` === key)))

      : new Set([...requiredTargetKeys].filter((key) => targets.some((target) => `${target.kind}:${target.key}` === key)).concat(optionalKeys));

  });

  return (

    <div className="modal-backdrop">

      <div className={`modal discovery-modal${entityType === 'npc' && request.bulk ? ' npc-discovery-modal' : ''}`} role="dialog" aria-modal="true">

        <div className="modal-head">

          <div>

            <small>PERMISSÃO MODULAR</small>

            <h2>{request.label}</h2>

          </div>

          <button onClick={onClose}>×</button>

        </div>

        <div className="modal-content">

        <p>Selecione os jogadores que receberão esta permissão.</p>

        {request.bulk && (
          <div className="bulk-picker-columns">
          <div className="bulk-target-picker">
            <div className="bulk-picker-head">

              <strong>{labels[entityType] ?? 'Registros'} para liberar</strong>

              <button disabled={!entities.length} onClick={toggleAllEntities}>{entities.length > 0 && selectedEntities.size === entities.length ? 'Desselecionar todos' : 'Selecionar todos'}</button>

            </div>

            {hasRegionFilter && <div className="bulk-region-filter">
              <label>Região
                <select value={regionId} onChange={(event) => {
                  const nextRegionId = event.target.value;
                  const nextEntities = hasRegionFilter
                    ? filterMonstersByLocation({ monsters: request.entities, locations, regionId: nextRegionId })
                    : [];
                  setRegionId(nextRegionId);
                  const first = nextEntities[0];
                  setSelectedEntities(first ? new Set([`${first.entityType ?? entityType}:${first.entityId ?? first.id ?? entityId}`]) : new Set());
                }}>
                  <option value="">Todas as regiões</option>
                  {regions.map((region) => <option key={region.id} value={region.id}>{formatEntityName(region)}</option>)}
                </select>
              </label>
              <small className="muted">Ao trocar a região, selecione novamente os monstros.</small>
            </div>}
            {hasRegionFilter && !entities.length && <div className="empty-list">Nenhum monstro nesta região.</div>}
            {(entityType === 'location' ? locationDiscoveryRows(entities) : entities.map((entry) => ({ entry }))).map((row) => {
              const { entry } = row;
              if (!entry) return <div key={row.key} className={`discovery-location-heading ${row.kind}`} style={{ paddingLeft: `${row.depth * 16 + 4}px` }}>{row.label}</div>;
              const entityName = row.label ?? formatEntityName(entry, entry.entityId ?? 'Registro sem nome');
              return (
                <label key={discoveryEntityKey(entry)} style={row.depth != null ? { marginLeft: `${row.depth * 16}px` } : undefined} className={`discovery-location-row ${row.kind ?? ''} ${selectedEntities.has(discoveryEntityKey(entry)) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedEntities.has(discoveryEntityKey(entry))}
                    onChange={() => row.kind === 'region' ? toggleLocationBranch(entry) : toggleEntity(entry)}
                  />
                  <span className="tree-marker" aria-hidden="true">{row.kind === 'region' ? '⌖' : '•'}</span>
                  {entityType !== 'location' && <span className="bulk-picker-avatar" aria-hidden="true">
                    {entry.imageURL ? <img src={entry.imageURL} alt="" /> : entityName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                  </span>}
                  <span title={entityName}>{entityName}</span>
                </label>
              );
              })}

          </div>

          <div className="bulk-target-picker">
            <div className="bulk-picker-head"><strong>Campos para liberar</strong><button onClick={toggleAllTargets}>{optionalTargets.length && optionalTargets.every((target) => selectedTargets.has(discoveryTargetKey(target))) ? 'Desselecionar todos' : 'Selecionar todos'}</button></div>
            <small className="bulk-required-note">✓ Existência do registro · ✓ Informações básicas · ✓ Foto de perfil (incluídos automaticamente)</small>
            {(entityType === 'npc' || categorizedDiscoveryTypes.includes(entityType)) && <small className="bulk-required-note">Campos vazios também serão liberados e aparecerão quando forem preenchidos</small>}
            {displayTargets.map((target) => {
              if (target.kind === 'group') {
                const groupKey = discoveryTargetKey(target);
                const groupSelected = target.children.every((child) => selectedTargets.has(discoveryTargetKey(child)));
                const groupAvailable = categorizedDiscoveryTypes.includes(entityType) || !target.availableEntityIds;
                return (
                  <div key={groupKey} className="discovery-field-group">
                    <label className={`${groupSelected || selectedTargets.has(groupKey) ? 'selected' : ''} ${!groupAvailable ? 'disabled' : ''}`}>
                      <input type="checkbox" disabled={!groupAvailable} checked={groupSelected || selectedTargets.has(groupKey)} onChange={() => toggleTarget(target)} />
                      <span>{target.label ?? target.key}{target.description && <small className="bulk-group-description">{target.description}</small>}</span>
                    </label>
                    <div className="discovery-field-group-items">
                      {target.children.map((child) => {
                        const childKey = discoveryTargetKey(child);
                        const available = categorizedDiscoveryTypes.includes(entityType) || !child.availableEntityIds || optionalTargets.some((item) => discoveryTargetKey(item) === childKey);
                        return (
                          <label key={childKey} className={`${selectedTargets.has(childKey) ? 'selected' : ''} ${!available ? 'disabled' : ''}`}>
                            <input type="checkbox" disabled={!available} checked={selectedTargets.has(childKey)} onChange={() => toggleTarget(child)} />
                            <span>{child.label ?? child.key}{child.description && <small className="bulk-group-description">{child.description}</small>}{!available && <small> · vazio</small>}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const available = categorizedDiscoveryTypes.includes(entityType) || !target.availableEntityIds || optionalTargets.some((item) => discoveryTargetKey(item) === discoveryTargetKey(target));
              return (
                <label key={discoveryTargetKey(target)} className={`${selectedTargets.has(discoveryTargetKey(target)) ? 'selected' : ''} ${!available ? 'disabled' : ''}`}><input type="checkbox" disabled={!available} checked={selectedTargets.has(discoveryTargetKey(target))} onChange={() => toggleTarget(target)} /><span>{target.label ?? target.key}{target.description && <small className="bulk-group-description">{target.description}</small>}{!available && <small> · vazio</small>}</span></label>
              );
            })}
          </div>
          <div className="bulk-target-picker">
            <div className="bulk-picker-head"><strong>Jogadores</strong><button onClick={toggleAllPlayers}>{selected.size === players.length ? 'Desselecionar todos' : 'Selecionar todos'}</button></div>
            {players.map((entry) => (
              <label key={entry.user.id} className={selected.has(entry.user.id) ? 'selected' : ''}>
                <input type="checkbox" checked={selected.has(entry.user.id)} onChange={() => toggle(entry.user.id)} />
                <span className="bulk-picker-avatar" aria-hidden="true">
                  {entry.user.characterImageUrl ? <img src={entry.user.characterImageUrl} alt="" /> : (entry.user.name ?? 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                </span>
                <span>{entry.user.name}</span>
              </label>
            ))}
          </div>
          </div>
        )}
        {!request.bulk && (

          <div className="bulk-target-picker">

            <div className="bulk-picker-head">

              <strong>Campos para liberar</strong>

              <div className="bulk-picker-actions">

                <button onClick={selectAll}>Selecionar tudo</button>

                <button onClick={clearAll}>Desselecionar tudo</button>

              </div>

            </div>

            {targets.map((target) => <label key={`${target.kind}:${target.key}`} className={selectedTargets.has(`${target.kind}:${target.key}`) ? 'selected' : ''}><input type="checkbox" checked={selectedTargets.has(`${target.kind}:${target.key}`)} onChange={() => toggleTarget(target)} /><span>{target.label ?? target.key}</span></label>)}

          </div>

        )}

        {!request.bulk && <div className="player-picker">

          <div className="bulk-picker-head"><strong>Jogadores</strong><button onClick={toggleAllPlayers}>{selected.size === players.length ? 'Desselecionar todos' : 'Selecionar todos'}</button></div>

          {memberships.isLoading && <span>Carregando jogadores…</span>}

          {players.map((entry) => (

              <label key={entry.user.id} className={selected.has(entry.user.id) ? 'selected' : ''}>

                <input

                type="checkbox"

                checked={selected.has(entry.user.id)}

                onChange={() => toggle(entry.user.id)}

              />

              <span className="permission-avatar" aria-hidden="true">

                {entry.user.characterImageUrl ? <img src={entry.user.characterImageUrl} alt="" /> : (entry.user.name ?? 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}

              </span>

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

        </div>}

        {exceedsBatchLimit && <div className="alert" role="status">A seleção gera {grantsToSend.length} permissões e será enviada em {grantBatches.length} lotes.</div>}
        {save.error && <div className="alert error">{save.error.message}</div>}

        </div>

        <div className="modal-actions">

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

          <span className="muted">

            {selected.size} jogador(es) · {entityType === 'npc' ? `${optionalTargets.filter((target) => selectedTargets.has(discoveryTargetKey(target))).length} grupo(s)/campo(s) + básicos` : `${selectedTargets.size} item(ns) por jogador`} · {selectedEntities.size} {entityType === 'npc' ? 'personagem(ns)' : 'registro(s)'}

          </span>

          <button onClick={onClose}>Cancelar</button>

          <button

            className="primary"

            disabled={!canConfirm || !grantsToSend.length || save.isPending}

            onClick={() => save.mutate()}

          >

            {save.isPending ? 'Aplicando…' : 'Confirmar permissões'}

          </button>

        </div>

      </div>

    </div>

  );

}



export function canConfirmDiscoveryGrant({

  selected,

  selectedTargets,

  selectedEntities,

  requireSelectedEntities = true

}) {

  return Boolean(

    selected?.size &&

    selectedTargets?.size &&

    (!requireSelectedEntities || selectedEntities?.size)

  );

}

export function chunkDiscoveryGrants(grants = [], size = 500) {
  const batches = [];
  for (let index = 0; index < grants.length; index += size) batches.push(grants.slice(index, index + size));
  return batches;
}



export function buildBulkEntityDiscoveryRequest({ type, items = [] }) {

  const orderedItems = type === 'location'

    ? [...items].sort((a, b) =>

      locationBreadcrumbLabel(a, items).localeCompare(locationBreadcrumbLabel(b, items), 'pt-BR')

    )

    : items;

  const questItemsHaveDetails = type === 'quest' && orderedItems.some((item) =>
    item.objectives?.length || item.fields?.length || Object.keys(item.sectionVisibility ?? {}).length
  );
  const questTargets = questItemsHaveDetails
    ? questDiscoveryTargets({
      fields: orderedItems.flatMap((item) => item.fields ?? []),
      sectionVisibility: Object.assign({}, ...orderedItems.map((item) => item.sectionVisibility ?? {})),
      objectives: orderedItems.flatMap((item) => item.objectives ?? [])
    })
    : [{ kind: 'entity', key: 'existence', label: 'Existência do registro' }];

  const result = {

    label: bulkEntityLabels[type] ?? 'Liberar registros',

    targets: categorizedDiscoveryTypes.includes(type)
      ? categorizedDiscoveryTargets(type, orderedItems)
      : questTargets,
    bulk: true,

    entities: orderedItems.map((item) => {
      const entity = {
      ...(item.fields?.length ? { fields: item.fields, identity: item.identity, locations: item.locations, relations: item.relations, services: item.services, t20: item.t20, references: item.references } : {}),
      ...(type === 'monster' && item.references ? { references: item.references } : {}),
      ...(type === 'location' && item.connections?.length ? { connections: item.connections } : {}),
      ...(type === 'monster' ? {
        ...(item.movements?.length ? { movements: item.movements } : {}),
        ...(item.attacks?.length ? { attacks: item.attacks } : {}),
        ...(item.abilities?.length ? { abilities: item.abilities } : {}),
        ...(item.skills?.length ? { skills: item.skills } : {}),
        ...(item.traits?.length ? { traits: item.traits } : {})
      } : {}),
      entityType: type,

      entityId: item.id,

      name: type === 'location' ? locationBreadcrumbLabel(item, items) : item.name,

      imageURL: item.imageURL ?? item.imageUrl ?? '',

      ...(item.subtitle ?? item.title ? { subtitle: item.subtitle ?? item.title } : {}),

      ...(type === 'quest' && item.objectives?.length ? { objectives: item.objectives.map((objective) => ({ objectiveId: objective.objectiveId, text: objective.text })) } : {})

      };
      if (type === 'location') {
        Object.defineProperties(entity, {
          treeName: { value: item.name, enumerable: false },
          type: { value: item.type, enumerable: false },
          parentId: { value: item.parentId, enumerable: false },
          placement: { value: { ...item.placement, floor: locationFloor(item, items) }, enumerable: false }
        });
      }
      return entity;
    }),
  };
  if (categorizedDiscoveryTypes.includes(type)) Object.defineProperty(result, 'categories', {
    value: categorizedDiscoveryTargets(type, orderedItems), enumerable: true, configurable: true
  });
  return result;

}



export function buildDiscoveryGrantBatch({

  request,

  selected,

  selectedEntities,

  selectedTargets,

  allowance,

  entityType,

  entityId,

  entities = request?.entities?.length ? request.entities : [{ entityType, entityId, name: request?.label ?? 'Registro' }]

}) {

  const selectionTargets = request?.targets?.length ? request.targets : [{ kind: 'entity', key: 'existence' }];
  const targets = expandDiscoveryTargets(selectionTargets);
  selectedTargets = new Set(expandDiscoveryTargets(selectionTargets.filter((target) => selectedTargets?.has(discoveryTargetKey(target)))).map(discoveryTargetKey));



  if (!request?.entities?.length) {

    const targetEntries = targets.filter((target) => selectedTargets?.has(`${target.kind}:${target.key}`));

    return [...(selected ?? [])].flatMap((subjectId) =>

      targetEntries.map((target) => ({

        subjectType: 'user',

        subjectId,

        entityType: entityType,

        entityId: entityId,

        targetKind: target.kind,

        targetKey: target.key,

        allowance

      }))

    );

  }



  return [...(selected ?? [])].flatMap((subjectId) =>

    [...(selectedEntities ?? [])].flatMap((entityKey) => {

      const entry = entities.find((item) => `${item.entityType ?? entityType}:${item.entityId ?? entityId}` === entityKey);

      if (!entry) return [];

      const entityTargets = [

        ...targets.filter((target) => target.kind !== 'objective'),

        ...(entry.objectives ?? []).map((objective) => ({ kind: 'objective', key: objective.objectiveId }))

      ];

      const targetEntries = entityTargets.filter((target) => selectedTargets?.has(`${target.kind}:${target.key}`) || (target.kind === 'entity' && target.key === 'existence'));

      const grants = targetEntries.map((target) => ({

        subjectType: 'user',

        subjectId,

        entityType: entry.entityType ?? entityType,

        entityId: entry.entityId ?? entityId,

        targetKind: target.kind,

        targetKey: target.key,

        allowance

      }));

      for (const objective of entry.objectives ?? []) {

        const target = objective.target;

        if (!target?.type || !target.id) continue;

        grants.push({

          subjectType: 'user',

          subjectId,

          entityType: target.type,

          entityId: target.id,

          targetKind: 'entity',

          targetKey: 'existence',

          allowance

        });

      }

      return grants;

    })

  );

}



function floorLabel(floor) {

  const number = floor.match(/^f(\d+)$/i)?.[1];

  return number || /^\d+$/.test(floor)

    ? `Andar ${number ?? floor}`

    : floor === 'sem-andar'

      ? 'Andar não definido'

      : floor;

}



export function monsterNdLabel(entity) {

  const nd = entity?.sheet?.nd ?? entity?.t20?.nd ?? entity?.nd ?? '';

  if (nd === '' || nd == null) return '';

  return `ND ${String(nd)}`;

}



function LocationMenuImage({ entity }) {
  const src = entityImage(entity);
  return src ? <img key={src} className="location-menu-image" src={src} alt="" aria-hidden="true" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : null;
}

function LocationMenu({ items, selectedId, onSelect, campaignId, canBulkGrant, onBulkGrant }) {

  const resolvedDefaultState = useMemo(() => resolveLocationMenuState({ items, selectedId }), [items, selectedId]);

  const [selectedFloor, setSelectedFloor] = useState(resolvedDefaultState.floor);

  const [selectedRegion, setSelectedRegion] = useState(resolvedDefaultState.region);

  const [_regionPreviewId, setRegionPreviewId] = useState(null);



  useEffect(() => {

    if (!selectedId) return;

    const next = resolveLocationMenuState({ items, selectedId });

    setSelectedFloor(next.floor ?? null);



    setSelectedRegion(next.region ?? null);

  }, [items, selectedId]);



  const byId = new Map(items.map((item) => [item.id, item]));

  const floors = [...new Set(items.map(item => locationFloor(item, items)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const floorItems = selectedFloor ? items.filter((item) => locationFloor(item, items) === selectedFloor) : [];

  const regions = resolveLocationMenuRegions({ items: floorItems });

  const region = byId.get(selectedRegion) ?? regions[0] ?? null;

  const activeRegionId = selectedRegion ?? region?.id ?? null;

  const regionStartCity = floorItems.find((item) => item.type === 'city' && item.parentId === activeRegionId);

  const menuLocations = resolveLocationMenuEntries({ items: floorItems, selectedRegion: activeRegionId });

  const shouldShowLocations = shouldShowLocationList({ regions, selectedRegion });
  const bulkGrantButton = canBulkGrant ? (
    <button className="location-menu-bulk-action" onClick={() => onBulkGrant(items)}>
      ◇ Liberar locais
    </button>
  ) : null;



  if (!selectedFloor)

    return (

      <div className="location-menu">

        {bulkGrantButton}

        <div className="location-menu-head"><small>1 de 3</small><strong>Selecione o Andar</strong></div>

        {floors.map((floor) => (

          <button key={floor} className="location-menu-item" onClick={() => setSelectedFloor(floor)}>

            <span className="tree-marker" aria-hidden="true">▣</span>

            <span><strong>{floorLabel(floor)}</strong><small>{items.filter((item) => locationFloor(item, items) === floor).length} locais</small></span>

          </button>

        ))}

        {!floors.length && <div className="empty-list">Nenhum local disponível.</div>}

      </div>

    );



  if (regions.length && !shouldShowLocations)

    return (

      <div className="location-menu">

        {bulkGrantButton}

        <button className="location-menu-back" onClick={() => { setSelectedFloor(null); setSelectedRegion(null); setRegionPreviewId(null); }}>← Andares</button>

        <div className="location-menu-head"><small>2 de 3 · {floorLabel(selectedFloor)}</small><strong>Selecione a Região</strong></div>

        {(() => {

          const currentRegion = selectedRegion ? byId.get(selectedRegion) : region;

          const orderedRegions = currentRegion

            ? [currentRegion, ...regions.filter((item) => item.id !== currentRegion.id)]

            : regions;



          return orderedRegions.map((item) => {

            const regionCity = floorItems.find((entry) => entry.type === 'city' && entry.parentId === item.id);

            const isSelected = item.id === (selectedRegion ?? region?.id);

            const isStartCity = regionCity && regionCity.name.toLowerCase().includes('início');

            const displayName = isStartCity ? 'Cidade do Início' : formatEntityName(item);



            return (

              <div key={item.id} className="location-menu-region-wrap">

                <button className={`location-menu-item ${isSelected ? 'selected' : ''}`} onClick={() => setSelectedRegion(item.id)} title={formatEntityName(item)}>

                  <LocationMenuImage entity={item} />

                  <span className="tree-marker" aria-hidden="true">⌖</span>

                  <span><strong>{displayName}</strong><small>{isSelected ? 'Região selecionada' : 'Região'}</small></span>

                </button>

                {isStartCity && (

                  <button

                    className="location-menu-mini-action"

                    onClick={() => {

                      setSelectedRegion(item.id);

                      setRegionPreviewId(null);

                      onSelect(regionCity.id);

                    }}

                  >

                    Cidade do início: {formatEntityName(regionCity)}

                  </button>

                )}

              </div>

            );

          });

        })()}

      </div>

    );



  if (!regions.length && !menuLocations.length)

    return (

      <div className="location-menu">

        {bulkGrantButton}

        <button className="location-menu-back" onClick={() => { setSelectedFloor(null); setSelectedRegion(null); }}>← Andares</button>

        <div className="empty-list">Nenhum local neste andar.</div>

      </div>

    );



  return (

    <div className="location-menu">

      {bulkGrantButton}

      <button className="location-menu-back" onClick={() => { setSelectedFloor(null); setSelectedRegion(null); setRegionPreviewId(null); }}>← Andares</button>

      <button className="location-menu-back secondary" onClick={() => { setSelectedRegion(null); setRegionPreviewId(null); }}>← Regiões</button>

      <div className="location-menu-head"><small>3 de 3 · {floorLabel(selectedFloor)}</small><strong>Regiões</strong></div>

      {region && <button className={`location-menu-item ${selectedRegion === region.id ? 'selected' : ''}`} onClick={() => { setSelectedRegion(region.id); onSelect(region.id); }} title={formatEntityName(region)}><LocationMenuImage entity={region} /><span className="tree-marker" aria-hidden="true">⌖</span><span className="location-label-wrap"><strong>{formatEntityName(region)}</strong><small>Região selecionada</small></span><small>Região</small></button>}

      <div className="location-menu-head"><small>{region?.name ?? floorLabel(selectedFloor)}</small><strong>Locais</strong></div>

      {regionStartCity && !menuLocations.some((item) => item.id === regionStartCity.id) && (

        <button key={regionStartCity.id} className={`location-menu-item ${regionStartCity.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(regionStartCity.id)} title={formatEntityName(regionStartCity)}>

          <LocationMenuImage entity={regionStartCity} />

          <span className="tree-marker" aria-hidden="true">•</span>

          <span className="location-label-wrap"><strong>{formatEntityName(regionStartCity)}</strong><small>Cidade do início</small></span>

          <small>Cidade</small>

        </button>

      )}

      {menuLocations.map((item) => {

        const lastSeenAt = readEntitySeenAt({ campaignId, type: 'location', entityId: item.id });

        const changeState = getEntityChangeState(item, lastSeenAt);

        const handleClick = () => {

          const { selectedRegion: nextRegion, itemId } = resolveLocationMenuClick(item);

          if (nextRegion) {

            setSelectedRegion(nextRegion);

            setRegionPreviewId(null);

          }

          onSelect(itemId);

        };



        return (

          <button key={item.id} className={`location-menu-item ${item.id === selectedId ? 'selected' : ''}`} onClick={handleClick} title={formatEntityName(item)}>

            <LocationMenuImage entity={item} />

            <span className="tree-marker" aria-hidden="true">{item.type === 'city' ? '⌂' : '•'}</span>

            <span className="location-label-wrap">

              <strong>{formatEntityName(item)}</strong>
                    <strong>{formatEntityName(item)}</strong>
              <strong>{formatEntityName(item)}</strong>

              {item.type === 'city' && <small>Cidade inicial</small>}

              {changeState && <span className={`change-badge ${changeState.kind}`}>{changeState.label}</span>}

            </span>

            <small>{item.type === 'city' ? 'Cidade' : 'Local'}</small>

          </button>

        );

      })}

      {!menuLocations.length && <div className="empty-list">Nenhum local nesta região.</div>}

    </div>

  );

}



function MonsterLocationFilter({ locations, selectedRegion, selectedLocation, onRegionChange, onLocationChange }) {

  const regions = resolveLocationMenuRegions({ items: locations });

  const locationOptions = selectedRegion

    ? resolveLocationMenuEntries({ items: locations, selectedRegion })

    : [];



  return (

    <div className="monster-location-filter">

      <label>

        Região

        <select value={selectedRegion} onChange={(event) => onRegionChange(event.target.value)}>

          <option value="">Todas as regiões</option>

          {regions.map((region) => <option key={region.id} value={region.id} title={formatEntityName(region)}>{formatEntityName(region)}</option>)}

        </select>

      </label>

      <label>

        Local

        <select value={selectedLocation} disabled={!selectedRegion} onChange={(event) => onLocationChange(event.target.value)}>

          <option value="">Todos os locais da região</option>

          {locationOptions.map((location) => <option key={location.id} value={location.id} title={formatEntityName(location)}>{formatEntityName(location)}</option>)}

        </select>

      </label>

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

  const [deleteRequest, setDeleteRequest] = useState(null);

  const [viewAsUserId, setViewAsUserId] = useState('');

  const [monsterRegionId, setMonsterRegionId] = useState('');

  const [monsterLocationId, setMonsterLocationId] = useState('');

  const [itemCategoryFilter, setItemCategoryFilter] = useState('all');

  const queryClient = useQueryClient();

  const memberships = useQuery({

    queryKey: ['memberships', campaignId],

    queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`),

    enabled: isGm

  });

  const players = (memberships.data ?? []).filter(

    (entry) => !['owner', 'gm', 'assistant_gm'].includes(entry.role)

  );

  const previewPlayer = players.find((entry) => entry.user.id === viewAsUserId);

  const previewSuffix = viewAsUserId ? `?viewAsUserId=${encodeURIComponent(viewAsUserId)}` : '';

  const effectiveIsGm = isGm && !viewAsUserId;

  const list = useQuery({

    queryKey: ['entities', campaignId, type, viewAsUserId],

    queryFn: () =>

      api(

        `/api/v1/campaigns/${campaignId}/${plural(type)}?pageSize=100${

          viewAsUserId ? `&viewAsUserId=${encodeURIComponent(viewAsUserId)}` : ''

        }`

      )

  });

  const locations = useQuery({

    queryKey: ['entities', campaignId, 'location', viewAsUserId],

    queryFn: () =>

      api(

        `/api/v1/campaigns/${campaignId}/locations?pageSize=100${

          viewAsUserId ? `&viewAsUserId=${encodeURIComponent(viewAsUserId)}` : ''

        }`

      ),

    enabled: type === 'monster'

  });

  const detail = useQuery({

    queryKey: ['entity', campaignId, type, selectedId, viewAsUserId],

    queryFn: () =>

      api(

        `/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(selectedId)}${previewSuffix}`

      ),

    enabled: Boolean(selectedId)

  });

  const viewers = useQuery({

    queryKey: ['entity-viewers', campaignId, type, selectedId],

    queryFn: () =>

      api(

        `/api/v1/campaigns/${campaignId}/discoveries/${encodeURIComponent(type)}/${encodeURIComponent(selectedId)}/viewers`

      ),

    enabled: effectiveIsGm && Boolean(selectedId)

  });

  const visibleItems = useMemo(

    () => type === 'monster'

      ? filterMonstersByLocation({

        monsters: list.data?.items ?? [],

        locations: locations.data?.items ?? [],

        regionId: monsterRegionId,

        locationId: monsterLocationId

      })

      : list.data?.items ?? [],

    [list.data, locations.data, monsterLocationId, monsterRegionId, type]

  );

  const displayItems = useMemo(
    () => type === 'item' && itemCategoryFilter !== 'all'
      ? visibleItems.filter((item) => item.category === itemCategoryFilter)
      : visibleItems,
    [itemCategoryFilter, type, visibleItems]
  );



  useEffect(() => {

    if (!list.data) return;

    if (!selectedId || !displayItems.some((item) => item.id === selectedId)) {

      const nextId = displayItems[0]?.id;

      setParams(nextId ? { selected: nextId } : {}, { replace: true });

    }

  }, [selectedId, displayItems, setParams]);



  useEffect(() => {

    if (!selectedId || !detail.data || viewAsUserId) return;

    const lastSeenAt = readEntitySeenAt({ campaignId, type, entityId: selectedId });

    const activityAt = readEntityActivityAt({ campaignId, type, entityId: selectedId });

    const state = getEntityChangeState(detail.data, lastSeenAt, activityAt);

    console.log('[sao:entityBadge]', { campaignId, type, selectedId, lastSeenAt, activityAt, state });

    if (state && state.kind) {

      const timestamp = Date.now();

      window.localStorage.setItem(

        getEntitySeenStorageKey({ campaignId, type, entityId: selectedId }),

        String(timestamp)

      );

      const { title, message } = state.kind === 'new'

        ? { title: 'Novo conteúdo', message: `${formatEntityName(detail.data)} foi adicionado recentemente.` }

        : { title: 'Conteúdo atualizado', message: `${formatEntityName(detail.data)} foi editado e precisa de revisão.` };

      window.dispatchEvent(new CustomEvent('sao:toast', { detail: { kind: state.kind, title, message } }));

    }

  }, [campaignId, detail.data, selectedId, type, viewAsUserId]);



  const openEditor = useMutation({

    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(selectedId)}?format=2`),

    onSuccess: (entity) => setEditor({ data: createEntityDraft(type, entity), version: entity.version })

  });

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

  const bulkRemove = useMutation({

    mutationFn: async (ids) => {

      for (const id of ids) {

        await api(`/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(id)}`, {

          method: 'DELETE'

        });

      }

    },

    onSuccess: async (_result, ids) => {

      if (ids.includes(selectedId)) setParams({});

      setDeleteRequest(null);

      await queryClient.invalidateQueries({ queryKey: ['entities', campaignId, type] });

    }

  });

  const itemMap = useMemo(

    () => new Map((list.data?.items ?? []).map((item) => [item.id, item])),

    [list.data]

  );

  const badgeFor = (item) => {

    if (!item || viewAsUserId) return null;

    const lastSeenAt = readEntitySeenAt({ campaignId, type, entityId: item.id });

    const activityAt = readEntityActivityAt({ campaignId, type, entityId: item.id });

    const state = getEntityChangeState(item, lastSeenAt, activityAt);

    if (!state) return null;

    return <span className={`change-badge ${state.kind}`}>{state.label}</span>;

  };

  if (list.isLoading)

    return <div className="state-card">Carregando {labels[type].toLowerCase()}…</div>;

  if (list.isError) return <div className="state-card error">{list.error.message}</div>;

  const current = detail.data ?? itemMap.get(selectedId);

  return (

    <>

      {openEditor.error && <div className="alert error">{openEditor.error.message}</div>}

      <div className="page-heading">

        <div>

          <small className="eyebrow">BASE DE DADOS DE AINCRAD</small>

          <h1>{labels[type]}</h1>

          <p>{displayItems.length} registros visíveis</p>

        </div>

        <div className="actions">

          {isGm && (

            <label className="player-preview-select">

              <span>Visualizar como</span>

              <select

                value={viewAsUserId}

                onChange={(event) => setViewAsUserId(event.target.value)}

              >

                <option value="">Mestre</option>

                {players.map((entry) => (

                  <option key={entry.user.id} value={entry.user.id}>

                    {entry.user.name}

                  </option>

                ))}

              </select>

            </label>

          )}

          {effectiveIsGm && (type === 'monster' ? list.data?.items?.length > 0 : displayItems.length > 0) && (

            <button

              className="primary"

              onClick={() => setGrantRequest({
                ...buildBulkEntityDiscoveryRequest({ type, items: type === 'monster' ? list.data?.items ?? [] : displayItems }),
                ...(type === 'monster' ? { initialRegionId: monsterRegionId } : {})
              })}

            >

              ◇ {bulkEntityLabels[type] ?? 'Liberar registros'}

            </button>

          )}

          {effectiveIsGm && type === 'location' && visibleItems.length > 0 && (

            <button className="danger" onClick={() => setDeleteRequest({ items: visibleItems })}>

              ✕ Excluir

            </button>

          )}

          {effectiveIsGm && (

            <button className="primary" onClick={() => setEditor({ data: starter(type) })}>

              ＋ Novo

            </button>

          )}

        </div>

      </div>

      {previewPlayer && (

        <div className="player-preview-banner">

          Visualização de jogador: <strong>{previewPlayer.user.name}</strong>

          <button onClick={() => setViewAsUserId('')}>Sair da visualização</button>

        </div>

      )}

      <div className="split-view">

        <aside className="entity-list">

          {type === 'item' && <div className="item-category-filters" role="toolbar" aria-label="Filtrar itens por categoria">

            {itemCategoryFilters.map((filter) => <button
              key={filter.value}
              type="button"
              className={`item-category-filter item-category-filter-${filter.value} ${itemCategoryFilter === filter.value ? 'active' : ''}`}
              aria-pressed={itemCategoryFilter === filter.value}
              title={filter.label}
              onClick={() => setItemCategoryFilter(filter.value)}
            >
              <span aria-hidden="true">{filter.emoji}</span>
              <small>{filter.label}</small>
            </button>)}

          </div>}

          {type === 'location' ? (

            <LocationMenu

              items={list.data.items}

              selectedId={selectedId}

              onSelect={(id) => setParams({ selected: id })}

              campaignId={campaignId}

              canBulkGrant={effectiveIsGm}

              onBulkGrant={(items) => setGrantRequest(buildBulkEntityDiscoveryRequest({ type: 'location', items }))}

            />

          ) : type === 'monster' ? (

            <>

              <MonsterLocationFilter

                locations={locations.data?.items ?? []}

                selectedRegion={monsterRegionId}

                selectedLocation={monsterLocationId}

                onRegionChange={(regionId) => { setMonsterRegionId(regionId); setMonsterLocationId(''); }}

                onLocationChange={setMonsterLocationId}

              />

              {displayItems.map((item) => {

                const monsterNd = monsterNdLabel(item);

                return (

                  <button

                    key={item.id}

                    className={selectedId === item.id ? 'selected' : ''}

                    onClick={() => setParams({ selected: item.id })}

                    title={formatEntityName(item)}

                  >

                    {entityImage(item) ? <img className="list-thumbnail" src={entityImage(item)} alt="" /> : type === 'item' ? <span className="list-thumbnail list-image-placeholder" aria-label="Imagem não cadastrada">+</span> : <span className="list-diamond">◇</span>}

                    <span className="list-label-wrap">

                      <strong>{formatEntityName(item)}</strong>

                      {monsterNd && <small className="list-meta">{monsterNd}</small>}

                      {badgeFor(item)}

                    </span>

                  </button>

                );

              })}

            </>

          ) : (

            displayItems.map((item) => {

              const monsterNd = type === 'monster' ? monsterNdLabel(item) : '';

              return (

                <button

                  key={item.id}

                  className={selectedId === item.id ? 'selected' : ''}

                  onClick={() => setParams({ selected: item.id })}

                  title={formatEntityName(item)}

                >

                  {entityImage(item) ? <img className="list-thumbnail" src={entityImage(item)} alt="" /> : type === 'item' ? <span className="list-thumbnail list-image-placeholder" aria-label="Imagem não cadastrada">+</span> : <span className="list-diamond">◇</span>}

                  <span className="list-label-wrap">

                    <strong className={type === 'item' ? rarityClass(item.rarity) : undefined}>{formatEntityName(item)}</strong>

                    {monsterNd && <small className="list-meta">{monsterNd}</small>}

                    {type === 'quest' && <small className="list-meta quest-type-meta">{optionLabel(questTypeOptions, item.type) || 'Missão'}</small>}

                    {badgeFor(item)}

                  </span>

                </button>

              );

            })

          )}

          {!displayItems.length && <div className="empty-list">Nenhum registro visível para este filtro.</div>}

        </aside>

        <section className="detail-pane">

          {detail.isLoading ? (

            <div className="state-card">Carregando detalhes…</div>

          ) : detail.isError ? (

            <div className="state-card">Este conteúdo não está visível para o jogador.</div>

          ) : (

            <ViewersContext.Provider value={viewers.data}>

              <EntityDetail

                entity={current}

                type={type}

                campaignId={campaignId}

                isGm={effectiveIsGm}

                onGrant={setGrantRequest}

                onEdit={() => openEditor.mutate()}

                onDelete={() => {

                  if (window.confirm(`Excluir ${formatEntityName(current)}?`)) remove.mutate();

                }}

              />

            </ViewersContext.Provider>

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

            await Promise.all([

              queryClient.invalidateQueries({ queryKey: ['entities', campaignId, type] }),

              queryClient.invalidateQueries({ queryKey: ['entity', campaignId, type] }),

              queryClient.refetchQueries({

                queryKey: ['entity', campaignId, type, saved.id],

                type: 'active'

              })

            ]);

            if (saved?.id) setParams({ selected: saved.id });

          }}

        />

      )}

      {grantRequest && (

        <DiscoveryModal

          request={grantRequest}

          locations={locations.data?.items ?? []}

          campaignId={campaignId}

          entityType={type}

          entityId={selectedId}

          onClose={() => setGrantRequest(null)}

        />

      )}

      {deleteRequest && (

        <BulkDeleteModal

          items={deleteRequest.items}

          type={type}

          isPending={bulkRemove.isPending}

          error={bulkRemove.error}

          onConfirm={(ids) => bulkRemove.mutate(ids)}

          onClose={() => setDeleteRequest(null)}

        />

      )}

    </>

  );

}




