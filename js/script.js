const PREF_KEY = 'veille-info-preferences';
const HISTORY_KEY = 'veille-info-history';
const THEME_KEY = 'veille-info-theme';
const LOCAL_API_BASES = ['http://localhost:3000', 'http://127.0.0.1:3000'];

const CATEGORY_LABELS = {
	all: 'Toutes les catégories',
	cybersécurité: 'Cybersécurité',
	intelligence_artificielle: 'Intelligence artificielle',
	développement: 'Développement',
	hardware: 'Hardware',
	jeux_video: 'Jeux vidéo',
	actualités_tech: 'Actualités tech',
	réseaux: 'Réseaux'
};

const state = {
	bootstrap: null,
	articles: [],
	sources: [],
	history: [],
	categories: [],
	trends: { categoryCounts: {}, topKeywords: [], dailySeries: [] },
	filters: {
		search: '',
		category: 'all',
		source: 'all',
		date: 'all',
		scoreSort: 'score-desc',
		unreadOnly: false,
		favoritesOnly: false
	},
	preferences: {
		theme: 'dark',
		autoRefresh: true,
		notifications: false,
		refreshIntervalMinutes: 15
	},
	latestLinks: new Set(),
	autoRefreshTimer: null,
	syncRunning: false
};

const dom = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
	cacheDom();
	loadPreferences();
	bindEvents();
	applyTheme();
	hydrateFilterUi();
	await loadData({ quiet: true });
	startAutoRefresh();
}

function cacheDom() {
	const ids = [
		'syncStatus',
		'lastSync',
		'searchInput',
		'refreshNow',
		'themeToggle',
		'autoRefreshToggle',
		'exportOpml',
		'importOpml',
		'statsGrid',
		'categoryFilter',
		'sourceFilter',
		'dateFilter',
		'scoreSort',
		'unreadOnly',
		'favoritesOnly',
		'clearFilters',
		'toggleNotifications',
		'feedList',
		'resultCount',
		'trendTags',
		'categorySummary',
		'sourcesList',
		'sourceName',
		'sourceUrl',
		'sourceCategory',
		'sourceIcon',
		'addSourceForm',
		'categoryChart',
		'dailyChart',
		'analyticsStats',
		'historyList',
		'articleModal',
		'modalContent',
		'toastContainer',
		'heroImportant',
		'heroSources',
		'heroScore',
		'heroAlerts'
	];

	ids.forEach((id) => {
		dom[id] = document.getElementById(id);
	});
}

function loadPreferences() {
	try {
		const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
		const theme = localStorage.getItem(THEME_KEY);
		state.preferences = {
			...state.preferences,
			...stored,
			theme: theme || stored.theme || 'dark'
		};

		if (stored.filters && typeof stored.filters === 'object') {
			state.filters = {
				...state.filters,
				...stored.filters
			};
		}

		const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
		state.history = Array.isArray(history) ? history : [];
	} catch (error) {
		console.warn('Impossible de charger les préférences', error);
	}
}

function savePreferences() {
	localStorage.setItem(PREF_KEY, JSON.stringify({
		theme: state.preferences.theme,
		autoRefresh: state.preferences.autoRefresh,
		notifications: state.preferences.notifications,
		refreshIntervalMinutes: state.preferences.refreshIntervalMinutes,
		filters: state.filters
	}));
	localStorage.setItem(THEME_KEY, state.preferences.theme);
	localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 40)));
}

