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
const MENU_LISTENER_ID = "replywithmeeting-mail-context";
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

/* ---------- menu contextuel des messages ---------- */

// nsIMsgHdr du message visé : liste des messages, ou message affiché.
function selectedMsgHdr(win) {
  const tabmail = win.document.getElementById("tabmail");
  try {
    const hdr = tabmail?.currentAbout3Pane?.gDBView?.hdrForFirstSelectedMessage;
    if (hdr) {
      return hdr;
    }
  } catch (e) {
    // pas de sélection dans la liste
  }
  return tabmail?.currentAboutMessage?.gMessage || null;
}

function addMenuItems(win, labels, extension) {
  const doc = win.document;
  const popup = doc.getElementById("mailContext");
  if (!popup || doc.getElementById(MENU_PLAIN_ID)) {
    return;
  }

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

function removeMenuItems(win) {
  for (const id of [MENU_PLAIN_ID, MENU_KMEET_ID]) {
    win.document.getElementById(id)?.remove();
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
    for (const id of [DIALOG_LISTENER_ID, MENU_LISTENER_ID]) {
      try {
        support.unregisterWindowListener(id);
      } catch (e) {
        // jamais enregistré : rien à faire
      }
    }
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      removeMenuItems(win);
    }
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
          const support = loadExtensionSupport();
          try {
            support.unregisterWindowListener(MENU_LISTENER_ID);
          } catch (e) {
            // premier enregistrement
          }
          support.registerWindowListener(MENU_LISTENER_ID, {
            chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
            onLoadWindow(win) {
              addMenuItems(win, labels, extension);
            },
          });
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
