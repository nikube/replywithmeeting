"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { ExtensionError } = ExtensionUtils;
var { EventManager } = ExtensionCommon;

const DIALOG_LISTENER_ID = "replywithmeeting-event-dialog";
const MENU_PLAIN_ID = "rwm-menu-plain";
const MENU_KMEET_ID = "rwm-menu-kmeet";

// Abonnés à onMeetingRequested (fire objects du background).
const menuListeners = new Set();

function loadCalUtils() {
  // TB 128+ : ESM ; TB 115 : JSM.
  try {
    return ChromeUtils.importESModule(
      "resource:///modules/calendar/calUtils.sys.mjs"
    ).cal;
  } catch (e) {
    return ChromeUtils.import("resource:///modules/calendar/calUtils.jsm").cal;
  }
}

function loadExtensionSupport() {
  try {
    return ChromeUtils.importESModule(
      "resource:///modules/ExtensionSupport.sys.mjs"
    ).ExtensionSupport;
  } catch (e) {
    return ChromeUtils.import("resource:///modules/ExtensionSupport.jsm")
      .ExtensionSupport;
  }
}

/* ---------- menu contextuel des messages ----------
 * Depuis TB 115, #mailContext vit dans les sous-documents about:3pane
 * (liste des messages) et about:message (lecteur), pas dans messenger.xhtml.
 */

// nsIMsgHdr du message visé, depuis la fenêtre du sous-document.
function selectedMsgHdr(win) {
  try {
    const hdr = win.gDBView?.hdrForFirstSelectedMessage;
    if (hdr) {
      return hdr;
    }
  } catch (e) {
    // pas de sélection dans la liste
  }
  return win.gMessage || null;
}

function addMenuItems(doc, labels, extension) {
  const popup = doc.getElementById("mailContext");
  if (!popup || doc.getElementById(MENU_PLAIN_ID)) {
    return;
  }
  const win = doc.defaultView;

  const make = (id, label, withKmeet) => {
    const item = doc.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    item.addEventListener("command", async () => {
      try {
        const hdr = selectedMsgHdr(win);
        if (!hdr) {
          return;
        }
        const message = await extension.messageManager.convert(hdr);
        for (const fire of menuListeners) {
          fire.async(message, withKmeet);
        }
      } catch (e) {
        console.error("ReplyWithMeeting: menu contextuel", e);
      }
    });
    return item;
  };

  const plain = make(MENU_PLAIN_ID, labels.labelPlain, false);
  const kmeet = make(MENU_KMEET_ID, labels.labelKmeet, true);

  // Au premier niveau, après le bloc répondre/transférer si présent.
  const ref = doc.getElementById("mailContext-forwardAsMenu");
  if (ref) {
    ref.after(plain, kmeet);
  } else {
    popup.append(plain, kmeet);
  }

  popup.addEventListener("popupshowing", () => {
    const visible = !!selectedMsgHdr(win);
    plain.hidden = !visible;
    kmeet.hidden = !visible;
  });
}

// Tous les documents about:3pane / about:message actuellement chargés.
function* mailContextDocs() {
  for (const win of Services.wm.getEnumerator("mail:3pane")) {
    const tabmail = win.document.getElementById("tabmail");
    for (const tab of tabmail?.tabInfo || []) {
      const cw = tab.chromeBrowser?.contentWindow;
      if (cw?.document) {
        yield cw.document;
        const mb = cw.document.getElementById("messageBrowser")?.contentWindow;
        if (mb?.document) {
          yield mb.document;
        }
      }
    }
  }
  for (const win of Services.wm.getEnumerator("mail:messageWindow")) {
    const mb = win.document.getElementById("messageBrowser")?.contentWindow;
    if (mb?.document) {
      yield mb.document;
    }
  }
}

let menuObserver = null;

function startMenuObserver(labels, extension) {
  stopMenuObserver();
  // Documents déjà ouverts…
  for (const doc of mailContextDocs()) {
    try {
      addMenuItems(doc, labels, extension);
    } catch (e) {
      console.error("ReplyWithMeeting: injection menu", e);
    }
  }
  // …et tous ceux qui se chargeront (nouveaux onglets, fenêtres, rechargements).
  menuObserver = {
    observe(subject) {
      const doc = subject;
      if (doc.documentURI !== "about:3pane" && doc.documentURI !== "about:message") {
        return;
      }
      doc.addEventListener(
        "DOMContentLoaded",
        () => {
          try {
            addMenuItems(doc, labels, extension);
          } catch (e) {
            console.error("ReplyWithMeeting: injection menu", e);
          }
        },
        { once: true }
      );
    },
  };
  Services.obs.addObserver(menuObserver, "document-element-inserted");
}

function stopMenuObserver() {
  if (menuObserver) {
    try {
      Services.obs.removeObserver(menuObserver, "document-element-inserted");
    } catch (e) {
      // déjà retiré
    }
    menuObserver = null;
  }
}

function removeMenuItems() {
  for (const doc of mailContextDocs()) {
    for (const id of [MENU_PLAIN_ID, MENU_KMEET_ID]) {
      doc.getElementById(id)?.remove();
    }
  }
}