function bindEvents() {
	dom.searchInput.addEventListener('input', (event) => {
		state.filters.search = event.target.value.trim();
		savePreferences();
		renderAll();
	});

	dom.categoryFilter.addEventListener('change', (event) => {
		state.filters.category = event.target.value;
		savePreferences();
		renderAll();
	});

	dom.sourceFilter.addEventListener('change', (event) => {
		state.filters.source = event.target.value;
		savePreferences();
		renderAll();
	});

	dom.dateFilter.addEventListener('change', (event) => {
		state.filters.date = event.target.value;
		savePreferences();
		renderAll();
	});

	dom.scoreSort.addEventListener('change', (event) => {
		state.filters.scoreSort = event.target.value;
		savePreferences();
		renderAll();
	});

	dom.unreadOnly.addEventListener('change', (event) => {
		state.filters.unreadOnly = event.target.checked;
		savePreferences();
		renderAll();
	});

	dom.favoritesOnly.addEventListener('change', (event) => {
		state.filters.favoritesOnly = event.target.checked;
		savePreferences();
		renderAll();
	});

	dom.clearFilters.addEventListener('click', () => {
		state.filters = {
			search: '',
			category: 'all',
			source: 'all',
			date: 'all',
			scoreSort: 'score-desc',
			unreadOnly: false,
			favoritesOnly: false
		};
		hydrateFilterUi();
		savePreferences();
		renderAll();
		showToast('Filtres réinitialisés', 'Vous revenez à la vue par défaut.');
	});

	dom.themeToggle.addEventListener('click', () => {
		state.preferences.theme = state.preferences.theme === 'dark' ? 'light' : 'dark';
		applyTheme();
		savePreferences();
		showToast('Thème appliqué', state.preferences.theme === 'dark' ? 'Mode sombre activé' : 'Mode clair activé');
	});

	dom.autoRefreshToggle.addEventListener('click', () => {
		state.preferences.autoRefresh = !state.preferences.autoRefresh;
		savePreferences();
		startAutoRefresh();
		updateAutoRefreshButton();
		showToast('Actualisation automatique', state.preferences.autoRefresh ? 'Réactivée' : 'Désactivée');
	});

	dom.toggleNotifications.addEventListener('click', async () => {
		if (!('Notification' in window)) {
			showToast('Notifications indisponibles', 'Votre navigateur ne prend pas en charge les notifications de bureau.');
			return;
		}

		if (Notification.permission === 'default') {
			const permission = await Notification.requestPermission();
			state.preferences.notifications = permission === 'granted';
		} else {
			state.preferences.notifications = Notification.permission === 'granted';
		}

		savePreferences();
		showToast('Notifications', state.preferences.notifications ? 'Activées' : 'Non autorisées');
	});

	dom.refreshNow.addEventListener('click', async () => {
		await refreshAll(true);
	});

	dom.exportOpml.addEventListener('click', exportOpml);
	dom.importOpml.addEventListener('change', importOpml);

	dom.addSourceForm.addEventListener('submit', addSource);

	dom.feedList.addEventListener('click', handleFeedAction);
	dom.sourcesList.addEventListener('click', handleSourceAction);
	dom.historyList.addEventListener('click', handleHistoryAction);

	dom.articleModal.addEventListener('click', (event) => {
		if (event.target.matches('[data-close-modal]')) {
			closeModal();
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			closeModal();
		}
	});
}

function hydrateFilterUi() {
	dom.searchInput.value = state.filters.search;
	dom.categoryFilter.value = state.filters.category;
	dom.sourceFilter.value = state.filters.source;
	dom.dateFilter.value = state.filters.date;
	dom.scoreSort.value = state.filters.scoreSort;
	dom.unreadOnly.checked = state.filters.unreadOnly;
	dom.favoritesOnly.checked = state.filters.favoritesOnly;
	updateThemeButton();
	updateAutoRefreshButton();
}

function applyTheme() {
	document.documentElement.dataset.theme = state.preferences.theme;
	updateThemeButton();
}

function updateThemeButton() {
	dom.themeToggle.textContent = state.preferences.theme === 'dark' ? 'Mode clair' : 'Mode sombre';
}

function updateAutoRefreshButton() {
	dom.autoRefreshToggle.textContent = `Auto-refresh: ${state.preferences.autoRefresh ? 'actif' : 'désactivé'}`;
}

function startAutoRefresh() {
	if (state.autoRefreshTimer) {
		clearInterval(state.autoRefreshTimer);
		state.autoRefreshTimer = null;
	}

	if (!state.preferences.autoRefresh) {
		return;
	}

	state.autoRefreshTimer = setInterval(() => {
		refreshAll(false);
	}, state.preferences.refreshIntervalMinutes * 60 * 1000);
}

async function loadData({ quiet = false } = {}) {
	setSyncStatus('Chargement...');

	try {
		const [bootstrap, articlesPayload, historyPayload] = await Promise.all([
			api('/api/bootstrap'),
			api('/api/articles?limit=400'),
			api('/api/history')
		]);

		state.bootstrap = bootstrap;
		state.sources = Array.isArray(bootstrap.sources) ? bootstrap.sources : [];
		state.categories = Array.isArray(bootstrap.categories) ? bootstrap.categories : [];
		state.trends = bootstrap.trends || { categoryCounts: {}, topKeywords: [], dailySeries: [] };
		state.articles = Array.isArray(articlesPayload.articles) ? articlesPayload.articles : [];
		state.history = Array.isArray(historyPayload.history) && historyPayload.history.length
			? historyPayload.history
			: state.history;

		populateSelects();
		renderAll();

		state.latestLinks = new Set(state.articles.map((article) => article.link));
		savePreferences();

		setSyncStatus('Synchronisé', new Date());
		if (!quiet) {
			showToast('Synchronisation terminée', `${state.articles.length} articles chargés depuis ${state.sources.length} sources.`);
		}
	} catch (error) {
		console.error(error);
		setSyncStatus('Erreur de synchronisation');
		showToast('Erreur', 'Impossible de charger les flux ou l’API locale.');
	}
}

