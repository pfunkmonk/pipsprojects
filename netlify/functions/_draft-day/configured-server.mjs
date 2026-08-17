import { createBlobRepository } from "./store.mjs";
import { createDraftDayService } from "./service.mjs";
import { createDraftDayHttpHandlers } from "./http-handlers.mjs";

const repository = createBlobRepository();
const service = createDraftDayService({ repository });
export const handlers = createDraftDayHttpHandlers({ service });

