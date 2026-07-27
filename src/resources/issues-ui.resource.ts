/**
 * Linear Issues UI Resource
 *
 * A dark, minimalistic Linear-style interface for viewing and managing issues.
 * Uses JSON-RPC over postMessage (SEP-1865) to communicate with the host.
 */

import type { ReadResourceResult } from '@modelcontextprotocol/server';

export const issuesUIMetadata = {
  name: 'Linear Issues',
  uri: 'ui://linear/issues',
  description: 'Interactive Linear issues dashboard',
  mimeType: 'text/html',
};

const issuesHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Linear Issues</title>
  
  <!-- Inter Font (Linear uses it) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --bg-primary: #0a0a0a;
      --bg-secondary: #141414;
      --bg-tertiary: #1a1a1a;
      --bg-hover: #1f1f1f;
      --bg-active: #262626;
      --bg-selected: rgba(99, 102, 241, 0.12);
      --border: #2a2a2a;
      --border-subtle: #1f1f1f;
      --text-primary: #ebebeb;
      --text-secondary: #8a8a8a;
      --text-tertiary: #525252;
      --accent-purple: #6366f1;
      --accent-blue: #3b82f6;
      --accent-green: #10b981;
      --accent-yellow: #f59e0b;
      --accent-orange: #f97316;
      --accent-red: #ef4444;
      --priority-urgent: #ef4444;
      --priority-high: #f97316;
      --priority-medium: #f59e0b;
      --priority-low: #525252;
      --priority-none: #3a3a3a;
      --state-done: #10b981;
      --state-in-progress: #6366f1;
      --state-todo: #8a8a8a;
      --state-backlog: #525252;
      --state-cancelled: #ef4444;
      --state-triage: #f59e0b;
    }

    /* Comprehensive CSS Reset for Tauri Webview */
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html {
      font-size: 13px;
      -webkit-text-size-adjust: 100%;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 13px;
      line-height: 1.5;
      min-height: 100vh;
    }

    /* Reset form elements for consistent cross-platform styling */
    button, input, select, textarea {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      color: inherit;
      margin: 0;
    }

    button {
      cursor: pointer;
      background: none;
      border: none;
    }

    select {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a0a0a0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      padding-right: 28px !important;
    }

    select option {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      padding: 8px;
    }

    /* Remove default focus outlines, we'll add our own */
    :focus {
      outline: none;
    }

    :focus-visible {
      outline: 2px solid var(--accent-purple);
      outline-offset: 2px;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    ul, ol {
      list-style: none;
    }

    img, svg {
      display: block;
      max-width: 100%;
    }

    table {
      border-collapse: collapse;
      border-spacing: 0;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      position: sticky;
      top: 0;
      z-index: 20;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary);
    }

    /* Linear's actual logo */
    .logo svg {
      width: 16px;
      height: 16px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
      background: transparent;
      color: var(--text-tertiary);
    }

    .status-badge.loading {
      color: var(--accent-yellow);
    }

    .status-badge.ready {
      color: var(--state-done);
    }

    .status-badge.error {
      color: var(--accent-red);
    }

    /* Search */
    .search-wrapper {
      position: relative;
    }

    .search-input {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px 5px 28px;
      color: var(--text-primary);
      font-size: 12px;
      width: 180px;
      transition: all 0.15s ease;
    }

    .search-input::placeholder {
      color: var(--text-tertiary);
    }

    .search-input:focus {
      border-color: var(--accent-purple);
      width: 240px;
    }

    .search-icon {
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-tertiary);
      width: 14px;
      height: 14px;
      pointer-events: none;
    }

    /* Filters */
    .filters {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-primary);
    }

    .filter-select {
      background: var(--bg-tertiary);
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 8px;
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
      min-width: 100px;
      transition: all 0.1s ease;
    }

    .filter-select:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .filter-select:focus {
      outline: none;
      border-color: var(--accent-purple);
    }

    .filter-btn {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 10px;
      color: var(--text-secondary);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.1s ease;
    }

    .filter-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .filter-btn.active {
      background: var(--accent-purple);
      color: white;
    }

    .filter-divider {
      width: 1px;
      height: 16px;
      background: var(--border);
      margin: 0 4px;
    }

    .kbd-hint {
      font-size: 10px;
      color: var(--text-tertiary);
      margin-left: auto;
      display: flex;
      gap: 8px;
    }

    .kbd {
      padding: 1px 4px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      font-family: ui-monospace, monospace;
    }

    /* Issues List */
    .issues-container {
      padding: 0;
    }

    .issues-header {
      display: grid;
      grid-template-columns: 24px 28px 72px 1fr 110px 90px 70px;
      gap: 6px;
      padding: 6px 12px;
      font-size: 10px;
      font-weight: 500;
      color: var(--text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .issue-row {
      display: grid;
      grid-template-columns: 24px 28px 72px 1fr 110px 90px 70px;
      gap: 6px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: background 0.08s ease;
      align-items: center;
      min-height: 36px;
    }

    .issue-row:hover {
      background: var(--bg-hover);
    }

    .issue-row:hover .issue-actions {
      opacity: 1;
    }

    .issue-row.selected {
      background: var(--bg-selected);
    }

    .issue-row.focused {
      outline: 1px solid var(--accent-purple);
      outline-offset: -1px;
    }

    /* Priority Icon (Linear-style bars) */
    .priority-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
    }

    .priority-icon svg {
      width: 14px;
      height: 14px;
    }

    .priority-icon.urgent svg { color: var(--priority-urgent); }
    .priority-icon.high svg { color: var(--priority-high); }
    .priority-icon.medium svg { color: var(--priority-medium); }
    .priority-icon.low svg { color: var(--priority-low); }
    .priority-icon.none svg { color: var(--priority-none); }

    /* State Icon (Linear-style) */
    .state-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
    }

    .state-icon svg {
      width: 14px;
      height: 14px;
    }

    .state-icon.done svg { color: var(--state-done); }
    .state-icon.in-progress svg { color: var(--state-in-progress); }
    .state-icon.todo svg { color: var(--state-todo); }
    .state-icon.backlog svg { color: var(--state-backlog); }
    .state-icon.cancelled svg { color: var(--state-cancelled); }
    .state-icon.triage svg { color: var(--state-triage); }

    .issue-id {
      color: var(--text-secondary);
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 11px;
      font-weight: 500;
    }

    .issue-title {
      color: var(--text-primary);
      font-weight: 400;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .issue-title-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Labels as small pills */
    .issue-labels {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .label-pill {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .issue-state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .issue-assignee {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-secondary);
      font-size: 12px;
    }

    .assignee-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 600;
      color: white;
      flex-shrink: 0;
    }

    /* Avatar colors based on name hash */
    .avatar-1 { background: #6366f1; }
    .avatar-2 { background: #10b981; }
    .avatar-3 { background: #f59e0b; }
    .avatar-4 { background: #ef4444; }
    .avatar-5 { background: #8b5cf6; }
    .avatar-6 { background: #3b82f6; }
    .avatar-7 { background: #ec4899; }
    .avatar-8 { background: #14b8a6; }

    .assignee-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .issue-date {
      color: var(--text-tertiary);
      font-size: 11px;
    }

    .issue-date.overdue {
      color: var(--accent-red);
    }

    /* Hover actions */
    .issue-actions {
      opacity: 0;
      display: flex;
      gap: 4px;
      transition: opacity 0.1s ease;
    }

    .issue-action-btn {
      padding: 4px;
      border-radius: 4px;
      color: var(--text-tertiary);
      transition: all 0.1s ease;
    }

    .issue-action-btn:hover {
      background: var(--bg-active);
      color: var(--text-primary);
    }

    .issue-action-btn svg {
      width: 14px;
      height: 14px;
    }

    /* Empty State */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state h3 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
      color: var(--text-primary);
    }

    .empty-state p {
      font-size: 13px;
      color: var(--text-tertiary);
    }

    /* Issue Detail Panel */
    .detail-panel {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 380px;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border);
      transform: translateX(100%);
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      overflow-y: auto;
      z-index: 100;
      display: flex;
      flex-direction: column;
    }

    .detail-panel.open {
      transform: translateX(0);
    }

    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .detail-header-id {
      font-family: ui-monospace, 'SF Mono', monospace;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .detail-close {
      background: none;
      border: none;
      color: var(--text-tertiary);
      cursor: pointer;
      padding: 6px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.1s ease;
    }

    .detail-close:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .detail-close svg {
      width: 16px;
      height: 16px;
    }

    .detail-content {
      padding: 16px;
      flex: 1;
    }

    .detail-title {
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 20px;
      line-height: 1.5;
      color: var(--text-primary);
    }

    .detail-meta {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .meta-row {
      display: grid;
      grid-template-columns: 80px 1fr;
      align-items: center;
      gap: 12px;
    }

    .meta-label {
      color: var(--text-tertiary);
      font-size: 12px;
    }

    .meta-value {
      color: var(--text-secondary);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .meta-value .state-icon {
      width: 14px;
      height: 14px;
    }

    .detail-description {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }

    .detail-description h4 {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-tertiary);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .detail-description p {
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
      white-space: pre-wrap;
    }

    .detail-description p:empty::before {
      content: 'No description';
      color: var(--text-tertiary);
      font-style: italic;
    }

    /* Actions */
    .detail-actions {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-primary);
    }

    .action-btn {
      flex: 1;
      padding: 7px 12px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.1s ease;
      border: 1px solid var(--border);
      background: var(--bg-tertiary);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .action-btn:hover {
      background: var(--bg-hover);
      border-color: var(--text-tertiary);
    }

    .action-btn:active {
      transform: scale(0.98);
    }

    .action-btn svg {
      width: 14px;
      height: 14px;
    }

    .action-btn.primary {
      background: var(--accent-purple);
      border-color: var(--accent-purple);
      color: white;
    }

    .action-btn.primary:hover {
      background: #5558e3;
      border-color: #5558e3;
    }

    .action-btn.success {
      background: var(--state-done);
      border-color: var(--state-done);
      color: white;
    }

    .action-btn.success:hover {
      background: #059669;
      border-color: #059669;
    }

    /* Loading */
    .loading-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--accent-purple);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-tertiary);
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 13px;
      z-index: 200;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.2s ease;
    }

    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    .toast.success {
      border-color: var(--accent-green);
    }

    .toast.error {
      border-color: var(--accent-red);
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <div class="logo">
        <!-- Linear Logo -->
        <svg viewBox="0 0 100 100" fill="currentColor">
          <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5765C16.5721 92.5195 2.09706 76.4302 1.22541 61.5228zM.00189135 46.8891c-.01764375.2833.00603395.5765.07376.8619.205.8638.82578 1.5116 1.63628 1.7339L40.3954 60.6564c1.2345.3381 2.4084-.6988 2.0702-1.9334L31.2948 19.0399c-.2228-.8117-.8714-1.4393-1.7014-1.6439-.2854-.0706-.5797-.0883-.8651-.0529L1.38531 21.0465c-.28318.0353-.56314.1095-.82867.2218-.31225.1321-.59689.3241-.83812.5668l-.00004.00006-.00009.00008C.247523 22.4173-.021444 23.0478.002851 23.7188l-.001959624 23.1703zM54.0982 60.8691c-.1303 1.2354.9824 2.2045 2.1908 1.906L97.4255 51.5279c.8143-.201 1.4339-.8845 1.5736-1.7142.0456-.2708.0456-.5468 0-.8176L87.7612 9.56516c-.1347-.79909-.748-1.43915-1.5627-1.6319-.8146-.19284-1.6744.04946-2.1896.61642L54.1568 41.3813c-.3813.4196-.6048.9515-.6586 1.5075l-.4 17.9803z"/>
        </svg>
        Issues
      </div>
    </div>
    <div class="header-right">
      <div class="search-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="text" class="search-input" placeholder="Search issues..." id="search-input">
      </div>
      <span id="status" class="status-badge">Connecting</span>
    </div>
    </div>
    <div id="issue-count" style="color: var(--text-tertiary); font-size: 12px;"></div>
  </header>

  <!-- Filters -->
  <div class="filters">
    <select id="team-filter" class="filter-select">
      <option value="">All Teams</option>
    </select>
    <select id="state-filter" class="filter-select">
      <option value="">All States</option>
      <option value="started">In Progress</option>
      <option value="unstarted">Todo</option>
      <option value="backlog">Backlog</option>
      <option value="completed">Done</option>
      <option value="cancelled">Cancelled</option>
    </select>
    <div class="filter-divider"></div>
    <button id="my-issues-btn" class="filter-btn">My Issues</button>
    <button id="refresh-btn" class="filter-btn">↻ Refresh</button>
    <div class="kbd-hint">
      <span><kbd class="kbd">j</kbd>/<kbd class="kbd">k</kbd> navigate</span>
      <span><kbd class="kbd">↵</kbd> open</span>
      <span><kbd class="kbd">esc</kbd> close</span>
    </div>
  </div>

  <!-- Issues List -->
  <div class="issues-container">
    <div class="issues-header">
      <div></div>
      <div></div>
      <div>ID</div>
      <div>Title</div>
      <div>State</div>
      <div>Assignee</div>
      <div>Updated</div>
    </div>
    <div id="issues-list">
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <h3>No issues found</h3>
        <p>Try adjusting your filters</p>
      </div>
    </div>
  </div>

  <!-- Detail Panel -->
  <div id="detail-panel" class="detail-panel">
    <div class="detail-header">
      <span id="detail-id" class="issue-id"></span>
      <button class="detail-close" onclick="closeDetail()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
    <div class="detail-content">
      <h2 id="detail-title" class="detail-title"></h2>
      <div class="detail-meta">
        <div class="meta-row">
          <span class="meta-label">Status</span>
          <span id="detail-state" class="meta-value"></span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Priority</span>
          <span id="detail-priority" class="meta-value"></span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Assignee</span>
          <span id="detail-assignee" class="meta-value"></span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Project</span>
          <span id="detail-project" class="meta-value"></span>
        </div>
      </div>
      <div class="detail-description">
        <h4>Description</h4>
        <p id="detail-desc">No description</p>
      </div>
      <div class="detail-actions">
        <button class="action-btn" onclick="updateIssueState('started')">Start</button>
        <button class="action-btn success" onclick="updateIssueState('completed')">Complete</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast" class="toast"></div>

  <script>
    // ═══════════════════════════════════════════════════════════════════════
    // JSON-RPC 2.0 Protocol Implementation (SEP-1865)
    // ═══════════════════════════════════════════════════════════════════════
    
    const PROTOCOL_VERSION = '2025-11-21';
    let requestId = 0;
    let initialized = false;
    let hostContext = null;
    const pendingRequests = new Map();
    
    // State
    let issues = [];
    let teams = [];
    let workflowStates = {};
    let selectedIssue = null;
    let viewerId = null;
    let currentFilters = { teamId: '', stateType: '', assignedToMe: false };
    let searchQuery = '';
    let focusedIndex = -1;
    
    // ─────────────────────────────────────────────────────────────────────────
    // JSON-RPC Core
    // ─────────────────────────────────────────────────────────────────────────
    
    function sendMessage(message) {
      window.parent.postMessage(message, '*');
    }
    
    function sendRequest(method, params) {
      return new Promise((resolve, reject) => {
        const id = requestId++;
        const request = { jsonrpc: '2.0', id, method, params };
        pendingRequests.set(id, { resolve, reject });
        sendMessage(request);
        setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(\`Request \${method} timed out\`));
          }
        }, 30000);
      });
    }
    
    function sendNotification(method, params) {
      sendMessage({ jsonrpc: '2.0', method, params });
    }
    
    function handleMessage(event) {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.jsonrpc !== '2.0') return;
      
      if ('id' in data && (data.result !== undefined || data.error !== undefined)) {
        const pending = pendingRequests.get(data.id);
        if (pending) {
          pendingRequests.delete(data.id);
          if (data.error) {
            pending.reject(new Error(data.error.message || 'Unknown error'));
          } else {
            pending.resolve(data.result);
          }
        }
        return;
      }
      
      if (data.method) {
        handleNotification(data.method, data.params);
      }
    }
    
    function handleNotification(method, params) {
      switch (method) {
        case 'ui/notifications/tool-result':
          if (params?.structuredContent || params?.content) {
            handleToolResult(params);
          }
          break;
        case 'ui/notifications/host-context-changed':
          // Theme updates (we're always dark, but could react if needed)
          break;
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // UI Helpers
    // ─────────────────────────────────────────────────────────────────────────
    
    function setStatus(text, type = 'default') {
      const el = document.getElementById('status');
      el.textContent = text;
      el.className = 'status-badge ' + type;
    }
    
    function showToast(message, type = 'default') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
    
    function formatDate(dateStr) {
      if (!dateStr) return '—';
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return \`\${diffDays}d ago\`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    function getPriorityClass(priority) {
      switch (priority) {
        case 1: return 'urgent';
        case 2: return 'high';
        case 3: return 'medium';
        case 4: return 'low';
        default: return 'none';
      }
    }
    
    function getPriorityLabel(priority) {
      switch (priority) {
        case 1: return 'Urgent';
        case 2: return 'High';
        case 3: return 'Medium';
        case 4: return 'Low';
        default: return 'None';
      }
    }
    
    function getStateClass(stateType) {
      return stateType || 'backlog';
    }
    
    function getInitials(name) {
      if (!name) return '?';
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────────────────────────────
    
    function getStateName(issue) {
      // API returns flat stateName, or nested state.name
      return issue.stateName || issue.state?.name || 'Unknown';
    }
    
    function getStateType(issue) {
      // Try to get state type from workflowStates cache, or from nested state.type
      if (issue.state?.type) return issue.state.type;
      if (issue.stateId && Object.keys(workflowStates).length > 0) {
        for (const teamStates of Object.values(workflowStates)) {
          const found = teamStates.find(s => s.id === issue.stateId);
          if (found) return found.type;
        }
      }
      // Infer from state name if available
      const name = getStateName(issue).toLowerCase();
      if (name.includes('done') || name.includes('complete')) return 'completed';
      if (name.includes('progress') || name.includes('started') || name.includes('review')) return 'started';
      if (name.includes('cancel')) return 'cancelled';
      if (name.includes('backlog')) return 'backlog';
      return 'unstarted';
    }
    
    function getAssigneeName(issue) {
      // API returns flat assigneeName, or nested assignee.name
      return issue.assigneeName || issue.assignee?.name || null;
    }
    
    function getProjectName(issue) {
      return issue.projectName || issue.project?.name || null;
    }
    
    // Linear-style state icons
    function getStateIcon(stateType) {
      switch (stateType) {
        case 'done':
        case 'completed':
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M5 7l2 2 3-3" stroke="#0a0a0a" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        case 'in-progress':
        case 'started':
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
        case 'todo':
        case 'unstarted':
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
        case 'backlog':
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="3 2"/></svg>';
        case 'cancelled':
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        case 'triage':
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="7" cy="7" r="2" fill="currentColor"/></svg>';
        default:
          return '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
      }
    }

    // Linear-style priority icons
    function getPriorityIcon(priority) {
      const bars = priority === 0 ? 0 : priority === 4 ? 1 : priority === 3 ? 2 : priority === 2 ? 3 : 4;
      return '<svg viewBox="0 0 14 14"><rect x="1" y="9" width="2" height="4" rx="0.5" fill="currentColor" opacity="' + (bars >= 1 ? 1 : 0.2) + '"/><rect x="4" y="6" width="2" height="7" rx="0.5" fill="currentColor" opacity="' + (bars >= 2 ? 1 : 0.2) + '"/><rect x="7" y="3" width="2" height="10" rx="0.5" fill="currentColor" opacity="' + (bars >= 3 ? 1 : 0.2) + '"/><rect x="10" y="1" width="2" height="12" rx="0.5" fill="currentColor" opacity="' + (bars >= 4 ? 1 : 0.2) + '"/></svg>';
    }

    // Get avatar color based on name hash
    function getAvatarClass(name) {
      if (!name) return 'avatar-1';
      const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return 'avatar-' + ((hash % 8) + 1);
    }

    function renderIssues() {
      const container = document.getElementById('issues-list');
      const countEl = document.getElementById('issue-count');
      const filteredIssues = getFilteredIssues();
      
      if (!filteredIssues.length) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <h3>No issues found</h3>
            <p>Try adjusting your filters or search</p>
          </div>
        \`;
        countEl.textContent = '';
        return;
      }
      
      countEl.textContent = \`\${filteredIssues.length} issue\${filteredIssues.length === 1 ? '' : 's'}\`;
      
      container.innerHTML = filteredIssues.map((issue, index) => {
        const stateName = getStateName(issue);
        const stateType = getStateType(issue);
        const assigneeName = getAssigneeName(issue);
        const priorityClass = getPriorityClass(issue.priority);
        const stateClass = getStateClass(stateType);
        
        return \`
          <div class="issue-row" data-id="\${issue.id}" data-index="\${index}" tabindex="0">
            <div class="priority-icon \${priorityClass}" title="\${getPriorityLabel(issue.priority)}">
              \${getPriorityIcon(issue.priority)}
            </div>
            <div class="state-icon \${stateClass}" title="\${stateName}">
              \${getStateIcon(stateType)}
            </div>
            <div class="issue-id">\${issue.identifier || issue.id.slice(0, 8)}</div>
            <div class="issue-title">
              <span class="issue-title-text">\${escapeHtml(issue.title)}</span>
            </div>
            <div class="issue-state">
              <span>\${stateName}</span>
            </div>
            <div class="issue-assignee">
              \${assigneeName ? \`
                <span class="assignee-avatar \${getAvatarClass(assigneeName)}">\${getInitials(assigneeName)}</span>
                <span class="assignee-name">\${assigneeName.split(' ')[0]}</span>
              \` : '<span style="color: var(--text-tertiary)">—</span>'}
            </div>
            <div class="issue-date \${isOverdue(issue) ? 'overdue' : ''}">\${formatDate(issue.updatedAt)}</div>
          </div>
        \`;
      }).join('');

      // Add click handlers
      container.querySelectorAll('.issue-row').forEach(row => {
        row.addEventListener('click', () => selectIssue(row.dataset.id));
      });
    }

    // Check if issue is overdue
    function isOverdue(issue) {
      if (!issue.dueDate) return false;
      return new Date(issue.dueDate) < new Date() && getStateType(issue) !== 'done';
    }

    // Filter issues by search
    function getFilteredIssues() {
      const searchTerm = searchQuery.toLowerCase();
      if (!searchTerm) return issues;
      return issues.filter(issue => 
        (issue.title?.toLowerCase().includes(searchTerm)) ||
        (issue.identifier?.toLowerCase().includes(searchTerm)) ||
        (getAssigneeName(issue)?.toLowerCase().includes(searchTerm))
      );
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function renderTeamFilter() {
      const select = document.getElementById('team-filter');
      select.innerHTML = '<option value="">All Teams</option>' +
        teams.map(t => \`<option value="\${t.id}">\${escapeHtml(t.name)}</option>\`).join('');
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Issue Detail
    // ─────────────────────────────────────────────────────────────────────────
    
    function selectIssue(id) {
      selectedIssue = issues.find(i => i.id === id);
      if (!selectedIssue) return;
      
      document.querySelectorAll('.issue-row').forEach(row => {
        row.classList.toggle('selected', row.dataset.id === id);
      });
      
      const stateName = getStateName(selectedIssue);
      const assigneeName = getAssigneeName(selectedIssue);
      const projectName = getProjectName(selectedIssue);
      
      document.getElementById('detail-id').textContent = selectedIssue.identifier || id.slice(0, 8);
      document.getElementById('detail-title').textContent = selectedIssue.title;
      document.getElementById('detail-state').textContent = stateName;
      document.getElementById('detail-priority').textContent = getPriorityLabel(selectedIssue.priority);
      document.getElementById('detail-assignee').textContent = assigneeName || 'Unassigned';
      document.getElementById('detail-project').textContent = projectName || 'None';
      document.getElementById('detail-desc').textContent = selectedIssue.description || 'No description';
      
      document.getElementById('detail-panel').classList.add('open');
      
      // Update model context with selected issue
      updateModelContext();
    }
    
    function closeDetail() {
      document.getElementById('detail-panel').classList.remove('open');
      document.querySelectorAll('.issue-row.selected').forEach(row => row.classList.remove('selected'));
      selectedIssue = null;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Actions
    // ─────────────────────────────────────────────────────────────────────────
    
    async function callTool(name, args) {
      const result = await sendRequest('tools/call', { name, arguments: args });
      return result;
    }
    
    async function loadWorkspaceMetadata() {
      setStatus('Loading...', 'loading');
      try {
        const result = await callTool('workspace_metadata', { include: ['profile', 'teams', 'workflow_states'] });
        const data = result?.structuredContent || result;
        
        if (data?.viewer) {
          viewerId = data.viewer.id;
        }
        if (data?.teams) {
          teams = data.teams;
          renderTeamFilter();
        }
        if (data?.workflowStatesByTeam) {
          workflowStates = data.workflowStatesByTeam;
        }
        
        setStatus('Ready', 'ready');
        return data;
      } catch (e) {
        setStatus('Error', 'error');
        showToast('Failed to load workspace: ' + e.message, 'error');
        throw e;
      }
    }
    
    async function loadIssues() {
      setStatus('Loading...', 'loading');
      try {
        const args = {
          limit: 50,
          orderBy: 'updatedAt',
          detail: 'standard',
        };
        
        if (currentFilters.teamId) {
          args.teamId = currentFilters.teamId;
        }
        if (currentFilters.stateType) {
          args.filter = { state: { type: { eq: currentFilters.stateType } } };
        }
        if (currentFilters.assignedToMe && viewerId) {
          args.assignedToMe = true;
        }
        
        const result = await callTool('list_issues', args);
        const data = result?.structuredContent || result;
        
        issues = data?.items || [];
        renderIssues();
        setStatus('Ready', 'ready');
        
        // Update model context
        updateModelContext();
      } catch (e) {
        setStatus('Error', 'error');
        showToast('Failed to load issues: ' + e.message, 'error');
      }
    }
    
    async function updateIssueState(stateType) {
      if (!selectedIssue) return;
      
      try {
        setStatus('Updating...', 'loading');
        await callTool('update_issues', {
          items: [{ id: selectedIssue.id, stateType }]
        });
        
        showToast('Issue updated', 'success');
        closeDetail();
        await loadIssues();
      } catch (e) {
        setStatus('Error', 'error');
        showToast('Failed to update: ' + e.message, 'error');
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Model Context (SEP-1865)
    // ─────────────────────────────────────────────────────────────────────────
    
    async function updateModelContext() {
      try {
        const stateName = selectedIssue ? getStateName(selectedIssue) : null;
        const contextText = selectedIssue
          ? \`Viewing Linear issue \${selectedIssue.identifier}: "\${selectedIssue.title}" (Status: \${stateName}, Priority: \${getPriorityLabel(selectedIssue.priority)})\`
          : \`Viewing \${issues.length} Linear issues. Filters: \${currentFilters.teamId ? 'Team filtered' : 'All teams'}, \${currentFilters.assignedToMe ? 'My issues' : 'All assignees'}.\`;
        
        await sendRequest('ui/update-model-context', {
          content: [{ type: 'text', text: contextText }],
          structuredContent: {
            issueCount: issues.length,
            selectedIssue: selectedIssue ? {
              id: selectedIssue.id,
              identifier: selectedIssue.identifier,
              title: selectedIssue.title,
              state: stateName,
              priority: getPriorityLabel(selectedIssue.priority),
            } : null,
            filters: currentFilters,
          }
        });
      } catch (e) {
        console.warn('Failed to update model context:', e);
      }
    }
    
    function handleToolResult(params) {
      // Handle incoming tool results (e.g., from initial tool call)
      const data = params?.structuredContent || params?.content;
      if (data?.items) {
        issues = data.items;
        renderIssues();
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────
    
    document.getElementById('team-filter').addEventListener('change', (e) => {
      currentFilters.teamId = e.target.value;
      loadIssues();
    });
    
    document.getElementById('state-filter').addEventListener('change', (e) => {
      currentFilters.stateType = e.target.value;
      loadIssues();
    });
    
    document.getElementById('my-issues-btn').addEventListener('click', (e) => {
      currentFilters.assignedToMe = !currentFilters.assignedToMe;
      e.target.classList.toggle('active', currentFilters.assignedToMe);
      loadIssues();
    });
    
    document.getElementById('refresh-btn').addEventListener('click', () => {
      loadIssues();
    });

    // Search input
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderIssues();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      // Don't intercept if typing in search
      if (document.activeElement === searchInput) {
        if (e.key === 'Escape') {
          searchInput.blur();
          e.preventDefault();
        }
        return;
      }

      const filteredIssues = getFilteredIssues();
      
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          focusedIndex = Math.min(focusedIndex + 1, filteredIssues.length - 1);
          updateFocus();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          focusedIndex = Math.max(focusedIndex - 1, 0);
          updateFocus();
          break;
        case 'Enter':
          if (focusedIndex >= 0 && filteredIssues[focusedIndex]) {
            selectIssue(filteredIssues[focusedIndex].id);
          }
          break;
        case 'Escape':
          if (selectedIssue) {
            closeDetail();
          } else {
            focusedIndex = -1;
            updateFocus();
          }
          break;
        case '/':
          e.preventDefault();
          searchInput.focus();
          break;
      }
    });

    function updateFocus() {
      document.querySelectorAll('.issue-row').forEach((row, i) => {
        row.classList.toggle('focused', i === focusedIndex);
        if (i === focusedIndex) {
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────────────────────────────────────
    
    async function init() {
      window.addEventListener('message', handleMessage);
      
      try {
        // Initialize with host
        const result = await sendRequest('ui/initialize', {
          protocolVersion: PROTOCOL_VERSION,
          appInfo: { name: 'linear-issues-ui', version: '1.0.0' },
          appCapabilities: {}
        });
        
        hostContext = result?.hostContext;
        initialized = true;
        
        sendNotification('ui/notifications/initialized');
        
        // Report size
        const reportSize = () => {
          sendNotification('ui/notifications/size-changed', {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight
          });
        };
        reportSize();
        new ResizeObserver(reportSize).observe(document.body);
        
        // Load data
        await loadWorkspaceMetadata();
        await loadIssues();
        
      } catch (e) {
        setStatus('Error', 'error');
        console.error('Init failed:', e);
      }
    }
    
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 50));
  </script>
</body>
</html>`;

export const issuesUIResource = {
  name: issuesUIMetadata.name,
  uri: issuesUIMetadata.uri,
  description: issuesUIMetadata.description,
  mimeType: issuesUIMetadata.mimeType,

  handler: async (): Promise<ReadResourceResult> => {
    return {
      contents: [
        {
          uri: issuesUIMetadata.uri,
          mimeType: issuesUIMetadata.mimeType,
          text: issuesHTML,
        },
      ],
    };
  },
};
