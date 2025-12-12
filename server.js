
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");
const NodeCache = require("node-cache");

const app = express();
app.use(cors());
app.use(express.static("public"));

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const cache = new NodeCache({ stdTTL: 3600 });
const TMDB_KEY = process.env.TMDB_API_KEY;

const recommendedPerUser = {};

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function safeFetch(url) {
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const data = await res.json();
    cache.set(url, data);
    return data;
  } catch (err) {
    console.log("Fetch error:", url, err.message);
    return null;
  }
}

async function getWatched(username) {
  try {
    const url = `https://letterboxd.com/${username}/rss/`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Feed not found");

    const xml = await res.text();
    const data = parser.parse(xml);
    const items = data?.rss?.channel?.item || [];

    return items.map(i => (typeof i.title === 'string' ? i.title : i.title['#text']).replace(/\s*\(\d{4}\)$/, '').trim());
  } catch (err) {
    console.log("Letterboxd fetch error:", err.message);
    return null;
  }
}

async function getUserPrefs(titles) {
  const directors = {};
  const tasks = titles.slice(0, 15).map(async t => {
    try {
      const search = await safeFetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(t)}`);
      const movie = search?.results?.[0];
      if (!movie) return;

      const credits = await safeFetch(`https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${TMDB_KEY}`);
      const director = credits?.crew?.find(c => c.job === "Director")?.name;
      if (director) directors[director] = (directors[director] || 0) + 1;

    } catch (e) {}
  });

  await Promise.all(tasks);
  const topDirectors = Object.keys(directors).sort((a,b)=>directors[b]-directors[a]).slice(0,5);
  return { topDirectors };
}

async function discoverCandidates(genre, startYear, endYear, preference, excludeIds=[], pages=5) {
  let results = [];
  const tasks = [];

  for (let page = 1; page <= pages; page++) {
    let url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_genres=${genre}&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${endYear}-12-31&page=${page}`;

    if (preference === "obscure") {
      url += "&vote_count.lte=500&sort_by=vote_average.desc";
    } else {
      url += "&vote_count.gte=500&sort_by=popularity.desc";
    }

    tasks.push(safeFetch(url));
  }

  const pagesData = await Promise.all(tasks);
  pagesData.forEach(data => {
    if (data?.results) results.push(...data.results.filter(m => !excludeIds.includes(m.id)));
  });

  return results;
}

function score(movie, topDirectors, preference) {
  const directorScore = topDirectors.includes(movie.director) ? 5 : 0;
  const ratingScore = (movie.vote_average || 0) * 1.5;

  let popularityPenalty = 0;
  if (preference === "obscure") {
    popularityPenalty = movie.popularity || 0;
  }

  return directorScore + ratingScore - popularityPenalty;
}

app.get("/api/recommend", async (req, res) => {
  const { username, genre, startYear, endYear, preference } = req.query;
  if (!username || !genre || !startYear || !endYear) 
    return res.json({ success: false, error: "username, genre, startYear, and endYear are required" });

  try {
    const watchedTitles = await getWatched(username);
    if (!watchedTitles || watchedTitles.length === 0) {
      return res.json({ success: false, error: "Account does not exist, try again." });
    }

    if(!recommendedPerUser[username]) recommendedPerUser[username] = [];
    const excludeIds = [...recommendedPerUser[username]];

    const searchTasks = watchedTitles.slice(0, 15).map(async t => {
      const search = await safeFetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(t)}`);
      if (search?.results?.[0]) excludeIds.push(search.results[0].id);
    });
    await Promise.all(searchTasks);

    const { topDirectors } = await getUserPrefs(watchedTitles);

    let candidates = await discoverCandidates(genre, startYear, endYear, preference || "obscure", excludeIds, 5);

    const detailTasks = candidates.map(async m => {
      const [details, credits] = await Promise.all([
        safeFetch(`https://api.themoviedb.org/3/movie/${m.id}?api_key=${TMDB_KEY}`),
        safeFetch(`https://api.themoviedb.org/3/movie/${m.id}/credits?api_key=${TMDB_KEY}`)
      ]);
      m.director = credits?.crew?.find(c => c.job==="Director")?.name || "Unknown";
      m.vote_average = details?.vote_average || 0;
      m.popularity = details?.popularity || 0;
      m.poster_path = details?.poster_path || "placeholder.jpg";
      m.overview = details?.overview || "No description available.";
      m._score = score(m, topDirectors, preference || "obscure");
    });
    await Promise.all(detailTasks);

    candidates.sort((a,b)=>b._score - a._score);
    const topCandidates = shuffle(candidates.slice(0, 50));
    const top3 = topCandidates.slice(0, 3).map(m => ({
      title: m.title || "Unknown Title",
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : "placeholder.jpg",
      director: m.director,
      year: m.release_date ? m.release_date.split("-")[0] : "Unknown",
      overview: m.overview,
      id: m.id
    }));

    recommendedPerUser[username].push(...top3.map(m=>m.id));

    res.json({ success: true, results: top3 });

  } catch(err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

app.get("/api/reset", (req, res) => {
  const { username } = req.query;
  if(username) recommendedPerUser[username] = [];
  res.json({ success: true });
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