function populateSelects() {
	const categoryOptions = ['<option value="all">Toutes les catégories</option>']
		.concat(state.categories.map((category) => `<option value="${escapeHtml(category.value)}">${escapeHtml(category.label)}</option>`))
		.join('');
	dom.categoryFilter.innerHTML = categoryOptions;
	dom.sourceCategory.innerHTML = ['<option value="actualités_tech">Actualités tech</option>']
		.concat(state.categories.filter((category) => category.value !== 'all').map((category) => `<option value="${escapeHtml(category.value)}">${escapeHtml(category.label)}</option>`))
		.join('');

	const sourceOptions = ['<option value="all">Toutes les sources</option>']
		.concat(state.sources.map((source) => `<option value="${source.id}">${escapeHtml(source.name)}</option>`))
		.join('');

	dom.sourceFilter.innerHTML = sourceOptions;

	if (!state.filters.category) {
		state.filters.category = 'all';
	}

	if (!state.filters.source) {
		state.filters.source = 'all';
	}

	hydrateFilterUi();
}

function renderAll() {
	const visibleArticles = filterArticles(state.articles);
	renderStats(visibleArticles);
	renderHero(visibleArticles);
	renderFeed(visibleArticles);
	renderSources();
	renderTrendWidgets();
	renderAnalytics();
	renderHistory();
}

function renderStats(visibleArticles) {
	const stats = state.bootstrap?.stats || {};
	const averageScore = average(visibleArticles.map((article) => article.score));
	const importantCount = visibleArticles.filter((article) => article.score >= 70).length;

	dom.statsGrid.innerHTML = [
		statCard('Articles', stats.totalArticles ?? state.articles.length, 'Contenu total centralisé.'),
		statCard('Non lus', stats.unreadArticles ?? visibleArticles.filter((article) => !article.read).length, 'À traiter rapidement.'),
		statCard('Favoris', stats.favoriteArticles ?? visibleArticles.filter((article) => article.favorite).length, 'Articles à conserver.'),
		statCard('Sources actives', stats.activeSources ?? state.sources.filter((source) => source.enabled).length, 'Flux en surveillance continue.')
	].join('');

	dom.resultCount.textContent = `${visibleArticles.length} article${visibleArticles.length > 1 ? 's' : ''}`;
	dom.heroImportant.textContent = importantCount;
	dom.heroSources.textContent = stats.activeSources ?? state.sources.filter((source) => source.enabled).length;
	dom.heroScore.textContent = `${Math.round(averageScore || 0)}`;
	dom.heroAlerts.textContent = String(stats.sourceErrors ?? 0);
}

function renderHero(visibleArticles) {
	const important = visibleArticles.filter((article) => article.score >= 70).length;
	const unreadImportant = visibleArticles.filter((article) => article.score >= 70 && !article.read).length;
	if (unreadImportant > 0 && state.preferences.notifications && 'Notification' in window && Notification.permission === 'granted') {
		// handled during refresh, but keeping the metric live
	}
	dom.heroImportant.textContent = important;
}

function statCard(title, value, description) {
	return `
		<article class="stat-card">
			<p class="eyebrow">${escapeHtml(title)}</p>
			<div class="value">${escapeHtml(String(value))}</div>
			<p>${escapeHtml(description)}</p>
		</article>
	`;
}

function renderFeed(articles) {
	if (!articles.length) {
		dom.feedList.innerHTML = '<div class="feed-empty">Aucun article ne correspond aux filtres en cours.</div>';
		return;
	}

	dom.feedList.innerHTML = articles.map((article) => articleCard(article)).join('');
}

