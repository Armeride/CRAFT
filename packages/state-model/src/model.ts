import { canonicalJson } from '../../domain/src/canonical.js';
import type { Diagnostic, ProjectSnapshot, RevisionRecord, SnapshotTarget } from '../../domain/src/model.js';
import type { Definition, Field, JsonValue, Operand, StateModelV1, Transition } from './generated.js';

export const statePayload = (record: RevisionRecord): StateModelV1 | undefined => record.meta.extensions['state_model'] as StateModelV1 | undefined;
const legacyInitial = (record: RevisionRecord) => record.meta.extensions['narrative']?.['initial_state'] as { world_tick: number; values: Record<string, JsonValue> } | undefined;
export interface StateRecord { target: SnapshotTarget; source: 'state_model@1' | 'narrative@1'; recordType: string; path: string; data: unknown }

/** Read adapters only: no default values, migration, event replay or simulation. */
export function stateRecords(snapshot: ProjectSnapshot): StateRecord[] {
  const result: StateRecord[] = [];
  for (const entity of snapshot.entities.values()) for (const record of entity.revisions.values()) {
    if (!record.writable) continue;
    const target = { entity_id: entity.value.id, revision_id: record.meta.revision_id };
    const payload = statePayload(record);
    if (payload) {
      const data = payload.record_type === 'definition' && payload.initial.source === 'narrative_v1' ? { ...payload, initial: { source: 'narrative_v1', ...legacyInitial(record)! } } : payload;
      result.push({ target, source: 'state_model@1', recordType: payload.record_type, path: record.path, data });
    } else if (entity.value.kind === 'narrative.character') {
      result.push({ target, source: 'narrative@1', recordType: 'definition', path: record.path, data: { initial: legacyInitial(record), fields: null, untypedLegacyFields: true } });
    } else if (entity.value.kind === 'narrative.state_event') {
      result.push({ target, source: 'narrative@1', recordType: 'legacy_occurrence', path: record.path, data: record.meta.extensions['narrative'] });
    }
  }
  return result;
}

export function fieldAccepts(field: Field, value: JsonValue): boolean {
  let valid: boolean;
  switch (field.type) {
    case 'integer': valid = typeof value === 'number' && Number.isSafeInteger(value); break;
    case 'number': valid = typeof value === 'number' && Number.isFinite(value); break;
    case 'array': case 'reference_set': valid = Array.isArray(value); break;
    case 'object': case 'reference': valid = typeof value === 'object' && value !== null && !Array.isArray(value); break;
    default: valid = typeof value === field.type;
  }
  if (typeof value === 'number') valid &&= (field.minimum === undefined || value >= field.minimum) && (field.maximum === undefined || value <= field.maximum);
  if (field.enum) valid &&= field.enum.some(item => canonicalJson(item) === canonicalJson(value));
  return valid;
}

