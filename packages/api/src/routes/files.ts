import { AppError } from "@schoolapp/core";
import type { SchoolappApi } from "../types";
import { requireUser } from "../auth-middleware";
import { uuidRouteParam, withSchoolActor } from "../school-context";
import {
  authorizeStoredObjectDownload,
  downloadHeaders,
  loadObjectBytes,
  loadStoredObject,
  storageErrorToAppError,
  storageOf,
  writeFileAudit,
} from "../file-service";

export function registerFileRoutes(app: SchoolappApi) {
  app.get("/files/:id", requireUser, async (c) =>
    withSchoolActor(c, async ({ client, actor, orgId, userId }) => {
      const id = uuidRouteParam(c, "id");
      const object = await loadStoredObject(client, orgId, id);
      if (!object || object.status !== "active") {
        throw new AppError(404, "not_found", "Not found");
      }
      await authorizeStoredObjectDownload(client, actor, object);
      try {
        const got = await loadObjectBytes(storageOf(c), object);
        await writeFileAudit(client, {
          organisationId: orgId,
          actorUserId: userId,
          action: "file.download",
          objectId: object.id,
          domain: object.domain,
          filename: object.domain === "safeguarding" ? null : object.original_filename,
        });
        const headers = downloadHeaders(object);
        return new Response(Buffer.from(got.body), {
          status: 200,
          headers: {
            ...headers,
            "Content-Length": String(got.byteSize),
          },
        });
      } catch (error) {
        throw storageErrorToAppError(error);
      }
    }),
  );
}
