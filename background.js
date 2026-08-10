"use strict";

const DEFAULTS = {
  kmeetBase: "https://kmeet.infomaniak.com/",
  kmeetPrefix: "meet-",
  kmeetSlugLen: 12,
  durationMin: 60,
  includeBody: true,
  addSelf: true,
  headerButtons: true,
};

let settings = { ...DEFAULTS };

function kmeetConfig() {
  return {
    base: settings.kmeetBase,
    prefix: settings.kmeetPrefix,
    slugLen: settings.kmeetSlugLen,
  };
}

function kmeetUrl() {
  const cs = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rnd = crypto.getRandomValues(new Uint8Array(settings.kmeetSlugLen));
  let slug = "";
  for (const b of rnd) {
    slug += cs[b % cs.length];
  }
  return settings.kmeetBase + settings.kmeetPrefix + slug;
}

// "Prénom Nom <a@b.c>" | "a@b.c" -> { email, name } | null
function parseAddr(raw) {
  if (!raw) {
    return null;
  }
  const m = raw.match(/<([^>]+)>/);
  if (m) {
    return {
      email: m[1].trim(),
      name: raw.replace(/<[^>]+>/, "").replace(/"/g, "").trim(),
    };
  }
  const s = raw.trim();
  return s.includes("@") ? { email: s, name: "" } : null;
}

// Première partie text/plain trouvée dans l'arborescence MIME,
// sinon text/html grossièrement détaggé.
function extractText(part) {
  if (!part) {
    return "";
  }
  if (part.contentType && part.contentType.startsWith("text/plain") && part.body) {
    return part.body;
  }
  for (const sub of part.parts || []) {
    const t = extractText(sub);
    if (t) {
      return t;
    }
  }
  if (part.contentType && part.contentType.startsWith("text/html") && part.body) {
    return part.body
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return "";
}

// Toutes les identités du profil : email (minuscules) -> nom d'affichage.
async function ownIdentities() {
  const own = new Map();
  for (const account of await browser.accounts.list(true)) {
    for (const identity of account.identities || []) {
      if (identity.email) {
        own.set(identity.email.toLowerCase(), identity.name || "");
      }
    }
  }
  return own;
}

async function openMeeting(msg, withKmeet) {
  const own = await ownIdentities();
  const seen = new Set();
  const attendees = [];
  let selfEmail = null;
  for (const raw of [msg.author, ...(msg.recipients || []), ...(msg.ccList || [])]) {
    const addr = parseAddr(raw);
    if (!addr) {
      continue;
    }
    const key = addr.email.toLowerCase();
    if (own.has(key)) {
      // Identité du profil visée par ce mail : candidate pour "s'ajouter".
      selfEmail = selfEmail || key;
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    attendees.push(addr);
  }
  if (settings.addSelf) {
    if (!selfEmail) {
      selfEmail = own.keys().next().value || null;
    }
    if (selfEmail) {
      attendees.push({ email: selfEmail, name: own.get(selfEmail) || "", isSelf: true });
    }
  }

  let body = "";
  if (settings.includeBody) {
    try {
      body = extractText(await browser.messages.getFull(msg.id));
    } catch (e) {
      console.warn("ReplyWithMeeting: lecture du corps impossible", e);
    }
    if (body.length > 10000) {
      body = body.slice(0, 10000) + "\n[…]";
    }
  }

  const title = (msg.subject || "Réunion").replace(/^((re|fwd?|tr)\s*:\s*)+/i, "").trim();
  const location = withKmeet ? kmeetUrl() : "";
  const description =
    (withKmeet ? `📹 Visio kMeet : ${location}\n\n` : "") +
    (settings.includeBody
      ? `---- Message d'origine ----\n` +
        `De : ${msg.author}\n` +
        `Date : ${msg.date ? new Date(msg.date).toLocaleString() : ""}\n\n` +
        body
      : "");

  await browser.calMeeting.openNewEvent({
    title,
    description,
    attendees,
    location,
    durationMin: settings.durationMin,
  });
}

browser.calMeeting.onMeetingRequested.addListener((msg, withKmeet) => {
  openMeeting(msg, withKmeet).catch((e) =>
    console.error("ReplyWithMeeting: échec de l'ouverture de l'événement", e)
  );
});

function menuConfig() {
  return {
    labelPlain: "Répondre par une réunion",
    labelKmeet: "Répondre par une réunion kMeet",
    buttonPlain: "Réunion",
    buttonKmeet: "kMeet",
    showButtons: settings.headerButtons,
  };
}

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") {
    return;
  }
  settings = await browser.storage.local.get(DEFAULTS);
  browser.calMeeting.initContextMenu(menuConfig()).catch(() => {});
  browser.calMeeting.initKmeetButton(kmeetConfig()).catch(() => {});
});

(async () => {
  settings = await browser.storage.local.get(DEFAULTS);
  await browser.calMeeting.initContextMenu(menuConfig());
  await browser.calMeeting.initKmeetButton(kmeetConfig());
})().catch((e) => console.error("ReplyWithMeeting: init", e));
