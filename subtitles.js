const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

// Convert SRT text format to WebVTT format
function srtToVtt(srtContent) {
  let vtt = 'WEBVTT\n\n' + srtContent
    .replace(/\r\n|\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return vtt;
}

// Search online subtitles for a movie title
async function searchOnlineSubtitles(cleanTitle, year) {
  const subtitles = [];

  try {
    // 1. Get IMDb TT-ID
    const query = cleanTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const imdbRes = await axios.get(`https://v3.sg.media-imdb.com/suggestion/x/${query}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 4000
    });

    const items = imdbRes.data?.d || [];
    const best = items.find(d => d.id?.startsWith('tt')) || items[0];
    const imdbId = best?.id;

    if (!imdbId) return subtitles;

    // 2. Fetch subtitle list from yts-subs
    const ytsUrl = `https://yts-subs.com/movie-imdb/${imdbId}`;
    const pageRes = await axios.get(ytsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 5000
    });

    const html = pageRes.data;
    const rowRegex = /<tr[^>]*>[\s\S]*?<span class="sub-lang">([^<]+)<\/span>[\s\S]*?<a href="(\/subtitles\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
      const lang = match[1].trim();
      const subUrlPath = match[2].trim();
      const rawName = match[3].replace(/<[^>]+>/g, '').replace(/subtitle\s*/gi, '').trim();
      const uniqueSubId = crypto.createHash('md5').update(subUrlPath + '_' + subtitles.length).digest('hex');

      subtitles.push({
        id: uniqueSubId,
        lang: lang,
        name: rawName || `${lang} Subtitle`,
        sourceUrl: `https://yts-subs.com${subUrlPath}`
      });
    }
  } catch (err) {
    console.warn(`[Subtitles] Search error for '${cleanTitle}':`, err.message);
  }

  return subtitles;
}

// Download subtitle zip from provider, extract SRT and convert to VTT
async function downloadAndConvertSubtitle(sourceUrl, targetVttPath) {
  try {
    // 1. Get the download page to find the base64 data-link or zip link
    const pageRes = await axios.get(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 5000
    });

    const dataLinkMatch = pageRes.data.match(/data-link="([^"]+)"/i);
    let zipUrl = null;

    if (dataLinkMatch) {
      zipUrl = Buffer.from(dataLinkMatch[1], 'base64').toString('utf8');
    } else {
      const zipMatch = pageRes.data.match(/href="([^"]+\.zip)"/i) || pageRes.data.match(/href="(\/subtitle\/[^"]+\.zip)"/i);
      if (zipMatch) {
        zipUrl = zipMatch[1].startsWith('http') ? zipMatch[1] : `https://yts-subs.com${zipMatch[1]}`;
      }
    }

    if (!zipUrl) {
      throw new Error('Download zip link not found on page');
    }

    // 2. Download zip buffer
    const zipRes = await axios.get(zipUrl, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 6000
    });

    const zip = new AdmZip(Buffer.from(zipRes.data));
    const zipEntries = zip.getEntries();

    let srtText = null;
    for (const entry of zipEntries) {
      if (entry.entryName.toLowerCase().endsWith('.srt') || entry.entryName.toLowerCase().endsWith('.vtt')) {
        srtText = entry.getData().toString('utf8');
        break;
      }
    }

    if (!srtText) {
      throw new Error('No .srt file found inside zip');
    }

    // 3. Convert to WebVTT and save
    const vttText = srtToVtt(srtText);
    const dir = path.dirname(targetVttPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(targetVttPath, vttText, 'utf8');
    return true;
  } catch (err) {
    console.error('[Subtitles] Download/Convert error:', err.message);
    throw err;
  }
}

module.exports = {
  srtToVtt,
  searchOnlineSubtitles,
  downloadAndConvertSubtitle
};