function articleCard(article) {
	const tags = Array.isArray(article.tags) ? article.tags : [];
	const sourceInitials = initials(article.sourceDisplayName || article.sourceName || 'SN');
	const scoreClassName = scoreClass(article.score);
	const readState = article.read ? 'Lu' : 'Non lu';
	const favoriteLabel = article.favorite ? 'Retirer favori' : 'Favori';
	const readLabel = article.read ? 'Marquer non lu' : 'Marquer lu';

	return `
		<article class="article-card ${article.read ? 'read' : ''}" data-article-id="${article.id}">
			<div class="article-top">
				<div class="article-headline">
					<div class="article-source-row">
						<span class="source-icon" aria-hidden="true">${escapeHtml(sourceInitials)}</span>
						<span class="article-badge">${escapeHtml(article.categoryLabel || CATEGORY_LABELS[article.category] || article.category)}</span>
						<span class="source-pill ${article.read ? 'active' : 'inactive'}">${escapeHtml(readState)}</span>
						<span class="score-pill ${scoreClassName}">${article.score}/100</span>
					</div>
					<h4 class="article-title">${escapeHtml(article.title)}</h4>
					<p class="article-summary">${escapeHtml(summaryText(article))}</p>
					<p class="article-meta">${escapeHtml(article.sourceDisplayName || article.sourceName)} · ${escapeHtml(article.publishedLabel || formatDate(article.publishedAt))}</p>
					<div class="article-tags">
						${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
					</div>
				</div>

				<div class="article-actions">
					<button type="button" class="btn btn-ghost" data-action="open">Détails</button>
					<button type="button" class="btn btn-secondary" data-action="read">${escapeHtml(readLabel)}</button>
					<button type="button" class="btn btn-ghost" data-action="favorite">${escapeHtml(favoriteLabel)}</button>
					<a class="btn btn-primary" href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>
				</div>
			</div>
		</article>
	`;
}

function renderSources() {
	const articleCountBySource = state.articles.reduce((accumulator, article) => {
		accumulator[article.sourceId] = (accumulator[article.sourceId] || 0) + 1;
		return accumulator;
	}, {});

	if (!state.sources.length) {
		dom.sourcesList.innerHTML = '<div class="source-empty">Aucune source configurée.</div>';
		return;
	}

	dom.sourcesList.innerHTML = state.sources.map((source) => {
		const count = articleCountBySource[source.id] || 0;
		const statusClass = source.enabled ? 'active' : 'inactive';
		const statusLabel = source.enabled ? 'Actif' : 'Désactivé';
		const errorLabel = source.lastError ? `Erreur: ${escapeHtml(source.lastError)}` : 'Aucune erreur';

		return `
			<article class="source-card" data-source-id="${source.id}">
				<div class="source-head">
					<div class="source-name">
						<strong>${escapeHtml(source.name)}</strong>
						<span class="article-source">${escapeHtml(source.url)}</span>
					</div>
					<div class="source-icon">${escapeHtml((source.icon || source.name).slice(0, 2).toUpperCase())}</div>
				</div>
				<div class="article-source-row">
					<span class="article-badge">${escapeHtml(CATEGORY_LABELS[source.category] || source.category)}</span>
					<span class="source-pill ${statusClass}">${statusLabel}</span>
					<span class="source-pill">${count} article${count > 1 ? 's' : ''}</span>
				</div>
				<p>${errorLabel}</p>
				<div class="source-actions">
					<button type="button" class="btn btn-ghost" data-action="toggle-source">${source.enabled ? 'Suspendre' : 'Réactiver'}</button>
					<button type="button" class="btn btn-secondary" data-action="delete-source">Supprimer</button>
				</div>
			</article>
		`;
	}).join('');
}

function renderTrendWidgets() {
	const trends = state.trends || { categoryCounts: {}, topKeywords: [], dailySeries: [] };
	const categoryEntries = Object.entries(trends.categoryCounts || {});
	const maxCategory = Math.max(1, ...categoryEntries.map(([, value]) => value));
	const maxDaily = Math.max(1, ...(trends.dailySeries || []).map((item) => item.value));

	dom.trendTags.innerHTML = (trends.topKeywords || []).length
		? trends.topKeywords.map((item) => `<span class="chip"><span>${escapeHtml(item.label)}</span><strong>${item.value}</strong></span>`).join('')
		: '<div class="feed-empty">Aucune tendance détectée pour le moment.</div>';

	dom.categorySummary.innerHTML = categoryEntries.length
		? categoryEntries.map(([category, value]) => {
			const percentage = Math.round((value / maxCategory) * 100);
			return `
				<div class="category-row">
					<div class="article-source-row">
						<strong>${escapeHtml(CATEGORY_LABELS[category] || category)}</strong>
						<span class="section-note">${value} items</span>
					</div>
					<div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div>
				</div>
			`;
		}).join('')
		: '<div class="feed-empty">Les catégories apparaîtront après synchronisation.</div>';

	dom.categoryChart.innerHTML = categoryEntries.length
		? categoryEntries.map(([category, value]) => {
			const percentage = Math.round((value / maxCategory) * 100);
			return `
				<div class="chart-row">
					<div class="article-source-row">
						<strong>${escapeHtml(CATEGORY_LABELS[category] || category)}</strong>
						<span class="section-note">${value}</span>
					</div>
					<div class="chart-track"><div class="chart-fill" style="width:${percentage}%"></div></div>
				</div>
			`;
		}).join('')
		: '<div class="feed-empty">Pas encore assez de données.</div>';

	dom.dailyChart.innerHTML = (trends.dailySeries || []).length
		? trends.dailySeries.map((item) => {
			const percentage = Math.max(8, Math.round((item.value / maxDaily) * 100));
			return `
				<div class="chart-row">
					<div class="article-source-row">
						<strong>${escapeHtml(item.label)}</strong>
						<span class="section-note">${item.value}</span>
					</div>
					<div class="chart-track"><div class="chart-fill" style="width:${percentage}%"></div></div>
				</div>
			`;
		}).join('')
		: '<div class="feed-empty">Aucune publication récente à afficher.</div>';
}