/* ---------- bouton kMeet dans la fenêtre d'événement ---------- */

function makeKmeetUrl(win, config) {
  const cs = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rnd = new Uint8Array(config.slugLen || 12);
  win.crypto.getRandomValues(rnd);
  let slug = "";
  for (const b of rnd) {
    slug += cs[b % cs.length];
  }
  return (config.base || "https://kmeet.infomaniak.com/") +
    (config.prefix || "meet-") + slug;
}

function addKmeetButton(doc, config) {
  if (!doc || doc.getElementById("rwm-kmeet-button")) {
    return;
  }
  const input = doc.getElementById("item-location");
  if (!input) {
    return;
  }
  const btn = doc.createElement("button");
  btn.id = "rwm-kmeet-button";
  btn.type = "button";
  btn.textContent = "📹 kMeet";
  btn.title = "Générer une salle kMeet et la placer dans le champ Lieu";
  btn.style.marginInlineStart = "6px";
  btn.addEventListener("click", () => {
    const win = doc.defaultView;
    input.value = makeKmeetUrl(win, config);
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  });
  input.insertAdjacentElement("afterend", btn);
}

function hookDialogWindow(win, config) {
  const iframe =
    win.document.getElementById("calendar-item-panel-iframe") ||
    win.document.querySelector('iframe[src*="calendar-item-iframe"]');
  if (!iframe) {
    return;
  }
  const inject = () => {
    try {
      addKmeetButton(iframe.contentDocument, config);
    } catch (e) {
      console.error("ReplyWithMeeting: injection bouton kMeet", e);
    }
  };
  if (
    iframe.contentDocument?.readyState === "complete" &&
    iframe.contentDocument.getElementById("item-location")
  ) {
    inject();
  } else {
    iframe.addEventListener("load", inject, { once: true });
  }
}

/* ---------- API ---------- */

this.calMeeting = class extends ExtensionCommon.ExtensionAPI {
  onShutdown() {
    const support = loadExtensionSupport();
    try {
      support.unregisterWindowListener(DIALOG_LISTENER_ID);
    } catch (e) {
      // jamais enregistré : rien à faire
    }
    stopMenuObserver();
    removeMenuItems();
    menuListeners.clear();
  }

  getAPI(context) {
    const { extension } = context;
    return {
      calMeeting: {
        onMeetingRequested: new EventManager({
          context,
          name: "calMeeting.onMeetingRequested",
          register: (fire) => {
            menuListeners.add(fire);
            return () => {
              menuListeners.delete(fire);
            };
          },
        }).api(),

        async initContextMenu(labels) {
          startMenuObserver(labels, extension);
        },

        async initKmeetButton(config) {
          const support = loadExtensionSupport();
          try {
            support.unregisterWindowListener(DIALOG_LISTENER_ID);
          } catch (e) {
            // premier enregistrement
          }
          support.registerWindowListener(DIALOG_LISTENER_ID, {
            chromeURLs: [
              "chrome://calendar/content/calendar-event-dialog.xhtml",
            ],
            onLoadWindow(win) {
              hookDialogWindow(win, config);
            },
          });
        },

        async openNewEvent(details) {
          const cal = loadCalUtils();

          const win = Services.wm.getMostRecentWindow("mail:3pane");
          if (!win) {
            throw new ExtensionError("Fenêtre principale introuvable");
          }
          if (typeof win.createEventWithDialog !== "function") {
            throw new ExtensionError(
              "Calendrier indisponible (createEventWithDialog absent)"
            );
          }

          const event = Cc["@mozilla.org/calendar/event;1"].createInstance(
            Ci.calIEvent
          );

          if (details.title) {
            event.title = details.title;
          }
          if (details.description) {
            event.descriptionText = details.description;
          }
          if (details.location) {
            event.setProperty("LOCATION", details.location);
          }

          // Prochain créneau : arrondi à la demi-heure suivante.
          const minutes = details.durationMin > 0 ? details.durationMin : 60;
          const startJs = new Date();
          startJs.setSeconds(0, 0);
          startJs.setMinutes(startJs.getMinutes() < 30 ? 30 : 60);
          event.startDate = cal.dtz.jsDateToDateTime(
            startJs,
            cal.dtz.defaultTimezone
          );
          event.endDate = cal.dtz.jsDateToDateTime(
            new Date(startJs.getTime() + minutes * 60000),
            cal.dtz.defaultTimezone
          );

          for (const a of details.attendees || []) {
            if (!a || !a.email) {
              continue;
            }
            const attendee = Cc[
              "@mozilla.org/calendar/attendee;1"
            ].createInstance(Ci.calIAttendee);
            attendee.id = "mailto:" + a.email;
            if (a.name) {
              attendee.commonName = a.name;
            }
            attendee.role = "REQ-PARTICIPANT";
            attendee.participationStatus = "NEEDS-ACTION";
            attendee.rsvp = "TRUE";
            event.addAttendee(attendee);
          }

          // calendar=null : la boîte de dialogue prend le calendrier par défaut,
          // l'utilisateur peut en changer avant d'enregistrer.
          win.createEventWithDialog(null, null, null, null, event);
        },
      },
    };
  }
};
