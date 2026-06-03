const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: ['content:encoded', 'media:content', 'dc:creator']
  }
});

const port = Number(process.env.PORT || 3000);
const isVercelDeployment = Boolean(process.env.VERCEL);
const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const dbPath = isVercelDeployment ? path.join(os.tmpdir(), 'veille.db') : path.join(dataDir, 'veille.db');

if (!isVercelDeployment) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const CATEGORY_KEYWORDS = {
  cybersécurité: ['cyber', 'security', 'hack', 'vulnerability', 'malware', 'ransomware', 'phishing', 'zero day', 'breach', 'incident', 'cve', 'exploit'],
  intelligence_artificielle: ['ai', 'intelligence artificielle', 'llm', 'machine learning', 'deep learning', 'openai', 'mistral', 'chatgpt', 'copilot', 'genai', 'prompt'],
  développement: ['developer', 'development', 'javascript', 'typescript', 'python', 'react', 'next', 'node', 'api', 'framework', 'frontend', 'backend', 'software'],
  hardware: ['hardware', 'cpu', 'gpu', 'chip', 'processor', 'server', 'memory', 'storage', 'laptop', 'pc', 'board', 'device'],
  jeux_video: ['game', 'gaming', 'video game', 'playstation', 'xbox', 'nintendo', 'steam', 'esport', 'unreal', 'unity'],
  actualités_tech: ['tech', 'startup', 'product', 'release', 'launch', 'innovation', 'cloud', 'saas', 'platform', 'digital'],
  réseaux: ['network', 'networking', 'tcp', 'udp', 'wifi', 'wi-fi', 'router', 'switch', 'internet', 'dns', '5g', 'vpn', 'sd-wan']
};

const CATEGORY_LABELS = {
  cybersécurité: 'Cybersécurité',
  intelligence_artificielle: 'Intelligence artificielle',
  développement: 'Développement',
  hardware: 'Hardware',
  jeux_video: 'Jeux vidéo',
  actualités_tech: 'Actualités tech',
  réseaux: 'Réseaux'
};

const SEED_SOURCES = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'actualités_tech', icon: 'TC' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'actualités_tech', icon: 'TV' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', category: 'développement', icon: 'HN' },
  { name: 'ZATAZ', url: 'https://www.zataz.com/feed/', category: 'cybersécurité', icon: 'ZT' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'hardware', icon: 'AT' },
  { name: 'Numerama', url: 'https://www.numerama.com/feed/', category: 'actualités_tech', icon: 'NU' },
  { name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all', category: 'hardware', icon: 'TH' }
];

let SQL;
let database;
let db;
let persistDb = () => {};
let refreshInProgress = false;
let backgroundRefreshTimer = null;

const REFRESH_INTERVAL_MINUTES = Number(process.env.REFRESH_INTERVAL_MINUTES || 15);

function normalizeText(value = '') {
  return String(value).toLowerCase();
}

function pickCategory(text, fallbackCategory) {
  const normalized = normalizeText(text);
  let bestCategory = fallbackCategory;
  let bestScore = 0;

  Object.entries(CATEGORY_KEYWORDS).forEach(([category, keywords]) => {
    let score = 0;
    keywords.forEach((keyword) => {
      if (normalized.includes(keyword)) {
        score += keyword.length > 5 ? 2 : 1;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  });

  return bestCategory;
}

function scoreArticle(text, category, sourceCategory) {
  const normalized = normalizeText(text);
  let score = category === sourceCategory ? 22 : 8;

  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, keywords]) => {
    keywords.forEach((keyword) => {
      if (normalized.includes(keyword)) {
        score += cat === category ? 6 : 2;
      }
    });
  });

  if (normalized.includes('ai') || normalized.includes('security') || normalized.includes('cloud')) {
    score += 5;
  }

  return Math.max(10, Math.min(100, score));
}

function extractTags(text) {
  const normalized = normalizeText(text);
  const tags = [];

  Object.entries(CATEGORY_KEYWORDS).forEach(([category, keywords]) => {
    const label = CATEGORY_LABELS[category] || category;
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      tags.push(label);
    }
  });

  return [...new Set(tags)].slice(0, 4);
}

