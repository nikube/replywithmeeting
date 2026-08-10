"use strict";

const DEFAULTS = {
  kmeetBase: "https://kmeet.infomaniak.com/",
  kmeetPrefix: "meet-",
  kmeetSlugLen: 12,
  durationMin: 60,
  includeBody: true,
};

const $ = (id) => document.getElementById(id);

async function restore() {
  const s = await browser.storage.local.get(DEFAULTS);
  $("kmeetBase").value = s.kmeetBase;
  $("kmeetPrefix").value = s.kmeetPrefix;
  $("kmeetSlugLen").value = s.kmeetSlugLen;
  $("durationMin").value = s.durationMin;
  $("includeBody").checked = s.includeBody;
}

async function save() {
  let base = $("kmeetBase").value.trim() || DEFAULTS.kmeetBase;
  if (!base.endsWith("/")) {
    base += "/";
  }
  await browser.storage.local.set({
    kmeetBase: base,
    kmeetPrefix: $("kmeetPrefix").value.trim(),
    kmeetSlugLen: Math.min(32, Math.max(4, parseInt($("kmeetSlugLen").value, 10) || 12)),
    durationMin: Math.min(1440, Math.max(5, parseInt($("durationMin").value, 10) || 60)),
    includeBody: $("includeBody").checked,
  });
  $("status").textContent = "Enregistré ✓";
  setTimeout(() => ($("status").textContent = ""), 2000);
  restore();
}

document.addEventListener("DOMContentLoaded", restore);
$("save").addEventListener("click", save);
