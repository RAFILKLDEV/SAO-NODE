const hasText = (value) => typeof value === 'string' ? value.trim().length > 0 : value != null;

const hasReference = (reference) =>
  Boolean(reference && hasText(reference.type) && hasText(reference.id));

const cleanReferences = (values) => (values ?? []).filter(hasReference);

const cleanServices = (values) =>
  (values ?? []).filter((service) =>
    typeof service === 'string' ? hasText(service) : hasText(service?.name ?? service?.type)
  );

const hasComponentData = (component) =>
  Object.values(component?.data ?? {}).some(hasText);

const cleanQuestObjectives = (objectives = []) => {
  const objectiveIds = new Set(objectives.map((objective) => objective.objectiveId).filter(hasText));

  return objectives.map((objective) => ({
    ...objective,
    target: hasReference(objective.target) ? objective.target : undefined,
    dependsOn: (objective.dependsOn ?? []).filter((objectiveId) =>
      objectiveId !== objective.objectiveId && objectiveIds.has(objectiveId)
    )
  }));
};

const isUntouchedObjective = (objective) =>
  !hasText(objective?.text) &&
  !objective?.target?.id &&
  (objective?.type ?? 'talk') === 'talk' &&
  Number(objective?.requiredQuantity ?? 1) === 1 &&
  !(objective?.dependsOn ?? []).length &&
  !objective?.optional &&
  !objective?.secret &&
  !objective?.playerEditable;

/**
 * Removes placeholder rows created by the structured editor before saving.
 * Partially filled rows are intentionally retained so the API can report the
 * exact invalid field instead of silently discarding user input.
 */
export function prepareEntityPayload(type, data) {
  const payload = { ...data };

  payload.references = cleanReferences(payload.references);

  if (type === 'npc') {
    payload.services = cleanServices(payload.services);
    payload.locations = cleanReferences(payload.locations);
    payload.relations = cleanReferences(payload.relations);
  }

  if (type === 'location') {
    payload.services = cleanServices(payload.services);
    payload.connections = (payload.connections ?? []).filter((connection) =>
      hasText(connection?.targetId ?? connection?.to)
    );
  }

  if (type === 'item') {
    payload.stats = (payload.stats ?? []).filter((stat) =>
      hasText(stat?.key) || hasText(stat?.value)
    );
  }

  if (type === 'monster') {
    for (const key of ['movements', 'attacks', 'abilities', 'skills', 'traits']) {
      payload[key] = (payload[key] ?? []).filter(hasComponentData);
    }
  }

  if (type === 'quest') {
    payload.startSource = hasReference(payload.startSource) ? payload.startSource : undefined;
    payload.completionReceiver = hasReference(payload.completionReceiver) ? payload.completionReceiver : undefined;
    payload.nextQuests = (payload.nextQuests ?? []).filter(hasText);
    payload.requirements = (payload.requirements ?? []).filter((requirement) =>
      hasText(requirement?.type)
    );
    payload.rewards = (payload.rewards ?? []).filter((reward) =>
      hasText(reward?.type) && (hasText(reward?.rewardId) || hasReference(reward?.target) || hasText(reward?.id) || hasText(reward?.amount) || hasText(reward?.quantity) || Object.keys(reward?.data ?? {}).length > 0)
    );
    payload.objectives = cleanQuestObjectives(
      (payload.objectives ?? []).filter(
        (objective) => !isUntouchedObjective(objective)
      )
    );
  }

  return payload;
}