function renderAnalytics() {
	const visibleArticles = filterArticles(state.articles);
	const averageScoreValue = average(visibleArticles.map((article) => article.score));
	const unreadRate = visibleArticles.length ? Math.round((visibleArticles.filter((article) => !article.read).length / visibleArticles.length) * 100) : 0;
	const favoriteRate = visibleArticles.length ? Math.round((visibleArticles.filter((article) => article.favorite).length / visibleArticles.length) * 100) : 0;
	const topCategory = topCategoryName();
	const sourceErrors = state.sources.filter((source) => source.lastError).length;

	dom.analyticsStats.innerHTML = [
		analyticsCard('Score moyen', `${Math.round(averageScoreValue || 0)}/100`, 'Pertinence globale du corpus.', 'good'),
		analyticsCard('Non lus', `${unreadRate}%`, 'Part d’articles encore à traiter.', 'warning'),
		analyticsCard('Favoris', `${favoriteRate}%`, 'Proportion sauvegardée.', 'good'),
		analyticsCard('Flux en erreur', `${sourceErrors}`, 'Sources à corriger ou vérifier.', sourceErrors ? 'critical' : 'good'),
		analyticsCard('Top catégorie', topCategory, 'Thème le plus présent dans vos flux.', 'good')
	].join('');
}

function renderHistory() {
	if (!state.history.length) {
		dom.historyList.innerHTML = '<div class="history-empty">Aucun historique pour le moment.</div>';
		return;
	}

	dom.historyList.innerHTML = state.history.slice(0, 12).map((entry) => `
		<div class="history-item" data-history-id="${entry.id}">
			<div>
				<strong>${escapeHtml(entry.title || 'Article')}</strong>
				<p>${escapeHtml(historyLabel(entry.action))} · ${escapeHtml(formatDate(entry.createdAt))}</p>
			</div>
			<div class="article-source-row">
				<span class="article-badge">${escapeHtml(CATEGORY_LABELS[entry.category] || entry.category)}</span>
				<span class="score-pill ${scoreClass(entry.score)}">${entry.score}/100</span>
			</div>
		</div>
	`).join('');
}

function analyticsCard(title, value, description, tone) {
	return `
		<article class="analytics-card">
			<p class="eyebrow">${escapeHtml(title)}</p>
			<div class="value ${tone || ''}">${escapeHtml(String(value))}</div>
			<p>${escapeHtml(description)}</p>
		</article>
	`;
}

function filterArticles(articles) {
	const search = normalize(state.filters.search);
	const fromDate = dateBoundary(state.filters.date);

	return articles
		.filter((article) => {
			if (state.filters.category !== 'all' && article.category !== state.filters.category) {
				return false;
			}

			if (state.filters.source !== 'all' && String(article.sourceId) !== String(state.filters.source)) {
				return false;
			}

			if (state.filters.unreadOnly && article.read) {
				return false;
			}

			if (state.filters.favoritesOnly && !article.favorite) {
				return false;
			}

			if (fromDate && new Date(article.publishedAt).getTime() < fromDate) {
				return false;
			}

			if (!search) {
				return true;
			}

			const haystack = normalize([
				article.title,
				article.summary,
				article.content,
				article.sourceDisplayName,
				article.categoryLabel,
				...(article.tags || [])
			].join(' '));

			return haystack.includes(search);
		})
		.sort((a, b) => {
			if (state.filters.scoreSort === 'score-asc') {
				return a.score - b.score || new Date(b.publishedAt) - new Date(a.publishedAt);
			}

			return b.score - a.score || new Date(b.publishedAt) - new Date(a.publishedAt);
		});
}

