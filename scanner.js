const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseTitleAndYear, inspectMediaTracks, getCachedMetadata } = require('./metadata');

const SUPPORTED_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.flv', '.3gp', '.ogv', '.divx'];

function generateMovieId(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 12);
}

function parseSeriesInfo(filePath, filename, rawTitle) {
  const full = `${filePath} ${filename} ${rawTitle}`;

  // Match S01E02, s1e2, Season 1 Episode 2, 1x02
  const sMatch = full.match(/s(\d{1,2})[\.\s_-]*e(\d{1,2})/i) ||
                 full.match(/season[\.\s_-]*(\d{1,2})[\.\s_-]*(?:ep|episode)[\.\s_-]*(\d{1,2})/i) ||
                 full.match(/(\d{1,2})x(\d{1,2})/i);

  if (sMatch) {
    const season = parseInt(sMatch[1], 10);
    const episode = parseInt(sMatch[2], 10);

    // Clean series name from title / filename
    let sTitle = filename
      .replace(/www\.[a-z0-9\.-]+/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/s\d{1,2}[\.\s_-]*e\d{1,2}.*/i, '')
      .replace(/season[\.\s_-]*\d+.*/i, '')
      .replace(/(\d{1,2})x(\d{1,2}).*/i, '')
      .replace(/[-_.]+/g, ' ')
      .trim();

    if (!sTitle || sTitle.length < 2) {
      sTitle = rawTitle.replace(/s\d{1,2}[\.\s_-]*e\d{1,2}.*/i, '').trim();
    }

    // Capitalize clean title
    sTitle = sTitle.replace(/\s+/g, ' ').trim();

    return {
      isSeries: true,
      seriesTitle: sTitle || rawTitle,
      seasonNumber: season || 1,
      episodeNumber: episode || 1
    };
  }

  // Single episode match (e.g. EP 01, Episode 1) inside a Season or Series directory
  const epMatch = full.match(/(?:ep|episode)[\.\s_-]*(\d{1,2})/i);
  if (epMatch && (full.toLowerCase().includes('season') || full.toLowerCase().includes('series') || full.toLowerCase().includes('s0') || full.toLowerCase().includes('s1'))) {
    const epNum = parseInt(epMatch[1], 10);
    const seasonMatch = full.match(/season[\.\s_-]*(\d{1,2})/i) || full.match(/s(\d{1,2})/i);
    const season = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;

    let sTitle = filename
      .replace(/www\.[a-z0-9\.-]+/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/(?:ep|episode)[\.\s_-]*\d+.*/i, '')
      .replace(/[-_.]+/g, ' ')
      .trim();

    return {
      isSeries: true,
      seriesTitle: sTitle || rawTitle,
      seasonNumber: season || 1,
      episodeNumber: epNum || 1
    };
  }

  return { isSeries: false };
}

function scanSingleDir(dirPath, libraryName) {
  let itemsList = [];

  if (!fs.existsSync(dirPath)) {
    console.warn(`[Scanner] Warning: Media directory '${dirPath}' does not exist.`);
    return itemsList;
  }

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        itemsList = itemsList.concat(scanSingleDir(fullPath, libraryName));
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          const id = generateMovieId(fullPath);
          const { cleanTitle, year } = parseTitleAndYear(item.name, path.basename(dirPath));
          const seriesInfo = parseSeriesInfo(fullPath, item.name, cleanTitle);

          const stat = fs.statSync(fullPath);
          const cachedMeta = getCachedMetadata(cleanTitle, year);
          const posterPath = cachedMeta?.poster || null;

          itemsList.push({
            id,
            title: cleanTitle,
            year: cachedMeta?.year || year,
            filename: item.name,
            filePath: fullPath,
            library: libraryName || path.basename(dirPath),
            size: stat.size,
            addedAt: stat.mtimeMs || stat.birthtimeMs || Date.now(),
            duration: 0,
            formattedDuration: null,
            streamUrl: `/api/stream/${id}/index.m3u8`,
            localThumbUrl: `/api/movies/${id}/thumbnail`,
            poster: posterPath,
            posterUrl: posterPath,
            tracks: null,
            metadata: cachedMeta || null,
            // Series metadata
            isSeries: seriesInfo.isSeries || false,
            seriesTitle: seriesInfo.seriesTitle || null,
            seasonNumber: seriesInfo.seasonNumber || null,
            episodeNumber: seriesInfo.episodeNumber || null
          });
        }
      }
    }
  } catch (err) {
    console.error(`[Scanner] Error reading '${dirPath}':`, err.message);
  }

  return itemsList;
}

function groupSeries(mediaList) {
  const seriesMap = new Map();

  for (const item of mediaList) {
    if (!item.isSeries) continue;

    const seriesKey = item.seriesTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    const seriesId = `series_${crypto.createHash('md5').update(seriesKey).digest('hex').substring(0, 10)}`;

    if (!seriesMap.has(seriesKey)) {
      seriesMap.set(seriesKey, {
        id: seriesId,
        title: item.seriesTitle,
        year: item.year || new Date(item.addedAt).getFullYear().toString(),
        mediaType: 'series',
        library: item.library,
        addedAt: item.addedAt,
        metadata: null,
        seasons: []
      });
    }

    const seriesObj = seriesMap.get(seriesKey);
    const sNum = item.seasonNumber || 1;
    let season = seriesObj.seasons.find(s => s.seasonNumber === sNum);

    if (!season) {
      season = {
        seasonNumber: sNum,
        seasonTitle: `Season ${sNum}`,
        episodes: []
      };
      seriesObj.seasons.push(season);
    }

    season.episodes.push({
      id: item.id,
      episodeNumber: item.episodeNumber || (season.episodes.length + 1),
      title: `Episode ${item.episodeNumber || (season.episodes.length + 1)}`,
      filename: item.filename,
      filePath: item.filePath,
      duration: item.duration || 0,
      formattedDuration: item.formattedDuration || null,
      size: item.size,
      streamUrl: item.streamUrl,
      localThumbUrl: item.localThumbUrl,
      tracks: item.tracks,
      metadata: item.metadata
    });
  }

  // Sort seasons and episodes
  const seriesList = Array.from(seriesMap.values()).map(series => {
    series.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    let totalEp = 0;
    series.seasons.forEach(s => {
      s.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      totalEp += s.episodes.length;
    });
    series.totalEpisodes = totalEp;
    series.totalSeasons = series.seasons.length;
    return series;
  });

  return seriesList;
}

function scanMediaDirs(dirPaths) {
  let allItems = [];
  const paths = Array.isArray(dirPaths) ? dirPaths : [dirPaths];

  paths.forEach(p => {
    const trimmed = p.trim();
    if (trimmed) {
      const libName = path.basename(trimmed);
      const found = scanSingleDir(trimmed, libName);
      allItems = allItems.concat(found);
    }
  });

  return allItems;
}

module.exports = { scanMediaDirs, scanSingleDir, groupSeries };

