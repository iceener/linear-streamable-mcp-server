import { addComments } from './add-comments';
import { createIssues } from './create-issues';
import { createProjects } from './create-projects';
import { getIssues } from './get-issues';
import { listComments } from './list-comments';
import { listCycles } from './list-cycles';
import { listIssues } from './list-issues';
import { listProjects } from './list-projects';
import { listTeams } from './list-teams';
import { listUsers } from './list-users';
import { showIssuesUi } from './show-issues-ui';
import { updateComments } from './update-comments';
import { updateIssues } from './update-issues';
import { updateProjects } from './update-projects';
import { workspaceMetadata } from './workspace-metadata';

/** Every tool, in the order clients list them. The order is part of the published contract. */
export const tools = [
  workspaceMetadata,
  listIssues,
  getIssues,
  createIssues,
  updateIssues,
  listTeams,
  listUsers,
  listComments,
  addComments,
  updateComments,
  listCycles,
  listProjects,
  createProjects,
  updateProjects,
  showIssuesUi,
];
