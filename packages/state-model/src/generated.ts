// Generated from schema/extensions/state_model/v1/schema.json. Run npm run schema:types; do not edit.

export type StateModelV1 = Definition | Transition | Occurrence | Scenario;
export type Id = string;
export type JsonValue =
  | (string | number | boolean | null)
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
export type Condition =
  | {
      id: string;
      op: 'constant';
      value: boolean;
    }
  | {
      id: string;
      op: 'all' | 'any';
      /**
       * @minItems 1
       * @maxItems 128
       */
      children: string[];
    }
  | {
      id: string;
      op: 'not';
      child: string;
    }
  | {
      id: string;
      op: 'compare';
      operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in';
      left: Operand;
      right: Operand;
    };
export type Operand =
  | {
      type: 'literal';
      value: JsonValue;
      unit?: string;
    }
  | {
      type: 'state';
      link: string;
      field: string;
      binding?: string;
    }
  | {
      type: 'input';
      key: string;
    };
export type Id1 = string;

export interface Definition {
  record_type: 'definition';
  links: {
    [k: string]: Reference;
  };
  fields: {
    [k: string]: Field;
  };
  initial:
    | {
        source: 'declared';
        world_tick: number;
        values: {
          [k: string]: JsonValue;
        };
      }
    | {
        source: 'narrative_v1';
      };
}
export interface Reference {
  reference_id: Id;
  target: SnapshotTarget;
  relation: 'depends_on' | 'evidence' | 'cites' | 'compares' | 'replaces' | 'related_to';
  propagation: 'blocking' | 'advisory' | 'none';
  update_policy: 'pinned' | 'track_approved' | 'track_all';
  rationale?: string;
}
export interface SnapshotTarget {
  entity_id: Id;
  revision_id: Id;
  anchor_id?: Id;
}
export interface Field {
  type: 'string' | 'boolean' | 'number' | 'integer' | 'array' | 'object' | 'reference' | 'reference_set';
  unit?: string;
  minimum?: number;
  maximum?: number;
  /**
   * @minItems 1
   * @maxItems 128
   */
  enum?: JsonValue[];
}
export interface Transition {
  record_type: 'transition';
  links: {
    [k: string]: Reference;
  };
  bindings: {
    [k: string]: string;
  };
  input_fields: {
    [k: string]: Field;
  };
  trigger:
    | {
        type: 'time';
        world_tick: number;
        event_order: number;
      }
    | {
        type: 'event';
        name: string;
      }
    | {
        type: 'condition_entered';
        node: string;
      };
  /**
   * @minItems 0
   * @maxItems 128
   */
  nodes: Condition[];
  condition?: string;
  /**
   * @minItems 1
   * @maxItems 128
   */
  effects: Effect[];
  repeat: {
    mode: 'once_per_occurrence' | 'on_entry';
    max_per_occurrence: number;
    max_chain_steps: number;
  };
}
export interface Effect {
  op: 'set' | 'increment' | 'decrement' | 'unset' | 'add_to_set' | 'remove_from_set';
  link: string;
  field: string;
  binding?: string;
  value?: JsonValue;
  unit?: string;
}
export interface Occurrence {
  record_type: 'occurrence';
  links: {
    [k: string]: Reference;
  };
  record_role: 'canon' | 'plan';
  transition: string;
  evidence: string;
  world_tick: number;
  event_order: number;
  bindings: {
    [k: string]: string;
  };
  inputs: {
    [k: string]: JsonValue;
  };
}
export interface Scenario {
  record_type: 'scenario';
  links: {
    [k: string]: Reference;
  };
  baseline_id: Id1;
  world_tick: number;
  actors: {
    [k: string]: {
      prototype: string;
      values: {
        [k: string]: JsonValue;
      };
    };
  };
  input_fields: {
    [k: string]: Field;
  };
  inputs: {
    [k: string]: JsonValue;
  };
  /**
   * @minItems 0
   * @maxItems 1024
   */
  occurrences: {
    id: string;
    name: string;
    world_tick: number;
    event_order: number;
    bindings: {
      [k: string]: string;
    };
  }[];
  /**
   * @minItems 0
   * @maxItems 128
   */
  assumptions: string[];
}