async function refreshAll(manual) {
	if (state.syncRunning) {
		return;
	}

	state.syncRunning = true;
	setSyncStatus(manual ? 'Actualisation...' : 'Mise à jour automatique...');

	try {
		const previousLinks = new Set(state.articles.map((article) => article.link));
		const response = await api('/api/refresh', { method: 'POST' });
		await loadData({ quiet: true });

		const newArticles = state.articles.filter((article) => !previousLinks.has(article.link));
		const importantNewArticles = newArticles.filter((article) => article.score >= 70);

		if (newArticles.length) {
			showToast('Nouveaux contenus détectés', `${newArticles.length} nouvel${newArticles.length > 1 ? 's' : ''} article${newArticles.length > 1 ? 's' : ''} intégré${newArticles.length > 1 ? 's' : ''}.`);
		}

		if (importantNewArticles.length) {
			notifyImportant(importantNewArticles);
		}

		const totalInserted = Array.isArray(response.results)
			? response.results.reduce((sum, item) => sum + (item.inserted || 0), 0)
			: newArticles.length;

		setSyncStatus('Synchronisé', new Date());
		if (manual) {
			showToast('Synchronisation terminée', `${totalInserted} nouveaux articles trouvés.`);
		}
	} catch (error) {
		console.error(error);
		setSyncStatus('Erreur de synchronisation');
		showToast('Erreur de synchronisation', 'Impossible d’actualiser les flux.');
	} finally {
		state.syncRunning = false;
	}
}

function notifyImportant(articles) {
	if (!state.preferences.notifications || !('Notification' in window) || Notification.permission !== 'granted') {
		return;
	}

	articles.slice(0, 3).forEach((article) => {
		new Notification(article.title, {
			body: `${article.sourceDisplayName || article.sourceName} · ${article.categoryLabel || CATEGORY_LABELS[article.category]}`,
			icon: undefined
		});
	});
}

async function addSource(event) {
	event.preventDefault();

	const name = dom.sourceName.value.trim();
	const url = dom.sourceUrl.value.trim();
	const category = dom.sourceCategory.value;
	const icon = dom.sourceIcon.value.trim();

	if (!name || !url || !category) {
		showToast('Source incomplète', 'Le nom, l’URL et la catégorie sont requis.');
		return;
	}

	try {
		await api('/api/sources', {
			method: 'POST',
			body: { name, url, category, icon }
		});

		dom.addSourceForm.reset();
		showToast('Source ajoutée', `${name} a été enregistrée.`);
		await refreshAll(true);
	} catch (error) {
		showToast('Ajout impossible', error.message || 'La source existe déjà ou l’URL est invalide.');
	}
}

async function handleFeedAction(event) {
	const button = event.target.closest('[data-action]');
	const card = event.target.closest('[data-article-id]');

	if (!button || !card) {
		return;
	}

	const articleId = Number(card.dataset.articleId);
	const article = state.articles.find((item) => item.id === articleId);

	if (!article) {
		return;
	}

	const action = button.dataset.action;

	if (action === 'open') {
		openModal(article);
		await markArticle(articleId, { read: true });
	}

	if (action === 'read') {
		const wasRead = Boolean(article.read);
		await markArticle(articleId, { read: !article.read });
		showToast('Statut mis à jour', wasRead ? 'Article remis en non lu.' : 'Article marqué comme lu.');
	}

	if (action === 'favorite') {
		const wasFavorite = Boolean(article.favorite);
		await markArticle(articleId, { favorite: !article.favorite });
		showToast('Favoris', wasFavorite ? 'Retiré des favoris.' : 'Ajouté aux favoris.');
	}
}

async function handleSourceAction(event) {
	const button = event.target.closest('[data-action]');
	const card = event.target.closest('[data-source-id]');

	if (!button || !card) {
		return;
	}

	const sourceId = Number(card.dataset.sourceId);
	const source = state.sources.find((item) => item.id === sourceId);

	if (!source) {
		return;
	}

	if (button.dataset.action === 'toggle-source') {
		await api(`/api/sources/${sourceId}`, {
			method: 'PATCH',
			body: { enabled: !source.enabled }
		});
		showToast('Source mise à jour', `${source.name} est maintenant ${source.enabled ? 'suspendue' : 'active'}.`);
		await loadData({ quiet: true });
		return;
	}

	if (button.dataset.action === 'delete-source') {
		if (!window.confirm(`Supprimer la source ${source.name} ?`)) {
			return;
		}

		await api(`/api/sources/${sourceId}`, { method: 'DELETE' });
		showToast('Source supprimée', `${source.name} a été retirée.`);
		await refreshAll(true);
	}
}

async function handleHistoryAction(event) {
	const card = event.target.closest('[data-history-id]');
	if (!card) {
		return;
	}

	const entry = state.history.find((item) => String(item.id) === card.dataset.historyId);
	if (!entry || !entry.link) {
		return;
	}

	window.open(entry.link, '_blank', 'noopener,noreferrer');
}

