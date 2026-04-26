/**
 * @deprecated — Use documentSets.service.ts (Phase 3.8) instead.
 * This file re-exports for backward compatibility.
 */
export {
  createDocumentSet,
  getDocumentSets as listDocumentSets,
  getDocumentSetById as getDocumentSet,
  updateDocumentSet,
  deleteDocumentSet,
  addDocumentsToSet as addDocumentToSet,
  removeDocumentFromSet,
  getDocumentSetMembers as getDocumentsInSet,
} from "./documentSets.service.js";
