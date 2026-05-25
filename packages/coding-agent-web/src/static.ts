export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Pi Web</title>
	<style>
		:root {
			--accent: #16a34a;
			--accent-strong: #15803d;
			--bg: #0b0f0d;
			--panel: #111713;
			--panel-2: #151d18;
			--text: #e7eee9;
			--muted: #93a29a;
			--border: #27342c;
			--danger: #ef4444;
			--shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
		}
		body[data-theme="light"] {
			--bg: #f7faf8;
			--panel: #ffffff;
			--panel-2: #eef6f1;
			--text: #142019;
			--muted: #5c6b62;
			--border: #d6e2da;
			--shadow: 0 18px 50px rgba(20, 32, 25, 0.13);
		}
		* { box-sizing: border-box; }
		html, body { height: 100%; }
		body {
			margin: 0;
			background: var(--bg);
			color: var(--text);
			font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			letter-spacing: 0;
		}
		button, input, select, textarea {
			font: inherit;
			color: inherit;
		}
		button, select, input, textarea {
			border: 1px solid var(--border);
			background: var(--panel);
			border-radius: 8px;
		}
		button {
			min-height: 36px;
			padding: 0 12px;
			cursor: pointer;
		}
		button:hover { border-color: var(--accent); }
		button.primary {
			background: var(--accent);
			border-color: var(--accent);
			color: #06110a;
			font-weight: 650;
		}
		button.danger {
			border-color: var(--danger);
			color: var(--danger);
		}
		button:disabled {
			cursor: not-allowed;
			opacity: 0.45;
		}
		input, select, textarea {
			width: 100%;
			min-height: 36px;
			padding: 7px 9px;
			outline: none;
		}
		input:focus, select:focus, textarea:focus {
			border-color: var(--accent);
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent);
		}
		.app {
			display: grid;
			grid-template-columns: 300px minmax(0, 1fr);
			height: 100vh;
			min-height: 0;
		}
		.sidebar, .rail {
			background: var(--panel);
			border-color: var(--border);
			min-height: 0;
			overflow: auto;
		}
		.sidebar {
			border-right: 1px solid var(--border);
			padding: 14px;
		}
		.rail {
			position: fixed;
			inset: 0 0 0 auto;
			z-index: 24;
			width: min(420px, calc(100vw - 28px));
			border-left: 1px solid var(--border);
			box-shadow: var(--shadow);
			padding: 14px;
			transform: translateX(105%);
			transition: transform 160ms ease;
		}
		body.rail-open .rail {
			transform: translateX(0);
		}
		body.sidebar-collapsed .app {
			grid-template-columns: 0 minmax(0, 1fr);
		}
		body.sidebar-collapsed .sidebar {
			display: none;
		}
		.main {
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			min-width: 0;
			min-height: 0;
		}
		.topbar {
			display: grid;
			grid-template-columns: auto minmax(160px, 1fr) minmax(280px, 1.6fr) 150px auto auto auto auto auto;
			gap: 8px;
			align-items: center;
			padding: 10px 12px;
			border-bottom: 1px solid var(--border);
			background: var(--panel);
		}
		.brand {
			display: flex;
			align-items: center;
			gap: 9px;
			font-weight: 750;
			white-space: nowrap;
		}
		.dot {
			width: 9px;
			height: 9px;
			border-radius: 999px;
			background: var(--accent);
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
		}
		.dot.running {
			background: #f59e0b;
			box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
		}
		.transcript {
			min-height: 0;
			overflow: auto;
			padding: 18px min(4vw, 44px);
		}
		.composer {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto auto;
			gap: 8px;
			padding: 12px;
			border-top: 1px solid var(--border);
			background: var(--panel);
		}
		.composer .error-text {
			grid-column: 1 / -1;
			padding: 0;
		}
		.composer textarea {
			min-height: 46px;
			max-height: min(45vh, 360px);
			overflow-y: hidden;
			resize: vertical;
		}
		.input-wrap, .model-combo {
			position: relative;
			min-width: 0;
		}
		.combo-options, .command-suggest {
			position: absolute;
			left: 0;
			right: 0;
			z-index: 12;
			display: none;
			max-height: 280px;
			overflow: auto;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--panel);
			box-shadow: var(--shadow);
			padding: 6px;
		}
		.combo-options.open, .command-suggest.open {
			display: grid;
			gap: 4px;
		}
		.combo-options {
			top: calc(100% + 6px);
		}
		.command-suggest {
			bottom: calc(100% + 6px);
		}
		.combo-option, .suggest-option {
			display: block;
			width: 100%;
			height: auto;
			text-align: left;
			padding: 8px 9px;
			background: transparent;
		}
		.combo-option.active, .suggest-option.active {
			border-color: var(--accent);
			background: color-mix(in srgb, var(--accent) 12%, var(--panel));
		}
		.section {
			margin-bottom: 16px;
		}
		.section h2 {
			margin: 0 0 8px;
			font-size: 12px;
			text-transform: uppercase;
			color: var(--muted);
			letter-spacing: 0.08em;
		}
		.stack {
			display: grid;
			gap: 8px;
		}
		.session-button, .history-button, .command-button, .artifact-button {
			display: block;
			width: 100%;
			text-align: left;
			height: auto;
			padding: 9px 10px;
			background: transparent;
		}
		.session-button.active {
			border-color: var(--accent);
			background: color-mix(in srgb, var(--accent) 12%, var(--panel));
		}
		.sub {
			color: var(--muted);
			font-size: 12px;
		}
		.message {
			margin: 0 0 14px;
			border-left: 3px solid var(--border);
			padding: 0 0 0 12px;
		}
		.message.assistant { border-color: var(--accent); }
		.message.user { border-color: #38bdf8; }
		.message.pending {
			opacity: 0.76;
		}
		.message.toolResult, .message.system, .message.bashExecution { border-color: #a78bfa; }
		.role {
			display: flex;
			align-items: baseline;
			gap: 8px;
			margin-bottom: 4px;
			font-weight: 700;
		}
		.time {
			color: var(--muted);
			font-size: 12px;
			font-weight: 500;
		}
		pre {
			margin: 0;
			white-space: pre-wrap;
			word-break: break-word;
			font: 13px/1.48 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
		}
		.meta {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-top: 7px;
		}
		.usage-line {
			margin-top: 7px;
			color: var(--muted);
			font-size: 12px;
		}
		.message-details {
			margin-top: 7px;
		}
		.artifacts {
			display: grid;
			gap: 10px;
			margin-top: 10px;
		}
		.artifact {
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--panel-2);
			overflow: hidden;
		}
		.artifact.failed {
			border-color: var(--danger);
		}
		.artifact-title {
			display: flex;
			justify-content: space-between;
			gap: 10px;
			padding: 8px 10px;
			border-bottom: 1px solid var(--border);
			color: var(--muted);
			font-size: 12px;
		}
		.artifact-title span {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.artifact img {
			display: block;
			max-width: 100%;
			max-height: 560px;
			margin: 0 auto;
			object-fit: contain;
			background: #ffffff;
		}
		.artifact iframe {
			display: block;
			width: 100%;
			height: 460px;
			border: 0;
			background: #ffffff;
		}
		.artifact-preview-failed {
			padding: 12px;
			color: var(--muted);
		}
		.pill {
			display: inline-flex;
			align-items: center;
			min-height: 22px;
			padding: 0 7px;
			border: 1px solid var(--border);
			border-radius: 999px;
			color: var(--muted);
			font-size: 12px;
		}
		details {
			margin-top: 8px;
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 8px;
			background: var(--panel-2);
		}
		summary { cursor: pointer; color: var(--muted); }
		.tool, .box, .tree-row {
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--panel-2);
			padding: 9px;
		}
		.tool.running { border-color: #f59e0b; }
		.tool.error { border-color: var(--danger); }
		.tree-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto;
			gap: 6px;
			align-items: center;
		}
		.tree-row.active {
			border-color: var(--accent);
			background: color-mix(in srgb, var(--accent) 10%, var(--panel-2));
		}
		.tree-row.dim { opacity: 0.62; }
		.tree-title { font-weight: 650; }
		.tree-text {
			color: var(--muted);
			font-size: 12px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.settings-grid {
			display: grid;
			grid-template-columns: 112px minmax(0, 1fr);
			gap: 8px;
			align-items: center;
		}
		.rail-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 14px;
		}
		.rail-header h2 {
			margin: 0;
			font-size: 16px;
		}
		.empty, .error-text {
			color: var(--muted);
			padding: 10px 0;
		}
		.error-text { color: var(--danger); }
		.sidebar-backdrop, .rail-backdrop, .dialog-backdrop {
			display: none;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.44);
			z-index: 20;
		}
		body.rail-open .rail-backdrop {
			display: block;
		}
		.dialog-backdrop.open {
			display: grid;
			place-items: center;
		}
		.dialog {
			width: min(560px, calc(100vw - 28px));
			max-height: calc(100vh - 60px);
			overflow: auto;
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 8px;
			box-shadow: var(--shadow);
			padding: 16px;
		}
		.dialog h2 {
			margin: 0 0 8px;
			font-size: 18px;
		}
		.dialog-actions, .dialog-options {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 12px;
		}
		.dialog textarea {
			min-height: 220px;
			resize: vertical;
		}
		@media (max-width: 1060px) {
			.app {
				grid-template-columns: 280px minmax(0, 1fr);
			}
			body.sidebar-collapsed .app {
				grid-template-columns: 0 minmax(0, 1fr);
			}
			.topbar {
				grid-template-columns: auto minmax(130px, 1fr) minmax(220px, 1.2fr) 130px auto auto auto;
			}
			#compactButton, #themeButton { display: none; }
		}
		@media (max-width: 780px) {
			.app {
				display: block;
			}
			.sidebar {
				position: fixed;
				inset: 0 auto 0 0;
				width: min(86vw, 340px);
				transform: translateX(-105%);
				transition: transform 160ms ease;
				z-index: 30;
				box-shadow: var(--shadow);
			}
			body.sidebar-open .sidebar {
				transform: translateX(0);
			}
			body.sidebar-open .sidebar-backdrop {
				display: block;
			}
			body.sidebar-collapsed .sidebar {
				display: block;
			}
			.main {
				height: 100vh;
			}
			.topbar {
				grid-template-columns: auto minmax(0, 1fr) auto;
			}
			#modelCombo, #thinkingSelect, #abortButton, #compactButton, #detailsButton {
				display: none;
			}
			.composer {
				grid-template-columns: minmax(0, 1fr) auto auto;
			}
			#steerButton, #themeButton {
				display: none;
			}
		}
	</style>