async function markArticle(articleId, patch) {
	await api(`/api/articles/${articleId}`, {
		method: 'PATCH',
		body: patch
	});

	await loadData({ quiet: true });
}

function openModal(article) {
	dom.modalContent.innerHTML = `
		<p class="eyebrow">${escapeHtml(article.categoryLabel || CATEGORY_LABELS[article.category] || article.category)}</p>
		<h3>${escapeHtml(article.title)}</h3>
		<div class="detail-meta">
			<span class="article-badge">${escapeHtml(article.sourceDisplayName || article.sourceName)}</span>
			<span class="source-pill ${article.read ? 'active' : 'inactive'}">${article.read ? 'Lu' : 'Non lu'}</span>
			<span class="score-pill ${scoreClass(article.score)}">${article.score}/100</span>
			<span class="source-pill">${escapeHtml(article.publishedLabel || formatDate(article.publishedAt))}</span>
		</div>
		<div class="detail-body">
			<p>${escapeHtml(summaryText(article, 900))}</p>
			<p>${escapeHtml(stripTags(article.content || article.summary || 'Aucun contenu détaillé disponible pour cet article.'))}</p>
			<div class="article-tags">
				${(article.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
			</div>
			<a class="btn btn-primary" href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">Lire la source complète</a>
		</div>
	`;
	dom.articleModal.classList.add('open');
	dom.articleModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
	dom.articleModal.classList.remove('open');
	dom.articleModal.setAttribute('aria-hidden', 'true');
}

function showToast(title, message) {
	const toast = document.createElement('div');
	toast.className = 'toast';
	toast.innerHTML = `
		<div>
			<strong>${escapeHtml(title)}</strong>
			<span>${escapeHtml(message)}</span>
		</div>
		<button type="button" class="btn btn-ghost">OK</button>
	`;

	toast.querySelector('button').addEventListener('click', () => {
		toast.remove();
	});

	dom.toastContainer.appendChild(toast);
	setTimeout(() => toast.remove(), 4200);
}

function setSyncStatus(text, date = null) {
	dom.syncStatus.textContent = text;
	if (date) {
		dom.lastSync.textContent = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}
}

function populateSelectsFallbacks() {
	if (!state.categories.length) {
		state.categories = Object.entries(CATEGORY_LABELS)
			.filter(([value]) => value !== 'all')
			.map(([value, label]) => ({ value, label }));
	}
}

function topCategoryName() {
	const entries = Object.entries(state.trends.categoryCounts || {});
	if (!entries.length) {
		return 'N/A';
	}

	const [category] = entries.sort((a, b) => b[1] - a[1])[0];
	return CATEGORY_LABELS[category] || category;
}

function dateBoundary(value) {
	if (value === '24h') {
		return Date.now() - 24 * 60 * 60 * 1000;
	}
	if (value === '7d') {
		return Date.now() - 7 * 24 * 60 * 60 * 1000;
	}
	if (value === '30d') {
		return Date.now() - 30 * 24 * 60 * 60 * 1000;
	}
	return null;
}

function average(values) {
	const filtered = values.filter((value) => Number.isFinite(value));
	if (!filtered.length) {
		return 0;
	}
	return filtered.reduce((sum, value) => sum + Number(value), 0) / filtered.length;
}

async function exportOpml() {
	try {
		const response = await requestApi('/api/opml');
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'veille-sources.opml';
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		showToast('OPML exporté', 'Le fichier des sources a été téléchargé.');
	} catch (error) {
		showToast('Export impossible', 'La récupération du fichier OPML a échoué.');
	}
}

async function importOpml(event) {
	const file = event.target.files && event.target.files[0];
	event.target.value = '';

	if (!file) {
		return;
	}

	try {
		const content = await file.text();
		const parser = new DOMParser();
		const xml = parser.parseFromString(content, 'application/xml');
		const outlines = Array.from(xml.querySelectorAll('outline[xmlUrl]'));

		if (!outlines.length) {
			showToast('Import vide', 'Aucune source détectée dans le fichier OPML.');
			return;
		}

		let imported = 0;

		for (const outline of outlines) {
			const source = {
				name: outline.getAttribute('title') || outline.getAttribute('text') || 'Source importée',
				url: outline.getAttribute('xmlUrl'),
				category: outline.getAttribute('category') || 'actualités_tech',
				icon: (outline.getAttribute('title') || 'OP').slice(0, 2).toUpperCase()
			};

			try {
				await api('/api/sources', {
					method: 'POST',
					body: source
				});
				imported += 1;
			} catch (error) {
				// skip duplicates and invalid URLs without breaking the batch
			}
		}

		if (imported) {
			showToast('Import terminé', `${imported} source${imported > 1 ? 's' : ''} ajoutée${imported > 1 ? 's' : ''}.`);
			await refreshAll(true);
		} else {
			showToast('Import sans effet', 'Toutes les sources étaient déjà présentes ou invalides.');
		}
	} catch (error) {
		showToast('Import impossible', 'Le fichier OPML n’a pas pu être lu.');
	}
}

