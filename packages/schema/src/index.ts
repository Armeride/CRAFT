import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as formats } from 'ajv-formats';
import schema from '../core/v1/schema.json' with { type: 'json' };
import paths from '../core/v1/reference-paths.json' with { type: 'json' };
import type { Diagnostic, LocatedReference } from '../../domain/src/model.js';
import type { Reference } from './generated.js';

// Explicit declaration of reference-bearing paths; arbitrary object strings are never inferred.
export const referencePaths: Readonly<Record<string, readonly string[]>> = paths;
export const schemaBundle = schema;
export const coreSchemaId = schema.$id;
export const kindSchemas: Readonly<Record<string, { namespace: string; definition: string }>> = {
  'narrative.character': { namespace: 'narrative', definition: 'NarrativeCharacter' },
  'narrative.scene': { namespace: 'narrative', definition: 'NarrativeScene' },
  'narrative.state_event': { namespace: 'narrative', definition: 'StateEvent' },
  'narrative.knowledge_event': { namespace: 'narrative', definition: 'KnowledgeEvent' },
  'narrative.reveal_event': { namespace: 'narrative', definition: 'RevealEvent' },
  'game.system': { namespace: 'game_design', definition: 'GameDesign' },
  'game.rule': { namespace: 'game_design', definition: 'GameDesign' },
  'game.skill': { namespace: 'game_design', definition: 'GameDesign' },
  'game.item': { namespace: 'game_design', definition: 'GameDesign' },
  'game.parameter': { namespace: 'game_design', definition: 'GameDesign' },
  'game.observation': { namespace: 'game_design', definition: 'GameObservation' },
};
export const commonKinds = new Set(['document', 'decision', 'world.fact', 'location', 'item']);

export class SchemaValidator {
  private readonly ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true, validateFormats: true, ownProperties: true });

  constructor(bundle: object = schema, private readonly bundleId: string = coreSchemaId) {
    const addFormats = formats as unknown as (ajv: Ajv2020) => void;
    addFormats(this.ajv);
    this.ajv.addSchema(bundle);
  }

  validate(definition: string, value: unknown, path: string, basePointer = ''): Diagnostic[] {
    const validate = this.ajv.getSchema(`${this.bundleId}#/$defs/${definition}`);
    if (!validate) throw new Error(`Unknown schema definition: ${definition}`);
    if (validate(value)) return [];
    return (validate.errors ?? []).map(error => {
      const property: unknown = error.params['missingProperty'] ?? error.params['additionalProperty'];
      const suffix = typeof property === 'string' ? `/${property.replace(/~/g, '~0').replace(/\//g, '~1')}` : '';
      return { code: 'SCHEMA_INVALID', message: `${error.message ?? 'Invalid value'} (${error.schemaPath})`, severity: 'error', path, pointer: basePointer + error.instancePath + suffix };
    });
  }

  addCustom(schemaValue: object): void {
    this.ajv.addSchema(schemaValue);
    const id = (schemaValue as { $id?: string }).$id;
    if (!id || !this.ajv.getSchema(id)) throw new Error('Custom schema needs a unique $id');
  }

  validateCustom(schemaId: string, value: unknown, path: string, pointer: string): Diagnostic[] {
    const validate = this.ajv.getSchema(schemaId);
    if (!validate) throw new Error(`Custom schema is not registered: ${schemaId}`);
    return validate(value) ? [] : (validate.errors ?? []).map(error => ({ code: 'EXTENSION_INVALID', message: error.message ?? 'Invalid custom extension', severity: 'error', path, pointer: pointer + error.instancePath }));
  }
}

export function extractReferences(value: unknown, declarations: readonly string[], path: string, prefix = ''): LocatedReference[] {
  const result: LocatedReference[] = [];
  for (const declaration of declarations) {
    if (!/^\/(?:[^/~*]+|~[01]|\*)(?:\/(?:[^/~*]+|~[01]|\*))*$/.test(declaration)) throw new Error(`Invalid reference path: ${declaration}`);
    const segments = declaration.slice(1).split('/');
    const walk = (current: unknown, index: number, pointer: string): void => {
      if (current === undefined) return;
      if (index === segments.length) {
        result.push({ value: current as Reference, path, pointer: prefix + pointer });
        return;
      }
      if (!current || typeof current !== 'object') return;
      const segment = segments[index]!;
      if (segment === '*') {
        for (const [key, nested] of Object.entries(current)) walk(nested, index + 1, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      } else {
        walk((current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')], index + 1, `${pointer}/${segment}`);
      }
    };
    walk(value, 0, '');
  }
  return result;
}