function toISODate(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function createArticleBody(item) {
  const pieces = [item.title, item.contentSnippet, item.content, item.summary, item.creator].filter(Boolean);
  return pieces.join(' ');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatDateLabel(value) {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function createDbWrapper(sqlDb) {
  const normalizeParams = (params) => {
    if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
      return Object.fromEntries(
        Object.entries(params[0]).map(([key, value]) => [key.startsWith('@') || key.startsWith(':') || key.startsWith('$') ? key : `@${key}`, value])
      );
    }

    return params;
  };

  const runQuery = (sql, params = [], singleRow = false) => {
    const statement = sqlDb.prepare(sql);
    statement.bind(normalizeParams(params));
    const rows = [];

    while (statement.step()) {
      rows.push(statement.getAsObject());
    }

    statement.free();
    return singleRow ? rows[0] || undefined : rows;
  };

  const runStatement = (sql, params = []) => {
    const statement = sqlDb.prepare(sql);
    statement.bind(normalizeParams(params));
    statement.step();
    statement.free();
  };

  return {
    exec(sql) {
      sqlDb.exec(sql);
      persistDb();
    },
    prepare(sql) {
      return {
        get(...params) {
          return runQuery(sql, params, true);
        },
        all(...params) {
          return runQuery(sql, params, false);
        },
        run(...params) {
          runStatement(sql, params);
          persistDb();
          return { changes: sqlDb.getRowsModified() };
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        return fn(...args);
      };
    }
  };
}

async function bootstrap() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(rootDir, 'node_modules', 'sql.js', 'dist', file)
  });

  const existingDatabase = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  database = existingDatabase ? new SQL.Database(existingDatabase) : new SQL.Database();
  persistDb = () => {
    const exported = database.export();
    fs.writeFileSync(dbPath, Buffer.from(exported));
  };
  db = createDbWrapper(database);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      icon TEXT DEFAULT '',
      description TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      lastFetchedAt TEXT,
      lastError TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceId INTEGER NOT NULL,
      sourceName TEXT NOT NULL,
      sourceUrl TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL UNIQUE,
      summary TEXT DEFAULT '',
      content TEXT DEFAULT '',
      category TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      author TEXT DEFAULT '',
      image TEXT DEFAULT '',
      publishedAt TEXT NOT NULL,
      fetchedAt TEXT NOT NULL DEFAULT (datetime('now')),
      read INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (sourceId) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      articleId INTEGER NOT NULL,
      action TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (articleId) REFERENCES articles(id) ON DELETE CASCADE
    );
  `);

  const sourcesCount = db.prepare('SELECT COUNT(*) AS count FROM sources').get().count;
  if (sourcesCount === 0) {
    const insertSource = db.prepare('INSERT INTO sources (name, url, category, icon, description) VALUES (?, ?, ?, ?, ?)');
    const seedSources = db.transaction((sources) => {
      sources.forEach((source) => {
        insertSource.run(
          source.name,
          source.url,
          source.category,
          source.icon,
          `Flux préconfiguré pour la veille ${CATEGORY_LABELS[source.category] || source.category}`
        );
      });
    });
    seedSources(SEED_SOURCES);
  }

  const upsertArticle = db.prepare(`
    INSERT INTO articles (
      sourceId, sourceName, sourceUrl, title, link, summary, content, category, tags, score, author, image, publishedAt, fetchedAt
    ) VALUES (
      @sourceId, @sourceName, @sourceUrl, @title, @link, @summary, @content, @category, @tags, @score, @author, @image, @publishedAt, @fetchedAt
    )
    ON CONFLICT(link) DO UPDATE SET
      sourceId = excluded.sourceId,
      sourceName = excluded.sourceName,
      sourceUrl = excluded.sourceUrl,
      title = excluded.title,
      summary = excluded.summary,
      content = excluded.content,
      category = excluded.category,
      tags = excluded.tags,
      score = excluded.score,
      author = excluded.author,
      image = excluded.image,
      publishedAt = excluded.publishedAt,
      fetchedAt = excluded.fetchedAt
  `);

  const refreshSource = async (source) => {
    try {
      const response = await fetch(source.url, {
        headers: {
          'user-agent': 'VeilleInformationnelle/1.0 (+local dashboard)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      const feed = await parser.parseString(xml);
      const now = new Date().toISOString();
      let inserted = 0;

      const insertHistory = db.prepare('INSERT INTO history (articleId, action) VALUES (?, ?)');
      const articles = Array.isArray(feed.items) ? feed.items : [];
      const transaction = db.transaction((items) => {
        items.forEach((item) => {
          const title = String(item.title || 'Sans titre').trim();
          const link = String(item.link || item.guid || '').trim();

          if (!link) {
            return;
          }

          const body = createArticleBody(item);
          const category = pickCategory(`${title} ${body}`, source.category);
          const tags = extractTags(`${title} ${body}`);
          const score = scoreArticle(`${title} ${body}`, category, source.category);
          const publishedAt = toISODate(item.isoDate || item.pubDate || item.published || now);
          const payload = {
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: source.url,
            title,
            link,
            summary: item.contentSnippet || item.summary || '',
            content: item.content || item['content:encoded'] || '',
            category,
            tags: JSON.stringify(tags),
            score,
            author: item.creator || item.author || '',
            image: item.enclosure?.url || item['media:content']?.url || '',
            publishedAt,
            fetchedAt: now
          };

          const existing = db.prepare('SELECT id FROM articles WHERE link = ?').get(link);
          upsertArticle.run(payload);

          if (!existing) {
            const articleId = db.prepare('SELECT id FROM articles WHERE link = ?').get(link)?.id;
            if (articleId) {
              insertHistory.run(articleId, 'created');
            }
            inserted += 1;
          }
        });
      });

      transaction(articles);
      db.prepare('UPDATE sources SET lastFetchedAt = ?, lastError = NULL WHERE id = ?').run(now, source.id);
      return { ok: true, inserted, feedTitle: feed.title || source.name };
    } catch (error) {
      db.prepare('UPDATE sources SET lastError = ? WHERE id = ?').run(String(error.message || error), source.id);
      return { ok: false, error: String(error.message || error) };
    }
  };

  const refreshAllSources = async () => {
    if (refreshInProgress) {
      return [];
    }

    refreshInProgress = true;

    try {
    const sources = db.prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY createdAt DESC').all();
    const results = [];

    for (const source of sources) {
      const result = await refreshSource(source);
      results.push({ sourceId: source.id, name: source.name, ...result });
    }

    return results;
    } finally {
      refreshInProgress = false;
    }
  };

  const startBackgroundRefresh = () => {
    if (!Number.isFinite(REFRESH_INTERVAL_MINUTES) || REFRESH_INTERVAL_MINUTES <= 0) {
      return;
    }

    if (backgroundRefreshTimer) {
      clearInterval(backgroundRefreshTimer);
    }

    backgroundRefreshTimer = setInterval(() => {
      refreshAllSources().catch((error) => {
        console.error('Actualisation automatique impossible', error);
      });
    }, REFRESH_INTERVAL_MINUTES * 60 * 1000);

    if (typeof backgroundRefreshTimer.unref === 'function') {
      backgroundRefreshTimer.unref();
    }
  };

  await refreshAllSources();

  const fetchArticles = (filters = {}) => {
    const conditions = [];
    const params = [];

    if (filters.category && filters.category !== 'all') {
      conditions.push('a.category = ?');
      params.push(filters.category);
    }

    if (filters.sourceId && filters.sourceId !== 'all') {
      conditions.push('a.sourceId = ?');
      params.push(Number(filters.sourceId));
    }

    if (filters.search) {
      conditions.push('(a.title LIKE ? OR a.summary LIKE ? OR a.content LIKE ? OR a.tags LIKE ? OR s.name LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term, term, term);
    }

    if (filters.favorites === '1') {
      conditions.push('a.favorite = 1');
    }

    if (filters.read === '0') {
      conditions.push('a.read = 0');
    }

    if (filters.fromDate) {
      conditions.push('a.publishedAt >= ?');
      params.push(filters.fromDate);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Number(filters.limit || 200);

    return db.prepare(`
      SELECT a.*, s.enabled AS sourceEnabled, s.lastFetchedAt, s.lastError, s.name AS sourceDisplayName, s.category AS sourceCategory
      FROM articles a
      INNER JOIN sources s ON s.id = a.sourceId
      ${whereClause}
      ORDER BY datetime(a.publishedAt) DESC, a.id DESC
      LIMIT ?
    `).all(...params, limit).map((article) => ({
      ...article,
      tags: JSON.parse(article.tags || '[]'),
      categoryLabel: CATEGORY_LABELS[article.category] || article.category,
      publishedLabel: formatDateLabel(article.publishedAt)
    }));
  };

  const computeStats = () => {
    const totalArticles = db.prepare('SELECT COUNT(*) AS count FROM articles').get().count;
    const unreadArticles = db.prepare('SELECT COUNT(*) AS count FROM articles WHERE read = 0').get().count;
    const favoriteArticles = db.prepare('SELECT COUNT(*) AS count FROM articles WHERE favorite = 1').get().count;
    const activeSources = db.prepare('SELECT COUNT(*) AS count FROM sources WHERE enabled = 1').get().count;
    const importantArticles = db.prepare('SELECT COUNT(*) AS count FROM articles WHERE score >= 70').get().count;
    const sourceErrors = db.prepare('SELECT COUNT(*) AS count FROM sources WHERE lastError IS NOT NULL AND lastError != ""').get().count;

    return {
      totalArticles,
      unreadArticles,
      favoriteArticles,
      activeSources,
      importantArticles,
      sourceErrors
    };
  };

  const computeTrends = () => {
    const articles = db.prepare('SELECT category, tags, publishedAt, score FROM articles ORDER BY datetime(publishedAt) DESC LIMIT 400').all();
    const categoryCounts = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((key) => [key, 0]));
    const keywordCounts = new Map();
    const dailyCounts = new Map();

    articles.forEach((article) => {
      categoryCounts[article.category] = (categoryCounts[article.category] || 0) + 1;
      const tags = JSON.parse(article.tags || '[]');

      tags.forEach((tag) => {
        keywordCounts.set(tag, (keywordCounts.get(tag) || 0) + 1);
      });

      const day = String(article.publishedAt || '').slice(0, 10);
      if (day) {
        dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
      }
    });

    return {
      categoryCounts,
      topKeywords: [...keywordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([label, value]) => ({ label, value })),
      dailySeries: [...dailyCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-14)
        .map(([label, value]) => ({ label, value }))
    };
  };

  const enrichArticles = (articles) => articles.map((article) => ({
    ...article,
    categoryLabel: CATEGORY_LABELS[article.category] || article.category,
    publishedLabel: formatDateLabel(article.publishedAt),
    tags: Array.isArray(article.tags) ? article.tags : JSON.parse(article.tags || '[]')
  }));

  app.get('/api/bootstrap', (req, res) => {
    const sources = db.prepare('SELECT * FROM sources ORDER BY enabled DESC, createdAt DESC').all();
    const recentArticles = enrichArticles(fetchArticles({ limit: 30 }));
    const stats = computeStats();
    const trends = computeTrends();
    const important = recentArticles.filter((article) => article.score >= 70).slice(0, 6);

    res.json({
      stats,
      sources,
      recentArticles,
      important,
      trends,
      categories: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))
    });
  });

  app.get('/api/articles', (req, res) => {
    const articles = enrichArticles(fetchArticles(req.query));
    res.json({ articles });
  });

  app.get('/api/sources', (req, res) => {
    res.json({ sources: db.prepare('SELECT * FROM sources ORDER BY enabled DESC, createdAt DESC').all() });
  });

  app.post('/api/sources', async (req, res) => {
    const { name, url, category, icon = '', description = '' } = req.body || {};

    if (!name || !url || !category) {
      return res.status(400).json({ error: 'name, url and category are required' });
    }

    try {
      const normalizedUrl = String(url).trim();
      new URL(normalizedUrl);
      const insert = db.prepare('INSERT INTO sources (name, url, category, icon, description) VALUES (?, ?, ?, ?, ?)');
      insert.run(String(name).trim(), normalizedUrl, String(category).trim(), String(icon).trim(), String(description).trim());
      const source = db.prepare('SELECT * FROM sources WHERE url = ?').get(normalizedUrl);
      res.status(201).json({ source });
    } catch (error) {
      const message = String(error.message || error);
      const status = message.includes('UNIQUE') ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.patch('/api/sources/:id', (req, res) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);

    if (!source) {
      return res.status(404).json({ error: 'source not found' });
    }

    const enabled = Number((req.body?.enabled ?? source.enabled) ? 1 : 0);
    db.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(enabled, id);
    res.json({ source: db.prepare('SELECT * FROM sources WHERE id = ?').get(id) });
  });

  app.delete('/api/sources/:id', (req, res) => {
    const id = Number(req.params.id);
    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);

    if (!source) {
      return res.status(404).json({ error: 'source not found' });
    }

    db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  app.patch('/api/articles/:id', (req, res) => {
    const id = Number(req.params.id);
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);

    if (!article) {
      return res.status(404).json({ error: 'article not found' });
    }

    const patch = [];
    const values = [];

    if (typeof req.body?.read === 'boolean') {
      patch.push('read = ?');
      values.push(req.body.read ? 1 : 0);
    }

    if (typeof req.body?.favorite === 'boolean') {
      patch.push('favorite = ?');
      values.push(req.body.favorite ? 1 : 0);
    }

    if (patch.length) {
      values.push(id);
      db.prepare(`UPDATE articles SET ${patch.join(', ')} WHERE id = ?`).run(...values);
    }

    if (req.body?.read === true) {
      db.prepare('INSERT INTO history (articleId, action) VALUES (?, ?)').run(id, 'read');
    }

    if (req.body?.favorite === true) {
      db.prepare('INSERT INTO history (articleId, action) VALUES (?, ?)').run(id, 'favorite');
    }

    res.json({ article: db.prepare('SELECT * FROM articles WHERE id = ?').get(id) });
  });

  app.post('/api/refresh', async (req, res) => {
    const results = await refreshAllSources();
    res.json({ ok: true, results });
  });

  app.get('/api/analytics', (req, res) => {
    const stats = computeStats();
    const trends = computeTrends();
    const recent = enrichArticles(fetchArticles({ limit: 50 }));

    res.json({ stats, trends, recent });
  });

  app.get('/api/history', (req, res) => {
    const history = db.prepare(`
      SELECT h.*, a.title, a.link, a.category, a.score, a.favorite, a.read
      FROM history h
      INNER JOIN articles a ON a.id = h.articleId
      ORDER BY datetime(h.createdAt) DESC
      LIMIT 100
    `).all();

    res.json({ history });
  });

  app.get('/api/opml', (req, res) => {
    const sources = db.prepare('SELECT * FROM sources ORDER BY createdAt DESC').all();
    const outlines = sources.map((source) => `    <outline text="${escapeXml(source.name)}" title="${escapeXml(source.name)}" type="rss" xmlUrl="${escapeXml(source.url)}" htmlUrl="${escapeXml(source.url)}" category="${escapeXml(source.category)}" />`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Veille informationnelle</title>\n  </head>\n  <body>\n${outlines}\n  </body>\n</opml>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="veille-sources.opml"');
    res.send(xml);
  });

  app.post('/api/opml', async (req, res) => {
    const { opml } = req.body || {};

    if (!opml) {
      return res.status(400).json({ error: 'opml is required' });
    }

    const outlineRegex = /<outline[^>]*xmlUrl=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*category=["']([^"']+)["'][^>]*\/?>/gi;
    const fallbackRegex = /<outline[^>]*xmlUrl=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*\/?>/gi;
    const collected = [];
    let match;

    while ((match = outlineRegex.exec(opml))) {
      collected.push({ url: match[1], name: match[2], category: match[3] });
    }

    if (collected.length === 0) {
      while ((match = fallbackRegex.exec(opml))) {
        collected.push({ url: match[1], name: match[2], category: 'actualités_tech' });
      }
    }

    const insert = db.prepare('INSERT OR IGNORE INTO sources (name, url, category, icon, description) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction((items) => {
      items.forEach((source) => insert.run(source.name, source.url, source.category, source.name.slice(0, 2).toUpperCase(), 'Import OPML'));
    });
    tx(collected);

    res.json({ imported: collected.length });
  });

  app.use(express.static(rootDir));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'not found' });
    }

    res.sendFile(path.join(rootDir, 'index.html'));
  });

}

const bootstrapPromise = bootstrap()
  .then(() => {
    if (!isVercelDeployment) {
      app.listen(port, () => {
        console.log(`Veille informationnelle disponible sur http://localhost:${port}`);
        startBackgroundRefresh();
      });
    }

    return app;
  })
  .catch((error) => {
    console.error('Impossible de démarrer le serveur', error);
    if (!isVercelDeployment) {
      process.exit(1);
    }

    throw error;
  });

module.exports = { app, bootstrapPromise };