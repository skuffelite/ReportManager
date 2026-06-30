import fetch from "node-fetch";

const UNIVERSE_ID = process.env.UNIVERSE_ID;
const API_KEY = process.env.OPEN_CLOUD_KEY;

const BASE = `https://apis.roblox.com/datastores/v1/universes/${UNIVERSE_ID}/standard-datastores/datastore/entries/entry`;

function headers() {
  return {
    "x-api-key": API_KEY,
    "Content-Type": "application/json",
  };
}

// Get an entry. Returns parsed JSON value, or null if not found.
export async function getEntry(datastoreName, entryKey) {
  const url = `${BASE}?datastoreName=${encodeURIComponent(datastoreName)}&entryKey=${encodeURIComponent(entryKey)}`;
  const res = await fetch(url, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`getEntry ${datastoreName}/${entryKey} -> ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

// Set an entry (overwrites).
export async function setEntry(datastoreName, entryKey, value) {
  const url = `${BASE}?datastoreName=${encodeURIComponent(datastoreName)}&entryKey=${encodeURIComponent(entryKey)}`;
  const body = JSON.stringify(value);
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body,
  });
  if (!res.ok) {
    throw new Error(`setEntry ${datastoreName}/${entryKey} -> ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

// List keys in a datastore (paged). Returns array of key strings.
export async function listKeys(datastoreName, prefix) {
  const listBase = `https://apis.roblox.com/datastores/v1/universes/${UNIVERSE_ID}/standard-datastores/datastore/entries`;
  let url = `${listBase}?datastoreName=${encodeURIComponent(datastoreName)}&limit=100`;
  if (prefix) url += `&prefix=${encodeURIComponent(prefix)}`;
  const keys = [];
  let cursor = null;
  do {
    const pageUrl = cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url;
    const res = await fetch(pageUrl, { headers: headers() });
    if (!res.ok) {
      throw new Error(`listKeys ${datastoreName} -> ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const k of data.keys || []) keys.push(k.key);
    cursor = data.nextPageCursor || null;
  } while (cursor);
  return keys;
}
