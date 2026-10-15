/**
 * The MCP parity rule (spec 3.10): every exported service operation is reachable through an MCP
 * tool, or is listed here as exempt with the reason. `test/mcpParity.test.ts` enforces it.
 */

export const TOOL_NAMES = [
  'list_organisations',
  'create_organisation',
  'list_shows',
  'get_show',
  'create_show',
  'update_show',
  'add_show_member',
  'update_show_member',
  'remove_show_member',
  'list_show_members',
  'list_departments',
  'create_department',
  'update_department',
  'list_cues',
  'get_cue',
  'create_cue',
  'update_cue',
  'delete_cues',
  'place_cue_at_text',
  'renumber_cues',
  'list_annotations',
  'get_annotation',
  'create_annotation',
  'update_annotation',
  'delete_annotations',
  'list_documents',
  'get_document',
  'update_document',
  'upload_document',
  'get_page',
  'search_script',
  'get_history',
  'get_activity',
  'revert_change',
  'revert_batch',
  'list_exports',
  'export_marked_script',
  'export_cue_list',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/** Service operation name to the tool that reaches it. Several operations may share one tool. */
export const OPERATION_TO_TOOL: Record<string, ToolName> = {
  listOrganisations: 'list_organisations',
  createOrganisation: 'create_organisation',
  listShows: 'list_shows',
  getShow: 'get_show',
  createShow: 'create_show',
  updateShow: 'update_show',
  addShowMember: 'add_show_member',
  updateShowMember: 'update_show_member',
  removeShowMember: 'remove_show_member',
  listShowMembers: 'list_show_members',
  listDepartments: 'list_departments',
  createDepartment: 'create_department',
  updateDepartment: 'update_department',
  listCues: 'list_cues',
  getCue: 'get_cue',
  createCue: 'create_cue',
  updateCue: 'update_cue',
  deleteCues: 'delete_cues',
  placeCueAtText: 'place_cue_at_text',
  renumberCues: 'renumber_cues',
  listAnnotations: 'list_annotations',
  getAnnotation: 'get_annotation',
  createAnnotation: 'create_annotation',
  updateAnnotation: 'update_annotation',
  deleteAnnotations: 'delete_annotations',
  listDocuments: 'list_documents',
  getDocument: 'get_document',
  getDocumentVersion: 'get_document',
  updateDocument: 'update_document',
  uploadDocumentFromUrl: 'upload_document',
  createDocument: 'upload_document',
  addDocumentVersion: 'upload_document',
  getPage: 'get_page',
  getPageImage: 'get_page',
  searchVersion: 'search_script',
  listHistory: 'get_history',
  activityFeed: 'get_activity',
  revertChange: 'revert_change',
  revertBatch: 'revert_batch',
  listExportRecords: 'list_exports',
  exportMarkedScript: 'export_marked_script',
  exportCueList: 'export_cue_list',
}

const TOKEN_REASON = 'token management stays in the UI so an agent cannot mint credentials'
const GUARD_REASON = 'internal permission guard called inside other operations, not an operation'

/** Exported service functions that are deliberately not MCP tools, with the reason. */
export const UI_ONLY_OPERATIONS: Record<string, string> = {
  createToken: TOKEN_REASON,
  listTokens: TOKEN_REASON,
  revokeToken: TOKEN_REASON,
  logChange: 'internal helper: every write calls it inside its own transaction',
  getShowRole: GUARD_REASON,
  requireShowRole: GUARD_REASON,
  assertShowWritable: GUARD_REASON,
  assertShowAcceptsUploads: GUARD_REASON,
  authenticateToken:
    'auth plumbing: the MCP endpoint itself authenticates the bearer token with it',
  tokenAllowsShow: 'auth plumbing: a pure token scope predicate, not an operation',
  createExportRecord:
    'client-generated exports upload their file over REST; agents export with export_marked_script and export_cue_list, which create the record server side',
}