function formatDate(value) {
	if (!value) {
		return '-';
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? String(value)
		: date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function summaryText(article, limit = 260) {
	const source = stripTags(article.summary || article.content || '');
	return truncate(source || 'Aucun résumé disponible.', limit);
}

function stripTags(value) {
	return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value, length) {
	if (!value || value.length <= length) {
		return value;
	}

	return `${value.slice(0, length).trimEnd()}…`;
}

function scoreClass(score) {
	if (score >= 80) {
		return 'good';
	}

	if (score >= 55) {
		return 'warning';
	}

	return 'critical';
}

function initials(value) {
	return String(value || '')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0])
		.join('')
		.toUpperCase() || 'VI';
}

function historyLabel(action) {
	const labels = {
		created: 'Nouveau contenu ajouté',
		read: 'Article consulté',
		favorite: 'Ajouté aux favoris'
	};

	return labels[action] || action;
}

function normalize(value) {
	return String(value || '').toLowerCase();
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

async function api(url, options = {}) {
	const response = await requestApi(url, options);
	const contentType = response.headers.get('content-type') || '';
	const payload = contentType.includes('application/json') ? await response.json() : await response.text();

	if (!response.ok) {
		const error = new Error(payload?.error || payload || 'Une erreur est survenue');
		error.status = response.status;
		throw error;
	}

	return payload;
}

async function requestApi(url, options = {}) {
	const normalizedPath = url.startsWith('/') ? url : `/${url}`;
	const candidates = getApiBaseCandidates();
	let lastResponse = null;
	let lastError = null;
	const hasBody = typeof options.body !== 'undefined' && options.body !== null;
	const method = options.method || 'GET';

	for (const [index, baseUrl] of candidates.entries()) {
		try {
			const response = await fetch(new URL(normalizedPath, baseUrl).toString(), {
			method,
			headers: {
				Accept: 'application/json',
				...(hasBody ? { 'Content-Type': 'application/json' } : {}),
				...(options.headers || {})
			},
			body: hasBody ? JSON.stringify(options.body) : undefined
			});

			lastResponse = response;

			if (response.ok) {
				return response;
			}

			if (response.status !== 404 || index === candidates.length - 1) {
				return response;
			}
		} catch (error) {
			lastError = error;
	}

	}

	if (lastResponse) {
		return lastResponse;
	}

	throw lastError || new Error('Impossible de joindre l’API locale');
}

function getApiBaseCandidates() {
	const bases = [];
	const configuredBase = getConfiguredApiBase();
	const currentOrigin = getCurrentOrigin();
	const shouldAvoidCurrentOrigin = isGitHubPagesOrigin();

	if (configuredBase) {
		bases.push(configuredBase);
	}

	if (currentOrigin && !shouldAvoidCurrentOrigin && !bases.includes(currentOrigin)) {
		bases.push(currentOrigin);
	}

	if (isLocalDevelopmentContext()) {
		LOCAL_API_BASES.forEach((baseUrl) => {
			if (!bases.includes(baseUrl)) {
				bases.push(baseUrl);
			}
		});
	}

	return bases;
}

function getConfiguredApiBase() {
	const metaBase = document.querySelector('meta[name="api-base"]')?.getAttribute('content')?.trim();
	if (metaBase) {
		return metaBase.replace(/\/$/, '');
	}

	if (typeof window !== 'undefined') {
		const globalBase = window.API_BASE_URL || window.__API_BASE__;
		if (typeof globalBase === 'string' && globalBase.trim()) {
			return globalBase.trim().replace(/\/$/, '');
		}
	}

	return '';
}

function getCurrentOrigin() {
	if (typeof window === 'undefined' || !window.location) {
		return '';
	}

	if (window.location.protocol === 'file:') {
		return '';
	}

	return window.location.origin === 'null' ? '' : window.location.origin;
}

function isLocalDevelopmentContext() {
	if (typeof window === 'undefined' || !window.location) {
		return false;
	}

	return window.location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function isGitHubPagesOrigin() {
	if (typeof window === 'undefined' || !window.location) {
		return false;
	}

	return window.location.hostname.endsWith('github.io') || window.location.hostname.includes('github.pages');
}