/** Called only after the pinned state_model@1 JSON Schema has validated each payload. */
export function validateStateModel(snapshot: ProjectSnapshot): Diagnostic[] {
  if (snapshot.project.extensions['state_model']?.schema_version !== 1) return [];
  const issues: Diagnostic[] = [];
  for (const entity of snapshot.entities.values()) for (const record of entity.revisions.values()) {
    if (!record.writable) continue;
    const payload = statePayload(record);
    const issue = (code: string, pointer: string, params: Record<string, JsonValue> = {}) => issues.push({ code, messageKey: `diagnostics.${code}`, params, message: code, severity: 'error', path: record.path, pointer: '/extensions/state_model' + pointer });
    if (entity.value.kind.startsWith('state_model.') && (!payload || entity.value.kind !== 'state_model.' + payload.record_type)) { issue('STATE_RECORD_KIND_MISMATCH', ''); continue; }
    if (!payload) continue;
    if (entity.value.kind.startsWith('narrative.') && entity.value.kind !== 'narrative.character') { issue('STATE_SOURCE_CONFLICT', ''); continue; }
    const link = (id: string, pointer: string, applies = false): RevisionRecord | undefined => {
      const reference = payload.links[id];
      if (!reference) { issue('STATE_LINK_MISSING', pointer, { link: id }); return; }
      if (applies && (reference.relation !== 'depends_on' || reference.propagation !== 'blocking')) issue('STATE_APPLIED_LINK_REQUIRED', pointer, { link: id });
      return snapshot.entities.get(reference.target.entity_id)?.revisions.get(reference.target.revision_id);
    };
    const checkFields = (fields: Record<string, Field>, pointer: string) => {
      for (const [name, field] of Object.entries(fields)) {
        if ((field.minimum !== undefined || field.maximum !== undefined || field.unit !== undefined) && !['number', 'integer'].includes(field.type)) issue('STATE_FIELD_CONSTRAINT', `${pointer}/${name}`);
        if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) issue('STATE_FIELD_RANGE', `${pointer}/${name}`);
        if (field.enum?.some(value => !fieldAccepts({ type: field.type }, value))) issue('STATE_FIELD_ENUM', `${pointer}/${name}`);
      }
    };
    const checkValue = (field: Field, value: JsonValue, pointer: string) => {
      if (!fieldAccepts(field, value)) issue('STATE_VALUE_TYPE', pointer, { expected: field.type });
      if (field.type === 'reference' || field.type === 'reference_set') {
        const values = field.type === 'reference_set' && Array.isArray(value) ? value : [value];
        for (const item of values) {
          const id = item && typeof item === 'object' && !Array.isArray(item) ? item['link'] : undefined;
          if (typeof id !== 'string' || Object.keys(item as object).length !== 1) issue('STATE_REFERENCE_VALUE', pointer);
          else link(id, pointer);
        }
      }
    };
    const stateField = (id: string, name: string, pointer: string): Field | undefined => {
      const target = link(id, pointer, true), definition = target && statePayload(target);
      const field = definition?.record_type === 'definition' ? definition.fields[name] : undefined;
      if (!field) issue('STATE_FIELD_MISSING', pointer, { link: id, field: name });
      return field;
    };
    if (payload.record_type === 'definition') {
      checkFields(payload.fields, '/fields');
      const legacy = legacyInitial(record);
      if (payload.initial.source === 'declared' && legacy) issue('STATE_INITIAL_SOURCE_CONFLICT', '/initial');
      if (payload.initial.source === 'narrative_v1' && (!legacy || entity.value.kind !== 'narrative.character')) issue('STATE_INITIAL_SOURCE_MISSING', '/initial');
      const values = payload.initial.source === 'declared' ? payload.initial.values : legacy?.values ?? {};
      for (const [name, value] of Object.entries(values)) {
        const field = payload.fields[name];
        if (!field) { if (payload.initial.source === 'declared') issue('STATE_FIELD_MISSING', `/initial/values/${name}`); }
        else checkValue(field, value, `/initial/values/${name}`);
      }
    } else if (payload.record_type === 'transition') {
      checkFields(payload.input_fields, '/input_fields');
      for (const [name, id] of Object.entries(payload.bindings)) link(id, '/bindings/' + name, true);
      const binding = (name: string | undefined, id: string, pointer: string) => { if (name !== undefined && payload.bindings[name] !== id) issue('STATE_BINDING_MISMATCH', pointer, { binding: name }); };
      const operand = (value: Operand, pointer: string): Field | undefined => {
        if (value.type === 'state') { binding(value.binding, value.link, pointer); return stateField(value.link, value.field, pointer); }
        if (value.type === 'input') { const field = payload.input_fields[value.key]; if (!field) issue('STATE_INPUT_MISSING', pointer); return field; }
        return undefined;
      };
      const nodes = new Map<string, Transition['nodes'][number]>();
      for (const [index, node] of payload.nodes.entries()) { if (nodes.has(node.id)) issue('STATE_NODE_DUPLICATE', `/nodes/${index}`); nodes.set(node.id, node); }
      const adjacency = new Map<string, string[]>();
      for (const [index, node] of payload.nodes.entries()) {
        const pointer = `/nodes/${index}`;
        const children = node.op === 'not' ? [node.child] : node.op === 'all' || node.op === 'any' ? node.children : [];
        adjacency.set(node.id, children);
        for (const child of children) if (!nodes.has(child)) issue('STATE_NODE_MISSING', pointer, { node: child });
        if (node.op === 'compare') {
          const a = operand(node.left, pointer + '/left'), b = operand(node.right, pointer + '/right');
          const numeric = (field: Field) => ['number', 'integer'].includes(field.type);
          if (node.operator === 'in') {
            if (node.right.type === 'literal') {
              if (!Array.isArray(node.right.value)) issue('STATE_COMPARISON_TYPE', pointer);
              else if (a) for (const item of node.right.value) checkValue(a, item, pointer);
              if (a && node.right.unit !== a.unit) issue('STATE_UNIT_MISMATCH', pointer);
            } else if (!b || !['array', 'reference_set'].includes(b.type)) issue('STATE_COMPARISON_TYPE', pointer);
            else {
              if (a?.unit !== undefined) issue('STATE_UNIT_MISMATCH', pointer);
              if (b.type === 'reference_set') {
                if (a && a.type !== 'reference') issue('STATE_COMPARISON_TYPE', pointer);
                if (node.left.type === 'literal') checkValue({ type: 'reference' }, node.left.value, pointer);
              }
            }
          } else {
            if (a && b && (a.type !== b.type && !(numeric(a) && numeric(b)) || a.unit !== b.unit)) issue('STATE_COMPARISON_TYPE', pointer);
            for (const [field, value] of [[a, node.right], [b, node.left]] as const) if (field && value.type === 'literal') { checkValue(field, value.value, pointer); if (value.unit !== field.unit) issue('STATE_UNIT_MISMATCH', pointer); }
            if (node.left.type === 'literal' && node.right.type === 'literal' && node.left.unit !== node.right.unit) issue('STATE_UNIT_MISMATCH', pointer);
          }
          if (['lt', 'lte', 'gt', 'gte'].includes(node.operator) && ([a, b].some(field => field && !numeric(field)) || [node.left, node.right].some(value => value.type === 'literal' && typeof value.value !== 'number'))) issue('STATE_COMPARISON_TYPE', pointer);
        }
      }
      const seen = new Set<string>(), active = new Set<string>();
      const visit = (id: string): void => { if (active.has(id)) { issue('STATE_CONDITION_CYCLE', '/nodes'); return; } if (seen.has(id)) return; seen.add(id); active.add(id); for (const child of adjacency.get(id) ?? []) visit(child); active.delete(id); };
      for (const id of nodes.keys()) visit(id);
      for (const id of [payload.condition, payload.trigger.type === 'condition_entered' ? payload.trigger.node : undefined]) if (id !== undefined && !nodes.has(id)) issue('STATE_NODE_MISSING', '/condition', { node: id });
      if ((payload.trigger.type === 'condition_entered') !== (payload.repeat.mode === 'on_entry')) issue('STATE_REPEAT_POLICY', '/repeat');
      if (payload.repeat.mode === 'once_per_occurrence' && payload.repeat.max_per_occurrence !== 1) issue('STATE_REPEAT_POLICY', '/repeat/max_per_occurrence');
      for (const [index, effect] of payload.effects.entries()) {
        const pointer = `/effects/${index}`, field = stateField(effect.link, effect.field, pointer);
        binding(effect.binding, effect.link, pointer);
        if (effect.op === 'unset' ? effect.value !== undefined : effect.value === undefined) issue('STATE_EFFECT_VALUE', pointer);
        if (field) {
          if (effect.unit !== field.unit) issue('STATE_UNIT_MISMATCH', pointer);
          if (['increment', 'decrement'].includes(effect.op)) { if (!['number', 'integer'].includes(field.type) || typeof effect.value !== 'number' || (field.type === 'integer' && !Number.isSafeInteger(effect.value))) issue('STATE_EFFECT_TYPE', pointer); }
          else if (['add_to_set', 'remove_from_set'].includes(effect.op)) { if (!['array', 'reference_set'].includes(field.type)) issue('STATE_EFFECT_TYPE', pointer); else if (field.type === 'reference_set' && effect.value !== undefined) checkValue({ type: 'reference' }, effect.value, pointer); }
          else if (effect.value !== undefined) checkValue(field, effect.value, pointer);
        }
      }
    } else if (payload.record_type === 'occurrence') {
      const transition = link(payload.transition, '/transition', true);
      if (transition && statePayload(transition)?.record_type !== 'transition') issue('STATE_TRANSITION_REQUIRED', '/transition');
      link(payload.evidence, '/evidence');
      for (const id of Object.values(payload.bindings)) link(id, '/bindings', true);
      const rule = transition && statePayload(transition);
      if (rule?.record_type === 'transition') for (const [key, value] of Object.entries(payload.inputs)) {
        const field = rule.input_fields[key]; if (!field) issue('STATE_INPUT_MISSING', '/inputs/' + key); else checkValue(field, value, '/inputs/' + key);
      }
    } else {
      if (!snapshot.baselines.has(payload.baseline_id)) issue('BASELINE_MISSING', '/baseline_id');
      checkFields(payload.input_fields, '/input_fields');
      for (const [key, value] of Object.entries(payload.inputs)) { const field = payload.input_fields[key]; if (!field) issue('STATE_INPUT_MISSING', '/inputs/' + key); else checkValue(field, value, '/inputs/' + key); }
      for (const [name, actor] of Object.entries(payload.actors)) {
        const prototype = link(actor.prototype, '/actors/' + name, true), definition = prototype && statePayload(prototype);
        if (definition?.record_type !== 'definition') issue('STATE_DEFINITION_REQUIRED', '/actors/' + name);
        else for (const [field, value] of Object.entries(actor.values)) {
          const spec = definition.fields[field]; if (!spec) issue('STATE_FIELD_MISSING', '/actors/' + name); else checkValue(spec, value, '/actors/' + name + '/values/' + field);
        }
      }
      const ids = new Set<string>();
      for (const [index, event] of payload.occurrences.entries()) {
        if (ids.has(event.id)) issue('STATE_OCCURRENCE_DUPLICATE', `/occurrences/${index}`); ids.add(event.id);
        for (const actor of Object.values(event.bindings)) if (!payload.actors[actor]) issue('STATE_ACTOR_MISSING', `/occurrences/${index}`, { actor });
      }
    }
  }
  return issues;
}