</head>
<body data-theme="dark">
	<div class="sidebar-backdrop" id="sidebarBackdrop"></div>
	<div class="rail-backdrop" id="railBackdrop"></div>
	<div class="app">
		<aside class="sidebar" id="sidebar">
			<div class="section">
				<h2>Sessions</h2>
				<div class="stack">
					<button class="primary" type="button" id="newSessionButton">New session</button>
					<div id="sessions"></div>
				</div>
			</div>
			<div class="section">
				<h2>History</h2>
				<div class="stack">
					<input id="historyFilter" placeholder="Filter history">
					<button type="button" id="refreshHistoryButton">Refresh history</button>
					<div id="history"></div>
				</div>
			</div>
			<div class="section">
				<h2>Slash Commands</h2>
				<div class="stack">
					<input id="commandFilter" placeholder="Filter commands">
					<div id="commands"></div>
				</div>
			</div>
		</aside>
		<main class="main">
			<header class="topbar">
				<button type="button" id="sidebarToggle">Sessions</button>
				<div class="brand"><span class="dot" id="statusDot"></span><span id="statusText">Connecting</span></div>
				<div class="model-combo" id="modelCombo">
					<input id="modelInput" placeholder="Filter models">
					<div class="combo-options" id="modelOptions"></div>
				</div>
				<select id="thinkingSelect"></select>
				<button type="button" id="detailsButton">Details</button>
				<button type="button" id="panelToggle">Panel</button>
				<button type="button" id="themeButton">Light</button>
				<button type="button" id="compactButton">Compact</button>
				<button type="button" id="abortButton">Stop</button>
			</header>
			<section class="transcript" id="transcript"></section>
			<form class="composer" id="composer">
				<div class="input-wrap">
					<textarea id="prompt" placeholder="Message Pi, or use /commands"></textarea>
					<div class="command-suggest" id="commandSuggest"></div>
				</div>
				<button class="primary" type="submit" id="sendButton">Send</button>
				<button class="danger" type="button" id="stopButton">Stop</button>
				<button type="button" id="steerButton">Steer</button>
				<div class="error-text" id="errorText"></div>
			</form>
		</main>
		<aside class="rail" id="rail">
			<div class="rail-header">
				<h2>Session Panel</h2>
				<button type="button" id="railClose">Close</button>
			</div>
			<div class="section">
				<h2>Settings</h2>
				<div class="settings-grid" id="settingsGrid"></div>
			</div>
			<div class="section">
				<h2>Tree</h2>
				<div class="stack">
					<label class="sub"><input id="treeSummarize" type="checkbox"> summarize abandoned branch</label>
					<input id="treeInstructions" placeholder="Summary instructions">
					<div id="tree"></div>
				</div>
			</div>
			<div class="section">
				<h2>Artifacts</h2>
				<div id="artifactsList"></div>
			</div>
			<div class="section">
				<h2>Tools</h2>
				<div id="tools"></div>
			</div>
			<div class="section">
				<h2>Extensions</h2>
				<div id="extensionUi"></div>
			</div>
		</aside>
	</div>
	<div class="dialog-backdrop" id="dialogBackdrop">
		<div class="dialog" id="dialog"></div>
	</div>
	<script>
		const params = new URLSearchParams(location.search);
		const token = params.get('token') || '';
		const els = {
			abort: document.getElementById('abortButton'),
			artifactsList: document.getElementById('artifactsList'),
			commandFilter: document.getElementById('commandFilter'),
			commandSuggest: document.getElementById('commandSuggest'),
			commands: document.getElementById('commands'),
			compact: document.getElementById('compactButton'),
			composer: document.getElementById('composer'),
			details: document.getElementById('detailsButton'),
			dialog: document.getElementById('dialog'),
			dialogBackdrop: document.getElementById('dialogBackdrop'),
			dot: document.getElementById('statusDot'),
			error: document.getElementById('errorText'),
			extensionUi: document.getElementById('extensionUi'),
			history: document.getElementById('history'),
			historyFilter: document.getElementById('historyFilter'),
			modelCombo: document.getElementById('modelCombo'),
			modelInput: document.getElementById('modelInput'),
			modelOptions: document.getElementById('modelOptions'),
			newSession: document.getElementById('newSessionButton'),
			panelToggle: document.getElementById('panelToggle'),
			prompt: document.getElementById('prompt'),
			rail: document.getElementById('rail'),
			railBackdrop: document.getElementById('railBackdrop'),
			railClose: document.getElementById('railClose'),
			refreshHistory: document.getElementById('refreshHistoryButton'),
			send: document.getElementById('sendButton'),
			sessions: document.getElementById('sessions'),
			settingsGrid: document.getElementById('settingsGrid'),
			sidebarBackdrop: document.getElementById('sidebarBackdrop'),
			sidebarToggle: document.getElementById('sidebarToggle'),
			steer: document.getElementById('steerButton'),
			status: document.getElementById('statusText'),
			stop: document.getElementById('stopButton'),
			theme: document.getElementById('themeButton'),
			tools: document.getElementById('tools'),
			transcript: document.getElementById('transcript'),
			tree: document.getElementById('tree'),
			treeInstructions: document.getElementById('treeInstructions'),
			treeSummarize: document.getElementById('treeSummarize'),
			thinkingSelect: document.getElementById('thinkingSelect')
		};
		const state = {
			connected: false,
			error: '',
			snapshot: null,
			theme: localStorage.getItem('pi-web-theme') || 'dark',
			showDetails: localStorage.getItem('pi-web-details') === '1',
			sidebarCollapsed: localStorage.getItem('pi-web-sidebar-collapsed') === '1',
			railOpen: false,
			promptManualHeight: Number(localStorage.getItem('pi-web-prompt-height') || 0),
			promptResizeStartHeight: 0,
			modelOpen: false,
			modelQuery: '',
			modelActiveIndex: 0,
			modelLastCurrent: '',
			historyFilter: '',
			commandFilter: '',
			commandOpen: false,
			commandActiveIndex: 0,
			commandSuppressedToken: '',
			artifactFailureNotices: loadArtifactFailureNotices(),
			completedTranscriptHtml: '',
			liveTranscriptHtml: '',
			optimisticMessages: [],
			optimisticTranscriptHtml: '',
			lastEscapeAt: 0,
			userEdited: false,
			lastEditorText: null
		};

		function loadArtifactFailureNotices() {
			try {
				return new Set(JSON.parse(sessionStorage.getItem('pi-web-artifact-failure-notices') || '[]'));
			} catch {
				return new Set();
			}
		}
		function saveArtifactFailureNotices() {
			sessionStorage.setItem('pi-web-artifact-failure-notices', JSON.stringify([...state.artifactFailureNotices]));
		}
		function apiPath(path) {
			if (!token) return path;
			return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
		}
		function escapeHtml(value) {
			return String(value == null ? '' : value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}
		function formatTime(timestamp) {
			if (!timestamp) return '';
			const date = new Date(timestamp);
			if (Number.isNaN(date.getTime())) return '';
			return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		}
		function applyTheme() {
			document.body.dataset.theme = state.theme;
			els.theme.textContent = state.theme === 'dark' ? 'Light' : 'Dark';
		}
		function applyDetailsToggle() {
			els.details.textContent = state.showDetails ? 'Hide details' : 'Details';
		}
		function isMobile() {
			return window.matchMedia('(max-width: 780px)').matches;
		}
		function applyLayout() {
			const mobile = isMobile();
			document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed && !mobile);
			document.body.classList.toggle('rail-open', state.railOpen);
			els.sidebarToggle.textContent = mobile ? 'Sessions' : (state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar');
			els.panelToggle.textContent = state.railOpen ? 'Hide panel' : 'Panel';
		}
		function toggleSidebar() {
			if (isMobile()) {
				document.body.classList.toggle('sidebar-open');
				return;
			}
			state.sidebarCollapsed = !state.sidebarCollapsed;
			localStorage.setItem('pi-web-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');
			applyLayout();
		}
		function closeMobileSidebar() {
			document.body.classList.remove('sidebar-open');
		}
		function closePanel() {
			state.railOpen = false;
			applyLayout();
		}
		function autoResizePrompt() {
			const maxHeight = Math.max(120, Math.round(window.innerHeight * 0.45));
			const minimumHeight = 46;
			const manualHeight = Math.min(maxHeight, Math.max(0, state.promptManualHeight || 0));
			els.prompt.style.height = 'auto';
			const contentHeight = Math.min(maxHeight, Math.max(minimumHeight, els.prompt.scrollHeight + 2));
			const targetHeight = Math.max(contentHeight, manualHeight);
			els.prompt.style.height = targetHeight + 'px';
			els.prompt.style.overflowY = els.prompt.scrollHeight > targetHeight ? 'auto' : 'hidden';
		}
		function formatMetric(value) {
			const number = Number(value || 0);
			if (!Number.isFinite(number)) return '0';
			return number.toLocaleString();
		}
		function formatCost(value) {
			const number = Number(value || 0);
			if (!Number.isFinite(number) || number === 0) return '';
			return ', cost $' + number.toFixed(number < 0.01 ? 6 : 4);
		}
		function renderUsageLine(meta) {
			if (!meta) return '';
			const input = Number(meta.input || 0);
			const output = Number(meta.output || 0);
			const cacheRead = Number(meta.cacheRead || 0);
			const cacheWrite = Number(meta.cacheWrite || 0);
			if (!input && !output && !cacheRead && !cacheWrite && !meta.cost) return '';
			const total = input + output + cacheRead + cacheWrite;
			return '<div class="usage-line">out ' + formatMetric(output) +
				', in ' + formatMetric(input) +
				', cache r/w ' + formatMetric(cacheRead) + '/' + formatMetric(cacheWrite) +
				', total ' + formatMetric(total) + formatCost(meta.cost) + '</div>';
		}
		function renderMeta(meta, role) {
			const entries = Object.entries(meta || {}).filter((entry) => entry[1] !== null && entry[1] !== '');
			const details = entries.length
				? '<details class="message-details"' + (state.showDetails ? ' open' : '') + '><summary>metadata</summary><div class="meta">' + entries.map((entry) =>
				'<span class="pill">' + escapeHtml(entry[0]) + ': ' + escapeHtml(entry[1]) + '</span>'
			).join('') + '</div></details>'
				: '';
			return (role === 'assistant' ? renderUsageLine(meta) : '') + details;
		}
		function renderToolCalls(toolCalls) {
			if (!toolCalls || !toolCalls.length) return '';
			return toolCalls.map((tool) =>
				'<details open><summary>' + escapeHtml(tool.name || 'tool') + '</summary><pre>' +
				escapeHtml(tool.args || '') + '</pre></details>'
			).join('');
		}
		function artifactKind(path) {
			const ext = path.split(/[?#]/, 1)[0].split('.').pop().toLowerCase();
			if (ext === 'html' || ext === 'htm') return 'html';
			if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
			return null;
		}
		function artifactUrl(path) {
			return apiPath('/api/artifact?sessionId=' + encodeURIComponent(activeSessionId() || '') +
				'&path=' + encodeURIComponent(path));
		}
		function artifactInfoUrl(path) {
			return apiPath('/api/artifact-info?sessionId=' + encodeURIComponent(activeSessionId() || '') +
				'&path=' + encodeURIComponent(path));
		}
		function artifactLabel(path) {
			const cleanPath = String(path || '').split(/[?#]/, 1)[0];
			return cleanPath.split('/').filter(Boolean).pop() || cleanPath || 'artifact';
		}
		function stableHash(value) {
			let hash = 2166136261;
			for (let index = 0; index < value.length; index++) {
				hash ^= value.charCodeAt(index);
				hash = Math.imul(hash, 16777619);
			}
			return (hash >>> 0).toString(36);
		}
		function sanitizeArtifactId(value) {
			const id = String(value || '').trim();
			return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/.test(id) ? id : '';
		}
		function makeArtifactId(entry, path, index) {
			const entryId = entry && entry.id ? entry.id : activeSessionId() || 'session';
			return 'art-' + stableHash(entryId + '\\n' + index + '\\n' + path);
		}
		function artifactDomId(id) {
			return 'artifact-preview-' + String(id).replace(/[^A-Za-z0-9_-]/g, '-');
		}
		function parsePreviewAttributes(value) {
			const attrs = {};
			const pattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|([^"'\\s]+))/g;
			let match = pattern.exec(value);
			while (match) {
				attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
				match = pattern.exec(value);
			}
			return attrs;
		}
		function parsePreviewDirectiveLine(line, entry, index) {
			const match = line.match(/^\\s*::preview\\s+(.+)::\\s*$/);
			if (!match) return null;
			const attrs = parsePreviewAttributes(match[1]);
			const path = String(attrs.path || '').trim();
			const inferredType = artifactKind(path);
			const explicitType = attrs.type ? String(attrs.type).trim().toLowerCase() : '';
			if (!path || !inferredType) return null;
			if (explicitType && explicitType !== inferredType) return null;
			return {
				id: sanitizeArtifactId(attrs.id) || makeArtifactId(entry, path, index),
				path,
				title: String(attrs.title || '').trim(),
				type: inferredType,
				source: 'directive'
			};
		}
		function parsePreviewDirectives(text, entry) {
			const lines = String(text || '').split('\\n');
			const body = [];
			const artifacts = [];
			let inFence = false;
			let artifactIndex = 0;
			for (const line of lines) {
				if (line.trimStart().startsWith('\`\`\`')) {
					inFence = !inFence;
					body.push(line);
					continue;
				}
				const artifact = inFence ? null : parsePreviewDirectiveLine(line, entry, artifactIndex);
				if (artifact) {
					artifacts.push(artifact);
					artifactIndex++;
					continue;
				}
				body.push(line);
			}
			return {
				text: body.join('\\n').trimEnd(),
				artifacts
			};
		}
		function findArtifacts(text) {
			const value = String(text || '');
			const pattern = /(?:^|[\\s("'\\[])((?:file:\\/\\/)?(?:\\/|\\.\\.\\/|\\.\\/|[A-Za-z0-9_.-]+\\/)?[A-Za-z0-9_./:@%+~-]+\\.(?:png|jpe?g|gif|webp|svg|bmp|avif|html?))(?:$|[\\s)"'\\],;:])/gi;
			const seen = new Set();
			const artifacts = [];
			let match = pattern.exec(value);
			while (match) {
				const path = match[1];
				if (!seen.has(path) && artifactKind(path)) {
					seen.add(path);
					artifacts.push(path);
				}
				match = pattern.exec(value);
			}
			return artifacts.slice(0, 8);
		}
		function dedupeArtifacts(artifacts) {
			const seen = new Set();
			const result = [];
			for (const artifact of artifacts) {
				const key = artifact.path.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				result.push(artifact);
			}
			return result;
		}
		function getMessagePreviewData(entry, includeDetected) {
			const message = entry.message || {};
			const rawText = message.text || (message.imageCount ? '[' + message.imageCount + ' image attachment(s)]' : '');
			const parsed = parsePreviewDirectives(rawText, entry);
			const detected = includeDetected
				? findArtifacts(parsed.text).map((path, index) => ({
					id: makeArtifactId(entry, path, index),
					path,
					title: '',
					type: artifactKind(path),
					source: 'detected'
				}))
				: [];
			return {
				text: parsed.text,
				artifacts: dedupeArtifacts([...parsed.artifacts, ...detected]).filter((artifact) => artifact.type).slice(0, 12)
			};
		}
		function renderArtifacts(artifacts) {
			if (!artifacts.length) return '';
			return '<div class="artifacts">' + artifacts.map((artifact) => {
				const url = artifactUrl(artifact.path);
				const title = artifact.title || artifactLabel(artifact.path);
				return '<div class="artifact" id="' + escapeHtml(artifactDomId(artifact.id)) +
					'" data-artifact-id="' + escapeHtml(artifact.id) +
					'" data-artifact-path="' + escapeHtml(artifact.path) +
					'" data-artifact-kind="' + escapeHtml(artifact.type) +
					'" data-artifact-title="' + escapeHtml(title) +
					'" data-artifact-source="' + escapeHtml(artifact.source) + '">' +
					'<div class="artifact-title"><span><strong>' + escapeHtml(title) + '</strong> <span class="sub">' +
					escapeHtml(artifact.id + ' - ' + artifact.type) + '</span></span>' +
					'<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">open</a></div>' +
					'<div class="artifact-body"><div class="empty">Loading preview...</div></div></div>';
			}).join('') + '</div>';
		}
		function renderMessage(entry, live) {
			const message = entry.message || {};
			const preview = message.role === 'assistant' && !live
				? getMessagePreviewData(entry, true)
				: { text: message.text || (message.imageCount ? '[' + message.imageCount + ' image attachment(s)]' : ''), artifacts: [] };
			const thinking = message.thinking
				? '<details><summary>thinking</summary><pre>' + escapeHtml(message.thinking) + '</pre></details>'
				: '';
			const error = message.error ? '<div class="error-text">' + escapeHtml(message.error) + '</div>' : '';
			const livePill = live ? '<span class="pill">streaming</span>' : '';
			const localPill = entry.localStatus ? '<span class="pill">' + escapeHtml(entry.localStatus) + '</span>' : '';
			const textHtml = preview.text ? '<pre>' + escapeHtml(preview.text) + '</pre>' : '';
			const artifacts = renderArtifacts(preview.artifacts);
			return '<article class="message ' + escapeHtml(message.role || 'unknown') + (entry.localStatus ? ' pending' : '') + '">' +
				'<div class="role">' + escapeHtml(message.title || message.role || 'message') +
				'<span class="time">' + escapeHtml(formatTime(entry.timestamp)) + '</span>' + livePill + localPill + '</div>' +
				textHtml +
				artifacts + thinking + renderToolCalls(message.toolCalls) + renderMeta(message.meta, message.role) + error +
				'</article>';
		}
		function snapshotHasUserMessage(snapshot, optimistic) {
			const optimisticTime = new Date(optimistic.timestamp).getTime();
			for (const entry of snapshot.entries || []) {
				const message = entry.message || {};
				if (message.role !== 'user' || message.text !== optimistic.message.text) continue;
				const entryTime = new Date(entry.timestamp).getTime();
				if (!Number.isFinite(entryTime) || !Number.isFinite(optimisticTime) || entryTime >= optimisticTime - 5000) {
					return true;
				}
			}
			return false;
		}
		function reconcileOptimisticMessages(snapshot) {
			state.optimisticMessages = state.optimisticMessages.filter((entry) => {
				return entry.sessionId !== snapshot.activeSessionId || !snapshotHasUserMessage(snapshot, entry);
			});
		}
		function optimisticStatus(mode, snapshot) {
			if (mode === 'steer') return 'steering';
			if (!snapshot || !snapshot.isIdle) return 'queued';
			return 'sending';
		}
		function createOptimisticEntry(sessionId, message, mode) {
			return {
				id: 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
				parentId: null,
				sessionId,
				timestamp: new Date().toISOString(),
				entryType: 'message',
				localStatus: optimisticStatus(mode, state.snapshot),
				message: {
					role: 'user',
					title: 'You',
					text: message,
					thinking: '',
					toolCalls: [],
					imageCount: 0,
					meta: {}
				}
			};
		}
		function removeOptimisticEntry(id) {
			state.optimisticMessages = state.optimisticMessages.filter((entry) => entry.id !== id);
		}
		function getTranscriptParts() {
			let completed = els.transcript.querySelector('[data-transcript-completed]');
			let live = els.transcript.querySelector('[data-transcript-live]');
			let optimistic = els.transcript.querySelector('[data-transcript-optimistic]');
			let empty = els.transcript.querySelector('[data-transcript-empty]');
			if (!completed || !live || !optimistic || !empty) {
				els.transcript.innerHTML =
					'<div data-transcript-completed></div><div data-transcript-live></div><div data-transcript-optimistic></div><div data-transcript-empty></div>';
				completed = els.transcript.querySelector('[data-transcript-completed]');
				live = els.transcript.querySelector('[data-transcript-live]');
				optimistic = els.transcript.querySelector('[data-transcript-optimistic]');
				empty = els.transcript.querySelector('[data-transcript-empty]');
				state.completedTranscriptHtml = '';
				state.liveTranscriptHtml = '';
				state.optimisticTranscriptHtml = '';
			}
			return { completed, live, optimistic, empty };
		}
		function scrollTranscriptToBottom() {
			els.transcript.scrollTop = els.transcript.scrollHeight;
		}
		function renderTranscript(snapshot) {
			reconcileOptimisticMessages(snapshot);
			const shouldStick = els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight < 120;
			const parts = getTranscriptParts();
			const completedHtml = (snapshot.entries || []).map((entry) => renderMessage(entry, false)).join('');
			const optimisticHtml = state.optimisticMessages
				.filter((entry) => entry.sessionId === snapshot.activeSessionId)
				.map((entry) => renderMessage(entry, false))
				.join('');
			const liveHtml = snapshot.liveMessage
				? renderMessage({
					id: 'live',
					parentId: null,
					timestamp: new Date().toISOString(),
					entryType: 'message',
					message: snapshot.liveMessage
				}, true)
				: '';
			if (completedHtml !== state.completedTranscriptHtml) {
				parts.completed.innerHTML = completedHtml;
				state.completedTranscriptHtml = completedHtml;
				hydrateArtifacts(parts.completed, shouldStick);
			}
			if (liveHtml !== state.liveTranscriptHtml) {
				parts.live.innerHTML = liveHtml;
				state.liveTranscriptHtml = liveHtml;
			}
			if (optimisticHtml !== state.optimisticTranscriptHtml) {
				parts.optimistic.innerHTML = optimisticHtml;
				state.optimisticTranscriptHtml = optimisticHtml;
			}
			parts.empty.innerHTML = completedHtml || liveHtml || optimisticHtml ? '' : '<div class="empty">No messages in this session yet.</div>';
			if (shouldStick) requestAnimationFrame(scrollTranscriptToBottom);
		}
		function collectSessionArtifacts(snapshot) {
			const artifacts = [];
			const seen = new Set();
			for (const entry of snapshot.entries || []) {
				const message = entry.message || {};
				if (message.role !== 'assistant') continue;
				for (const artifact of getMessagePreviewData(entry, true).artifacts) {
					if (seen.has(artifact.id)) continue;
					seen.add(artifact.id);
					artifacts.push({
						...artifact,
						timestamp: entry.timestamp
					});
				}
			}
			return artifacts;
		}
		function renderArtifactsList(snapshot) {
			const artifacts = collectSessionArtifacts(snapshot).slice(-80).reverse();
			els.artifactsList.innerHTML = artifacts.map((artifact) => {
				const title = artifact.title || artifactLabel(artifact.path);
				return '<button type="button" class="artifact-button" data-artifact-jump="' + escapeHtml(artifact.id) +
					'">' + escapeHtml(title) + '<br><span class="sub">' +
					escapeHtml(artifact.id + ' - ' + artifact.type + ' - ' + artifact.source) +
					'</span></button>';
			}).join('') || '<div class="empty">No artifacts.</div>';
		}
		async function hydrateArtifacts(root, keepStick) {
			const nodes = [...root.querySelectorAll('[data-artifact-path]')];
			for (const node of nodes) {
				if (node.dataset.artifactHydrated === '1') continue;
				node.dataset.artifactHydrated = '1';
				void hydrateArtifact(node, keepStick);
			}
		}
		async function hydrateArtifact(node, keepStick) {
			const path = node.getAttribute('data-artifact-path') || '';
			const kind = node.getAttribute('data-artifact-kind') || '';
			const body = node.querySelector('.artifact-body');
			try {
				const response = await fetch(artifactInfoUrl(path));
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(data.error || response.status + ' ' + response.statusText);
				}
				if (kind === 'html' && !data.isHtml) throw new Error('Artifact is not HTML');
				if (kind === 'image' && !String(data.contentType || '').startsWith('image/')) {
					throw new Error('Artifact is not an image');
				}
				if (kind === 'html') {
					body.innerHTML = '<iframe loading="lazy" src="' +
						escapeHtml(artifactUrl(path)) + '"></iframe>';
					if (keepStick) requestAnimationFrame(scrollTranscriptToBottom);
					return;
				}
				body.innerHTML = '<img loading="lazy" src="' + escapeHtml(artifactUrl(path)) +
					'" alt="' + escapeHtml(node.getAttribute('data-artifact-title') || 'artifact') + '">';
				if (keepStick) requestAnimationFrame(scrollTranscriptToBottom);
				const image = body.querySelector('img');
				image.addEventListener('error', () => {
					markArtifactFailed(node, 'Browser could not render the image file');
				}, { once: true });
			} catch (error) {
				markArtifactFailed(node, error.message || String(error));
			}
		}
		function markArtifactFailed(node, reason) {
			node.classList.add('failed');
			const body = node.querySelector('.artifact-body');
			const shouldNotify = node.getAttribute('data-artifact-source') === 'directive';
			body.innerHTML = '<div class="artifact-preview-failed">Preview failed. ' +
				(shouldNotify ? 'Pi has been asked to regenerate it.' : 'Preview unavailable.') + '</div>';
			if (shouldNotify) notifyArtifactFailure(node, reason);
		}
		function notifyArtifactFailure(node, reason) {
			const sessionId = activeSessionId();
			const id = node.getAttribute('data-artifact-id') || 'unknown';
			const path = node.getAttribute('data-artifact-path') || '';
			if (!sessionId) return;
			const noticeKey = sessionId + ':' + id + ':' + stableHash(path);
			if (state.artifactFailureNotices.has(noticeKey)) return;
			state.artifactFailureNotices.add(noticeKey);
			saveArtifactFailureNotices();
			const title = node.getAttribute('data-artifact-title') || id;
			const message = 'The web UI could not render preview artifact "' + title + '" (id: ' + id + '): ' +
				reason + '. The artifact path was "' + path + '". Please regenerate it as a static local HTML/image artifact and send it again with a valid ::preview directive.';
			postJson('/api/send', { sessionId, message, mode: 'steer' }).catch(handleError);
		}
		function renderSessions(snapshot) {
			els.sessions.innerHTML = (snapshot.sessions || []).map((session) => {
				const active = session.id === snapshot.activeSessionId ? ' active' : '';
				const status = session.isIdle ? 'idle' : 'running';
				const pending = session.hasPendingMessages ? ', queued' : '';
				return '<button type="button" class="session-button' + active + '" data-session-id="' +
					escapeHtml(session.id) + '">' + escapeHtml(session.title) +
					'<br><span class="sub">' + escapeHtml(status + pending) + ' - ' +
					escapeHtml(session.model || 'no model') + '</span></button>';
			}).join('');
		}
		function renderHistory(snapshot) {
			const filter = state.historyFilter.toLowerCase();
			const rows = (snapshot.history || []).filter((session) => {
				const haystack = [session.name, session.cwd, session.firstMessage, session.path].join(' ').toLowerCase();
				return haystack.includes(filter);
			});
			els.history.innerHTML = rows.slice(0, 60).map((session) => {
				const title = session.name || session.firstMessage || session.id.slice(0, 8);
				return '<button type="button" class="history-button" data-history-path="' +
					escapeHtml(session.path) + '">' + escapeHtml(title) +
					'<br><span class="sub">' + escapeHtml(formatTime(session.modified)) + ' - ' +
					escapeHtml(session.messageCount + ' messages') + '</span></button>';
			}).join('') || '<div class="empty">No matching history.</div>';
		}
		function renderCommands(snapshot) {
			const filter = state.commandFilter.toLowerCase();
			const rows = (snapshot.commands || []).filter((command) => {
				return (command.name + ' ' + command.description + ' ' + command.source).toLowerCase().includes(filter);
			});
			els.commands.innerHTML = rows.slice(0, 80).map((command) =>
				'<button type="button" class="command-button" data-command="' + escapeHtml(command.name) +
				'">/' + escapeHtml(command.name) + '<br><span class="sub">' +
				escapeHtml(command.source + (command.description ? ' - ' + command.description : '')) +
				'</span></button>'
			).join('') || '<div class="empty">No commands.</div>';
		}
		function getCommandToken() {
			const cursor = els.prompt.selectionStart || 0;
			const before = els.prompt.value.slice(0, cursor);
			const match = before.match(/(^|\\s)(\\/[^\\s]*)$/);
			if (!match) return null;
			const token = match[2];
			return {
				token,
				query: token.slice(1).toLowerCase(),
				start: cursor - token.length,
				end: cursor
			};
		}
		function getCommandSuggestions() {
			const snapshot = state.snapshot;
			const token = getCommandToken();
			if (!snapshot || !token) return [];
			if (state.commandSuppressedToken === token.token) return [];
			return (snapshot.commands || []).filter((command) => {
				const haystack = (command.name + ' ' + command.description + ' ' + command.source).toLowerCase();
				return !token.query || haystack.includes(token.query);
			}).slice(0, 10);
		}
		function renderCommandAutocomplete() {
			const suggestions = getCommandSuggestions();
			state.commandOpen = suggestions.length > 0;
			if (!state.commandOpen) {
				els.commandSuggest.classList.remove('open');
				els.commandSuggest.innerHTML = '';
				state.commandActiveIndex = 0;
				return;
			}
			if (state.commandActiveIndex >= suggestions.length) state.commandActiveIndex = 0;
			els.commandSuggest.innerHTML = suggestions.map((command, index) =>
				'<button type="button" class="suggest-option' + (index === state.commandActiveIndex ? ' active' : '') +
				'" data-command-suggest="' + index + '">/' + escapeHtml(command.name) +
				'<br><span class="sub">' + escapeHtml(command.source + (command.description ? ' - ' + command.description : '')) +
				'</span></button>'
			).join('');
			els.commandSuggest.classList.add('open');
		}
		function insertSlashCommand(commandName) {
			if (!commandName) return;
			const token = getCommandToken();
			const insertion = '/' + commandName + ' ';
			const start = token ? token.start : (els.prompt.selectionStart || 0);
			const end = token ? token.end : (els.prompt.selectionEnd || start);
			els.prompt.value = els.prompt.value.slice(0, start) + insertion + els.prompt.value.slice(end);
			els.prompt.focus();
			els.prompt.selectionStart = els.prompt.selectionEnd = start + insertion.length;
			state.userEdited = true;
			state.commandOpen = false;
			autoResizePrompt();
			renderCommandAutocomplete();
		}
		function applyActiveCommandSuggestion() {
			const suggestions = getCommandSuggestions();
			const command = suggestions[state.commandActiveIndex] || suggestions[0];
			if (!command) return false;
			insertSlashCommand(command.name);
			return true;
		}
		function modelSearchText(model) {
			return (model.provider + ' ' + model.modelId + ' ' + model.label + ' ' + model.provider + '/' + model.modelId).toLowerCase();
		}
		function getFilteredModels(settings) {
			const query = (state.modelOpen ? state.modelQuery : '').trim().toLowerCase();
			const tokens = query.split(/\\s+/).filter(Boolean);
			const models = settings.models || [];
			if (!tokens.length) return models;
			return models.filter((model) => {
				const haystack = modelSearchText(model);
				return tokens.every((token) => haystack.includes(token));
			});
		}
		function currentModelLabel(settings) {
			const current = (settings.models || []).find((model) => model.current);
			return current ? current.label : settings.currentModel || '';
		}
		function applyModel(model) {
			state.modelOpen = false;
			state.modelQuery = '';
			state.modelActiveIndex = 0;
			els.modelOptions.classList.remove('open');
			postJson('/api/settings', {
				sessionId: activeSessionId(),
				action: 'setModel',
				provider: model.provider,
				modelId: model.modelId
			}).catch(handleError);
		}
		function renderModelControls(snapshot) {
			const settings = snapshot.settings;
			if (!settings) {
				els.modelInput.value = 'No session';
				els.modelOptions.innerHTML = '';
				els.modelOptions.classList.remove('open');
				els.thinkingSelect.innerHTML = '';
				return;
			}
			const currentLabel = currentModelLabel(settings);
			if (!state.modelOpen && currentLabel !== state.modelLastCurrent) {
				state.modelLastCurrent = currentLabel;
				els.modelInput.value = currentLabel;
			}
			if (state.modelOpen) {
				els.modelInput.value = state.modelQuery;
			}
			const models = getFilteredModels(settings).slice(0, 80);
			if (state.modelActiveIndex >= models.length) state.modelActiveIndex = 0;
			els.modelOptions.innerHTML = models.map((model, index) =>
				'<button type="button" class="combo-option' + (index === state.modelActiveIndex ? ' active' : '') +
				'" data-model-index="' + index + '">' + escapeHtml(model.label) +
				'<br><span class="sub">' + escapeHtml(model.provider + '/' + model.modelId) +
				(model.reasoning ? ' - reasoning' : '') + '</span></button>'
			).join('') || '<div class="empty">No matching models.</div>';
			els.modelOptions.classList.toggle('open', state.modelOpen);
			const thinkingLevels = settings.availableThinkingLevels || [];
			let thinkingOptions = thinkingLevels.map((level) =>
				'<option value="' + escapeHtml(level) + '"' +
				(level === settings.currentThinkingLevel ? ' selected' : '') + '>' + escapeHtml(level) + '</option>'
			).join('');
			if (settings.currentThinkingLevel && !thinkingLevels.includes(settings.currentThinkingLevel)) {
				thinkingOptions = '<option value="" selected disabled>' +
					escapeHtml(settings.currentThinkingLevel + ' (current)') + '</option>' + thinkingOptions;
			}
			els.thinkingSelect.innerHTML = thinkingOptions;
		}
		function renderSettings(snapshot) {
			const settings = snapshot.settings;
			if (!settings) {
				els.settingsGrid.innerHTML = '<div class="empty">No active session.</div>';
				return;
			}
			function option(value, current) {
				return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>';
			}
			els.settingsGrid.innerHTML =
				'<label>Model</label><div class="sub">' + escapeHtml(settings.currentModel || 'none') + '</div>' +
				'<label>Steering</label><select id="steeringMode">' +
				option('one-at-a-time', settings.steeringMode) + option('all', settings.steeringMode) + '</select>' +
				'<label>Follow-up</label><select id="followUpMode">' +
				option('one-at-a-time', settings.followUpMode) + option('all', settings.followUpMode) + '</select>' +
				'<label>Auto compact</label><label><input id="autoCompact" type="checkbox"' +
				(settings.autoCompactionEnabled ? ' checked' : '') + '> enabled</label>';
		}
		function renderTree(snapshot) {
			const tree = snapshot.tree;
			if (!tree || !tree.nodes.length) {
				els.tree.innerHTML = '<div class="empty">No tree entries yet.</div>';
				return;
			}
			els.tree.innerHTML = tree.nodes.map((node) => {
				const active = node.isActive ? ' active' : '';
				const dim = node.isCurrentBranch ? '' : ' dim';
				const label = node.label ? ' [' + node.label + ']' : '';
				const indent = Math.min(node.depth * 16, 128);
				return '<div class="tree-row' + active + dim + '">' +
					'<div style="padding-left:' + indent + 'px">' +
					'<div class="tree-title">' + escapeHtml(node.title + label) + '</div>' +
					'<div class="tree-text">' + escapeHtml(node.text || node.entryType) + '</div>' +
					'</div>' +
					'<button type="button" data-tree-go="' + escapeHtml(node.id) + '"' +
					(node.isActive ? ' disabled' : '') + '>Go</button>' +
					'<button type="button" data-tree-fork="' + escapeHtml(node.id) + '">Fork</button>' +
					'</div>';
			}).join('');
		}
		function renderTools(snapshot) {
			const tools = snapshot.tools || [];
			els.tools.innerHTML = tools.map((tool) =>
				'<div class="tool ' + escapeHtml(tool.status) + (tool.isError ? ' error' : '') + '">' +
				'<strong>' + escapeHtml(tool.name) + ' <span class="sub">' + escapeHtml(tool.status) + '</span></strong>' +
				'<details open><summary>input</summary><pre>' + escapeHtml(tool.args) + '</pre></details>' +
				(tool.result ? '<details open><summary>output</summary><pre>' + escapeHtml(tool.result) + '</pre></details>' : '') +
				'</div>'
			).join('') || '<div class="empty">No tool activity.</div>';
		}
		function renderExtensionUi(snapshot) {
			const ui = snapshot.extensionUi;
			if (!ui) {
				els.extensionUi.innerHTML = '<div class="empty">No extension UI.</div>';
				renderDialog(null);
				return;
			}
			const boxes = [];
			if (ui.title) boxes.push('<div class="box"><strong>Title</strong><pre>' + escapeHtml(ui.title) + '</pre></div>');
			for (const status of ui.statuses || []) {
				boxes.push('<div class="box"><strong>' + escapeHtml(status.key) + '</strong><pre>' +
					escapeHtml(status.text) + '</pre></div>');
			}
			for (const widget of ui.widgets || []) {
				boxes.push('<div class="box"><strong>' + escapeHtml(widget.key + ' ' + widget.placement) +
					'</strong><pre>' + escapeHtml((widget.lines || []).join('\\n')) + '</pre></div>');
			}
			els.extensionUi.innerHTML = boxes.join('') || '<div class="empty">No extension UI.</div>';
			if (ui.editorText && ui.editorText !== state.lastEditorText) {
				if (!state.userEdited || !els.prompt.value.trim()) {
					els.prompt.value = ui.editorText;
					state.lastEditorText = ui.editorText;
					state.userEdited = false;
					autoResizePrompt();
				}
			}
			renderDialog(ui.dialog);
		}
		function renderDialog(dialog) {
			if (!dialog) {
				els.dialogBackdrop.classList.remove('open');
				els.dialog.innerHTML = '';
				return;
			}
			let body = '<h2>' + escapeHtml(dialog.title) + '</h2>';
			if (dialog.message) body += '<p>' + escapeHtml(dialog.message) + '</p>';
			if (dialog.kind === 'select') {
				body += '<div class="dialog-options">' + (dialog.options || []).map((option) =>
					'<button type="button" data-dialog-value="' + escapeHtml(option) + '">' +
					escapeHtml(option) + '</button>'
				).join('') + '</div>';
			}
			if (dialog.kind === 'input') {
				body += '<input id="dialogInput" placeholder="' + escapeHtml(dialog.placeholder || '') + '">';
			}
			if (dialog.kind === 'editor') {
				body += '<textarea id="dialogInput">' + escapeHtml(dialog.prefill || '') + '</textarea>';
			}
			body += '<div class="dialog-actions">';
			if (dialog.kind === 'confirm') {
				body += '<button type="button" data-dialog-confirm="false">Cancel</button>';
				body += '<button class="primary" type="button" data-dialog-confirm="true">Confirm</button>';
			} else {
				body += '<button type="button" data-dialog-cancel="true">Cancel</button>';
				if (dialog.kind !== 'select') body += '<button class="primary" type="button" data-dialog-submit="true">Submit</button>';
			}
			body += '</div>';
			els.dialog.innerHTML = body;
			els.dialogBackdrop.classList.add('open');
		}
		function render() {
			applyTheme();
			applyDetailsToggle();
			applyLayout();
			const snapshot = state.snapshot;
			if (!snapshot) {
				els.status.textContent = state.connected ? 'Preparing session' : 'Connecting';
				els.error.textContent = state.error;
				return;
			}
			els.dot.classList.toggle('running', !snapshot.isIdle);
			els.status.textContent = snapshot.isIdle ? 'Idle' : 'Running';
			if (snapshot.pendingMessageCount) els.status.textContent += ' - ' + snapshot.pendingMessageCount + ' queued';
			if (snapshot.notice) els.status.textContent += ' - ' + snapshot.notice;
			els.abort.disabled = snapshot.isIdle;
			els.stop.disabled = snapshot.isIdle;
			els.send.textContent = snapshot.isIdle ? 'Send' : 'Queue';
			renderSessions(snapshot);
			renderHistory(snapshot);
			renderCommands(snapshot);
			renderModelControls(snapshot);
			renderSettings(snapshot);
			renderTree(snapshot);
			renderArtifactsList(snapshot);
			renderTools(snapshot);
			renderExtensionUi(snapshot);
			renderTranscript(snapshot);
			renderCommandAutocomplete();
			els.error.textContent = state.error;
		}
		async function postJson(path, payload) {
			state.error = '';
			render();
			const response = await fetch(apiPath(path), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload || {})
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || response.statusText);
			return data;
		}
		function activeSessionId() {
			return state.snapshot && state.snapshot.activeSessionId;
		}
		function requestStop() {
			const snapshot = state.snapshot;
			if (!snapshot || snapshot.isIdle) return;
			postJson('/api/abort', { sessionId: activeSessionId() }).catch(handleError);
		}
		function handleEscapeStop(event) {
			if (event.key !== 'Escape' || event.isComposing || event.repeat) return;
			const now = Date.now();
			const isDoubleEscape = now - state.lastEscapeAt < 800;
			const wasUiEscapeTarget = state.commandOpen || state.modelOpen || els.dialogBackdrop.classList.contains('open');
			state.lastEscapeAt = now;
			if (!state.snapshot || state.snapshot.isIdle) return;
			if (wasUiEscapeTarget && !isDoubleEscape) return;
			event.preventDefault();
			requestStop();
		}
		async function send(mode) {
			const message = els.prompt.value.trim();
			if (!message) return;
			const sessionId = activeSessionId();
			const optimisticEntry = createOptimisticEntry(sessionId, message, mode);
			state.optimisticMessages.push(optimisticEntry);
			const previousValue = els.prompt.value;
			els.prompt.value = '';
			state.userEdited = false;
			autoResizePrompt();
			renderCommandAutocomplete();
			render();
			try {
				await postJson('/api/send', { sessionId, message, mode });
			} catch (error) {
				removeOptimisticEntry(optimisticEntry.id);
				if (!els.prompt.value.trim()) {
					els.prompt.value = previousValue;
					state.userEdited = true;
					autoResizePrompt();
					renderCommandAutocomplete();
				}
				throw error;
			}
		}
		function handleError(error) {
			state.error = error.message || String(error);
			render();
		}

		els.composer.addEventListener('submit', (event) => {
			event.preventDefault();
			send('auto').catch(handleError);
		});
		els.steer.addEventListener('click', () => send('steer').catch(handleError));
		els.abort.addEventListener('click', requestStop);
		els.stop.addEventListener('click', requestStop);
		els.compact.addEventListener('click', () => postJson('/api/compact', { sessionId: activeSessionId() }).catch(handleError));
		els.newSession.addEventListener('click', () => postJson('/api/sessions', {}).then(closeMobileSidebar).catch(handleError));
		els.refreshHistory.addEventListener('click', () => postJson('/api/history/refresh', {}).catch(handleError));
		els.prompt.addEventListener('input', () => {
			state.userEdited = true;
			state.commandActiveIndex = 0;
			state.commandSuppressedToken = '';
			autoResizePrompt();
			renderCommandAutocomplete();
		});
		els.prompt.addEventListener('pointerdown', () => {
			state.promptResizeStartHeight = els.prompt.offsetHeight;
		});
		els.prompt.addEventListener('keydown', (event) => {
			if (event.isComposing) return;
			if (state.commandOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				const count = getCommandSuggestions().length;
				if (!count) return;
				event.preventDefault();
				state.commandActiveIndex = event.key === 'ArrowDown'
					? (state.commandActiveIndex + 1) % count
					: (state.commandActiveIndex - 1 + count) % count;
				renderCommandAutocomplete();
				return;
			}
			if (state.commandOpen && (event.key === 'Enter' || event.key === 'Tab')) {
				event.preventDefault();
				applyActiveCommandSuggestion();
				return;
			}
			if (state.commandOpen && event.key === 'Escape') {
				event.preventDefault();
				const token = getCommandToken();
				state.commandSuppressedToken = token ? token.token : '';
				state.commandOpen = false;
				els.commandSuggest.classList.remove('open');
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				send('auto').catch(handleError);
			}
		});
		els.commandSuggest.addEventListener('click', (event) => {
			const button = event.target.closest('[data-command-suggest]');
			if (!button) return;
			const suggestions = getCommandSuggestions();
			const command = suggestions[Number(button.getAttribute('data-command-suggest'))];
			if (command) insertSlashCommand(command.name);
		});
		els.theme.addEventListener('click', () => {
			state.theme = state.theme === 'dark' ? 'light' : 'dark';
			localStorage.setItem('pi-web-theme', state.theme);
			render();
		});
		els.details.addEventListener('click', () => {
			state.showDetails = !state.showDetails;
			localStorage.setItem('pi-web-details', state.showDetails ? '1' : '0');
			render();
		});
		els.sidebarToggle.addEventListener('click', toggleSidebar);
		els.sidebarBackdrop.addEventListener('click', closeMobileSidebar);
		els.panelToggle.addEventListener('click', () => {
			state.railOpen = !state.railOpen;
			applyLayout();
		});
		els.railBackdrop.addEventListener('click', closePanel);
		els.railClose.addEventListener('click', closePanel);
		els.modelInput.addEventListener('focus', () => {
			state.modelOpen = true;
			state.modelQuery = '';
			state.modelActiveIndex = 0;
			renderModelControls(state.snapshot || {});
			els.modelInput.select();
		});
		els.modelInput.addEventListener('input', () => {
			state.modelOpen = true;
			state.modelQuery = els.modelInput.value;
			state.modelActiveIndex = 0;
			renderModelControls(state.snapshot || {});
		});
		els.modelInput.addEventListener('keydown', (event) => {
			if (!state.snapshot || !state.snapshot.settings) return;
			const models = getFilteredModels(state.snapshot.settings).slice(0, 80);
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				if (!models.length) return;
				event.preventDefault();
				state.modelOpen = true;
				state.modelActiveIndex = event.key === 'ArrowDown'
					? (state.modelActiveIndex + 1) % models.length
					: (state.modelActiveIndex - 1 + models.length) % models.length;
				renderModelControls(state.snapshot);
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				const model = models[state.modelActiveIndex] || models[0];
				if (model) applyModel(model);
				return;
			}
			if (event.key === 'Escape') {
				state.modelOpen = false;
				renderModelControls(state.snapshot);
			}
		});
		els.modelOptions.addEventListener('mousedown', (event) => {
			event.preventDefault();
			const button = event.target.closest('[data-model-index]');
			if (!button || !state.snapshot || !state.snapshot.settings) return;
			const model = getFilteredModels(state.snapshot.settings).slice(0, 80)[Number(button.getAttribute('data-model-index'))];
			if (model) applyModel(model);
		});
		document.addEventListener('mousedown', (event) => {
			if (!els.modelCombo.contains(event.target)) {
				state.modelOpen = false;
				if (state.snapshot) renderModelControls(state.snapshot);
			}
			if (!els.prompt.contains(event.target) && !els.commandSuggest.contains(event.target)) {
				state.commandOpen = false;
				els.commandSuggest.classList.remove('open');
			}
		});
		document.addEventListener('keydown', handleEscapeStop, true);
		window.addEventListener('pointerup', () => {
			if (!state.promptResizeStartHeight) return;
			const height = els.prompt.offsetHeight;
			const resized = Math.abs(height - state.promptResizeStartHeight) > 4;
			state.promptResizeStartHeight = 0;
			if (!resized) return;
			state.promptManualHeight = height;
			localStorage.setItem('pi-web-prompt-height', String(height));
			autoResizePrompt();
		});
		window.addEventListener('resize', () => {
			applyLayout();
			autoResizePrompt();
		});
		els.historyFilter.addEventListener('input', () => {
			state.historyFilter = els.historyFilter.value;
			render();
		});
		els.commandFilter.addEventListener('input', () => {
			state.commandFilter = els.commandFilter.value;
			render();
		});
		els.thinkingSelect.addEventListener('change', () => {
			if (!els.thinkingSelect.value) return;
			postJson('/api/settings', {
				sessionId: activeSessionId(),
				action: 'setThinkingLevel',
				thinkingLevel: els.thinkingSelect.value
			}).catch(handleError);
		});
		els.sessions.addEventListener('click', (event) => {
			const button = event.target.closest('[data-session-id]');
			if (!button) return;
			postJson('/api/select-session', { sessionId: button.getAttribute('data-session-id') })
				.then(closeMobileSidebar)
				.catch(handleError);
		});
		els.history.addEventListener('click', (event) => {
			const button = event.target.closest('[data-history-path]');
			if (!button) return;
			postJson('/api/resume', { path: button.getAttribute('data-history-path') })
				.then(closeMobileSidebar)
				.catch(handleError);
		});
		els.commands.addEventListener('click', (event) => {
			const button = event.target.closest('[data-command]');
			if (!button) return;
			insertSlashCommand(button.getAttribute('data-command'));
			closeMobileSidebar();
		});
		els.artifactsList.addEventListener('click', (event) => {
			const button = event.target.closest('[data-artifact-jump]');
			if (!button) return;
			const target = document.getElementById(artifactDomId(button.getAttribute('data-artifact-jump')));
			if (!target) return;
			target.scrollIntoView({ block: 'center', behavior: 'smooth' });
			closePanel();
		});
		els.settingsGrid.addEventListener('change', (event) => {
			const target = event.target;
			let payload = null;
			if (target.id === 'steeringMode') payload = { action: 'setSteeringMode', mode: target.value };
			if (target.id === 'followUpMode') payload = { action: 'setFollowUpMode', mode: target.value };
			if (target.id === 'autoCompact') payload = { action: 'setAutoCompaction', enabled: target.checked };
			if (!payload) return;
			payload.sessionId = activeSessionId();
			postJson('/api/settings', payload).catch(handleError);
		});
		els.tree.addEventListener('click', (event) => {
			const go = event.target.closest('[data-tree-go]');
			const fork = event.target.closest('[data-tree-fork]');
			if (go) {
				postJson('/api/tree-navigate', {
					sessionId: activeSessionId(),
					entryId: go.getAttribute('data-tree-go'),
					summarize: els.treeSummarize.checked,
					customInstructions: els.treeInstructions.value
				}).catch(handleError);
			}
			if (fork) {
				postJson('/api/fork', {
					sessionId: activeSessionId(),
					entryId: fork.getAttribute('data-tree-fork'),
					position: 'before'
				}).catch(handleError);
			}
		});
		els.dialog.addEventListener('click', (event) => {
			const snapshot = state.snapshot;
			const dialog = snapshot && snapshot.extensionUi && snapshot.extensionUi.dialog;
			if (!dialog) return;
			const option = event.target.closest('[data-dialog-value]');
			const confirm = event.target.closest('[data-dialog-confirm]');
			const cancel = event.target.closest('[data-dialog-cancel]');
			const submit = event.target.closest('[data-dialog-submit]');
			let payload = null;
			if (option) payload = { value: option.getAttribute('data-dialog-value'), cancelled: false };
			if (confirm) {
				const ok = confirm.getAttribute('data-dialog-confirm') === 'true';
				payload = { confirmed: ok, cancelled: !ok };
			}
			if (cancel) payload = { cancelled: true };
			if (submit) {
				const input = document.getElementById('dialogInput');
				payload = { value: input ? input.value : '', cancelled: false };
			}
			if (!payload) return;
			payload.sessionId = activeSessionId();
			payload.requestId = dialog.id;
			postJson('/api/dialog-response', payload).catch(handleError);
		});

		const events = new EventSource(apiPath('/events'));
		events.addEventListener('open', () => {
			state.connected = true;
			state.error = '';
			render();
		});
		events.addEventListener('error', () => {
			state.connected = false;
			state.error = 'Disconnected from Pi web server';
			render();
		});
		events.addEventListener('snapshot', (event) => {
			state.snapshot = JSON.parse(event.data);
			state.connected = true;
			state.error = '';
			render();
		});
		fetch(apiPath('/api/state'))
			.then((response) => response.json())
			.then((snapshot) => {
				state.snapshot = snapshot;
				render();
			})
			.catch(handleError);
		applyTheme();
		applyLayout();
		autoResizePrompt();
	</script>
</body>
</html>`;
