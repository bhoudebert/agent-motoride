// The page a follower opens (ADR 0028, spec live-sharing). The key is in the link's fragment, never sent to a server:
// the updates are fetched as ciphertext and decrypted here, in the browser. Plain JavaScript, no build step.

const b64urlToBytes = (s) => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** The key of the link, as a WebCrypto key; null when the fragment is not a 256-bit key. */
export async function importKey(fragment) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(fragment)) return null;
  return crypto.subtle.importKey("raw", b64urlToBytes(fragment), "AES-GCM", false, ["decrypt"]);
}

/** One update, decrypted and checked; null when it is not for this channel or this key (a wrong link, a tampered update). */
export async function decryptUpdate(key, channel, update) {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlToBytes(update.iv), additionalData: new TextEncoder().encode(channel) },
      key,
      b64urlToBytes(update.ct),
    );
    const point = JSON.parse(new TextDecoder().decode(plain));
    if (point.v !== 1 || typeof point.lat !== "number" || typeof point.lon !== "number") return null;
    if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return null;
    return { ...point, seq: update.seq, at: update.at };
  } catch {
    return null;
  }
}

/** What the page says about the ride, from the points it has and the state the relay gave. */
export function summarise(points, state, now) {
  const last = points[points.length - 1];
  if (!last)
    return {
      headline: state === "ended" ? "This ride has ended." : "Waiting for the first position…",
      ageS: null,
      stale: false,
    };
  const ageS = Math.max(0, Math.round((now - last.at) / 1000));
  if (state === "ended" || last.state === "ended") return { headline: "Ride ended", ageS, stale: false };
  // The phone thinks the rider crashed and has not been told otherwise: it stays said however long ago the last update came.
  if (last.state === "alert") return { headline: "Possible crash", ageS, stale: false, alert: true };
  const stale = ageS > 120;
  const headline = stale ? "No news for a while" : last.state === "stopped" ? "Stopped" : "Riding";
  return { headline, ageS, stale };
}

/** "12 s ago", "3 min ago", "2 h 05 ago". */
export function ago(seconds) {
  if (seconds === null) return "";
  if (seconds < 60) return `${seconds} s ago`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} ago`;
}

const POLL_LIVE_MS = 8000;
const POLL_ENDED_MS = 30000;

async function start() {
  const channel = location.pathname.split("/").filter(Boolean).pop() ?? "";
  const key = await importKey(location.hash.slice(1));
  const say = (id, text) => {
    document.getElementById(id).textContent = text;
  };
  if (!key || !/^[A-Za-z0-9_-]{22}$/.test(channel)) {
    say("headline", "This link is not complete");
    say("detail", "Ask the rider to send it again, in full: the part after # is the key.");
    return;
  }
  /** The points received, in order. */
  const points = [];
  let after = 0;
  let state = "live";
  let map = null;
  let marker = null;

  const draw = () => {
    const last = points[points.length - 1];
    if (!last || typeof maplibregl === "undefined") return;
    const here = [last.lon, last.lat];
    if (!map) {
      map = new maplibregl.Map({
        container: "map",
        style: "https://tiles.openfreemap.org/styles/positron",
        center: here,
        zoom: 14,
        attributionControl: { compact: true },
      });
      map.on("load", () => {
        map.addSource("trail", { type: "geojson", data: trailData() });
        map.addLayer({
          id: "trail",
          type: "line",
          source: "trail",
          paint: { "line-color": "#24382d", "line-width": 5 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
      });
      const dot = document.createElement("div");
      dot.className = "dot";
      marker = new maplibregl.Marker({ element: dot }).setLngLat(here).addTo(map);
    } else {
      marker.setLngLat(here);
      map.easeTo({ center: here, duration: 800 });
      const source = map.getSource("trail");
      if (source) source.setData(trailData());
    }
  };
  const trailData = () => ({
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
  });

  const refresh = () => {
    const s = summarise(points, state, Date.now());
    const last = points[points.length - 1];
    say("headline", s.headline);
    document.title = s.alert ? "Possible crash - following a ride" : "Following a ride";
    document.body.dataset.state = s.alert
      ? "alert"
      : s.stale
        ? "stale"
        : state === "ended" || last?.state === "ended"
          ? "ended"
          : (last?.state ?? "waiting");
    say(
      "detail",
      [last?.name, last && last.spd != null ? `${Math.round(last.spd)} km/h` : "", ago(s.ageS)]
        .filter(Boolean)
        .join(" · "),
    );
  };

  const poll = async () => {
    try {
      const res = await fetch(`/share/${channel}?after=${after}`, { cache: "no-store", referrerPolicy: "no-referrer" });
      if (res.status === 404) {
        state = points.length ? state : "live";
        if (!points.length) {
          say("headline", "No ride here yet");
          say("detail", "The link is right if the rider has just started; this page keeps looking.");
        }
      } else if (res.ok) {
        const body = await res.json();
        state = body.state;
        for (const update of body.items) {
          const point = await decryptUpdate(key, channel, update);
          if (point) points.push(point);
        }
        after = body.next;
        draw();
        refresh();
      }
    } catch {
      say("detail", "Cannot reach the server; trying again.");
    }
    setTimeout(poll, state === "ended" ? POLL_ENDED_MS : POLL_LIVE_MS);
  };
  setInterval(refresh, 1000);
  poll();
}

if (typeof document !== "undefined" && document.getElementById("map")) start();
