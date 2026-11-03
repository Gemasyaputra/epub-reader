// Mengubah link YouTube / Spotify menjadi alamat pemutar resmi (embed).
// Link dari pengguna tidak pernah dipakai apa adanya di iframe: hanya ID yang lolos
// validasi yang dipakai untuk membentuk URL embed.

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SPOTIFY_TYPES = { track: 'lagu', album: 'album', playlist: 'playlist', episode: 'episode podcast', show: 'podcast', artist: 'artis' };

function spotify(type, id) {
  return {
    provider: 'spotify',
    label: `Spotify · ${SPOTIFY_TYPES[type]}`,
    embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
    height: type === 'track' || type === 'episode' ? 152 : 352,
  };
}

function youtube(video, list) {
  const params = new URLSearchParams({ rel: '0', playsinline: '1' });
  let path;
  if (video) {
    path = video;
    if (list) params.set('list', list);
    else {
      params.set('loop', '1'); // satu video: ulangi terus selama membaca
      params.set('playlist', video);
    }
  } else {
    path = 'videoseries';
    params.set('list', list);
  }
  return {
    provider: 'youtube',
    label: `YouTube · ${list ? 'playlist' : 'video'}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${path}?${params}`,
    height: 190,
  };
}

/** Return info pemutar untuk link YouTube/Spotify, atau null bila link tidak dikenali. */
export function parseMusicLink(input) {
  const text = String(input || '').trim();
  if (!text) return null;

  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(text); // spotify:track:ID
  if (uri) return SPOTIFY_TYPES[uri[1]] && SAFE_ID.test(uri[2]) ? spotify(uri[1], uri[2]) : null;

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');

  if (host === 'open.spotify.com') {
    const parts = url.pathname.split('/').filter((p) => p && !p.startsWith('intl-'));
    if (parts[0] === 'embed') parts.shift();
    const [type, id] = parts;
    return SPOTIFY_TYPES[type] && SAFE_ID.test(id || '') ? spotify(type, id) : null;
  }

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    let video = null;
    if (host === 'youtu.be') video = url.pathname.split('/')[1];
    else if (url.pathname === '/watch') video = url.searchParams.get('v');
    else {
      const m = /^\/(embed|shorts|live|v)\/([^/]+)/.exec(url.pathname);
      if (m && m[2] !== 'videoseries') video = m[2];
    }
    const list = url.searchParams.get('list');
    video = video && SAFE_ID.test(video) ? video : null;
    const safeList = list && SAFE_ID.test(list) ? list : null;
    return video || safeList ? youtube(video, safeList) : null;
  }
  return null;
}
