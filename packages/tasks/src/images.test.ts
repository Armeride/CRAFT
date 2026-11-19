import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  indexFixture,
  removeIndexFixture,
} from "../../indexer/src/test-helpers.js";
import { loadProject } from "../../project-fs/src/project.js";
import { IntegrationService } from "./integration.js";
import { ManualService } from "./manual.js";
import { registerLocal } from "./projects.js";
import { TaskService } from "./service.js";
import { resumeContext } from "./resume-context.js";

function pngChunk(type: string, content: Buffer): Buffer {
  const data = Buffer.concat([Buffer.from(type), content]);
  const header = Buffer.alloc(4),
    trailer = Buffer.alloc(4);
  header.writeUInt32BE(content.length);
  trailer.writeUInt32BE(crc32(data));
  return Buffer.concat([header, data, trailer]);
}

it("preserves an attached PNG through Git recovery, document approval and integration", async () => {
  const f = await indexFixture();
  try {
    const registration = await registerLocal(f.app, f.root),
      tasks = new TaskService(f.app);
    const run = await tasks.start(registration.id, {
      goal: "Document an illustration",
    });
    const size = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const data = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", size),
      pngChunk("IDAT", deflateSync(Buffer.from([0, 122, 34, 52]))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    const original = "Opening paragraph with preserved spacing  \n";
    await tasks.saveDraft(run.runId, "ui-draft.md", original, null);
    const snapshot = await tasks.project(run.runId),
      draftPath = `tasks/${run.taskId}/working/ui-draft.md`;
    const corrupted = Buffer.from(data);
    corrupted[42] = corrupted[42]! ^ 1;
    const digest = snapshot.files.get(draftPath)!.digest;
    await expect(
      tasks.attachImage(
        run.runId,
        corrupted.toString("base64"),
        "Opening illustration",
        digest,
      ),
    ).rejects.toThrow();
    await expect(
      tasks.attachImage(
        run.runId,
        data.toString("base64"),
        "Opening illustration",
        null,
      ),
    ).rejects.toThrow();
    const attached = await tasks.attachImage(
      run.runId,
      data.toString("base64"),
      "Opening illustration",
      digest,
    );
    expect(attached.path).toMatch(/^assets\/craft\/[a-f0-9]{64}\.png$/);
    const previous = (await tasks.run(run.runId)).run;
    const home = join(f.home, "recovered");
    const recovered = await registerLocal(home, f.root);
    const manual = new ManualService(home);
    const restored = await manual.tasks.resume(
      recovered.id,
      run.taskId,
      "refs/heads/" + previous.branch,
      previous.headCommit!,
    );
    const saved = await manual.tasks.project(restored.runId);
    const body = saved.files.get(draftPath)!.text!;
    expect(body).toBe(
      original + `\n![Opening illustration](${attached.path})\n`,
    );
    expect(saved.files.get(attached.path)!.contentBase64).toBe(
      data.toString("base64"),
    );
    const created = await manual.execute(
      restored.runId,
      (await manual.inspect(restored.runId)).snapshot,
      randomUUID(),
      {
        type: "revision",
        value: {
          title: "Illustrated rules",
          status: "approved",
          body,
          scope: {},
          references: [],
          extensions: {},
          tags: [],
          baselineId: "baseline_main",
          select: true,
        },
      },
    );
    await manual.execute(
      restored.runId,
      (await manual.inspect(restored.runId)).snapshot,
      randomUUID(),
      {
        type: "review",
        entityId: created.entityId!,
        revisionId: created.revisionId!,
        outcome: "accepted",
      },
    );
    const integrations = new IntegrationService(home);
    const prepared = await integrations.prepare(restored.runId, randomUUID(), [
      created.proposalId!,
    ]);
    expect(prepared.diff).toContain(attached.path);
    expect((await integrations.apply(prepared.id, prepared.token)).state).toBe(
      "applied",
    );
    expect(await readFile(join(f.root, attached.path))).toEqual(data);
    const project = await loadProject(f.root);
    expect(
      project.baselines.get("baseline_main")!.value.selected[created.entityId!],
    ).toBe(created.revisionId);
    expect(
      project.entities
        .get(created.entityId!)!
        .revisions.get(created.revisionId!)!.body,
    ).toBe(body);
    expect(
      (await resumeContext(tasks, run.runId)).changedInputs,
    ).toContainEqual({
      entityId: created.entityId,
      preservedRevision: null,
      currentRevision: created.revisionId,
    });
  } finally {
    await removeIndexFixture(f);
  }
}, 120_000);
