import { canonicalJson } from '../../domain/src/canonical.js';
import { stateKinds, statePolicy, stateReferencePaths, stateSchema } from '../../state-model/src/contracts.js';
import { hash } from './files.js';

/** A built-in semantic reader contract, never code downloaded from a project. */
export const statePlugin = Object.freeze({ id: 'craft.state-model', version: '1.0.0', digest: hash(canonicalJson({ schema: stateSchema, reference_paths: stateReferencePaths, kinds: stateKinds, policy: statePolicy, interpreter: 'state-model-reader-1' })) });
