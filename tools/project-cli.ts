import { exactRevision, selectedRevision, ValidationFailure } from '../packages/domain/src/model.js';
import { loadProject } from '../packages/project-fs/src/project.js';
import { validateAgainstGit } from '../packages/project-fs/src/git-baseline.js';

const [command, root, first, second] = process.argv.slice(2);
if (!root || !['validate', 'get', 'baseline'].includes(command ?? '') || (command !== 'validate' && (!first || !second))) {
  console.error('Usage: project-cli <validate| get | baseline> <root> [entityId revisionId | baselineId entityId]');
  process.exitCode = 2;
} else {
  try {
    const snapshot = command === 'validate' && first === '--base' && second ? await validateAgainstGit(root, second) : await loadProject(root);
    if (command === 'validate') console.log(JSON.stringify({ project_id: snapshot.project.project_id, snapshot: snapshot.fingerprint, entities: snapshot.entities.size, baselines: snapshot.baselines.size, writable: snapshot.writable, diagnostics: snapshot.diagnostics }, null, 2));
    else {
      const revision = command === 'get' ? exactRevision(snapshot, first!, second!) : selectedRevision(snapshot, first!, second!);
      console.log(JSON.stringify({ snapshot: snapshot.fingerprint, revision: revision.meta, body: revision.body, writable: revision.writable }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify(error instanceof ValidationFailure ? { diagnostics: error.diagnostics } : { error: String(error) }, null, 2));
    process.exitCode = 1;
  }
}
