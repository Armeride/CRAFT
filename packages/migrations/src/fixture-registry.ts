import { MigrationRegistry, productionV1Codec } from './registry.js';
import { fixtureV2Codec } from './fixture-codecs.js';
import { createFixtureStep } from './steps/fixture-v1-v2.js';

export const createFixtureRegistry = async (): Promise<MigrationRegistry> => new MigrationRegistry('craft-migration-fixture').registerCodec(productionV1Codec).registerCodec(fixtureV2Codec).registerStep(await createFixtureStep());
