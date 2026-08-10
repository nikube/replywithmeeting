# Reply with Meeting

Module Thunderbird/Betterbird qui apporte l'équivalent du « Répondre par une
réunion » d'Outlook, avec en bonus la visio [kMeet](https://kmeet.infomaniak.com)
d'Infomaniak (gratuite, illimitée, sans compte) en un clic.

Clic droit sur un message → deux entrées au premier niveau du menu :

- **Répondre par une réunion** — ouvre la fenêtre de création d'événement
  pré-remplie ;
- **Répondre par une réunion kMeet** — idem, avec en plus une salle kMeet en
  champ Lieu et en tête de description.

Pré-remplissage :

- **Participants** : expéditeur + destinataires (Pour/Cc) du mail, vos propres
  identités étant exclues, doublons dédupliqués ;
- **Titre** : sujet du mail (préfixes `Re:`/`Fwd:`/`Tr:` retirés) ;
- **Description** : corps du mail (text/plain, ou HTML détaggé), tronqué à
  10 000 caractères — désactivable dans les paramètres ;
- **Créneau** : prochaine demi-heure, durée configurable (1 h par défaut).

Un bouton **« 📹 kMeet »** est aussi injecté à côté du champ Lieu de la fenêtre
d'édition d'événement (y compris pour les événements créés nativement) : un clic
génère une salle et remplit le champ. Limite : uniquement la fenêtre séparée,
pas le mode « éditer dans un onglet ».

À l'enregistrement, Thunderbird propose l'envoi des invitations (iMIP standard)
comme pour tout événement avec participants : les destinataires reçoivent une
invitation acceptable dans n'importe quel client (Outlook, Gmail…).

## kMeet sans API

La salle est une simple URL `https://kmeet.infomaniak.com/<préfixe><suffixe
aléatoire>` : kMeet crée la salle au moment où le premier participant ouvre le
lien. Aucun compte, aucun token, aucune donnée ne transite ailleurs que dans
l'invitation. (L'API `POST /1/kmeet/rooms` existe mais créerait un événement en
double sur l'agenda kSuite — inutile ici puisque l'événement est déjà posé par
Thunderbird.)

## Paramètres

*Outils → Modules complémentaires → Reply with Meeting → Préférences* :

| Paramètre | Défaut |
|---|---|
| Durée par défaut de la réunion | 60 min |
| Reprendre le corps du mail dans la description | oui |
| Préfixe des salles kMeet | `anatole-` |
| Longueur du suffixe aléatoire | 12 |
| URL de base | `https://kmeet.infomaniak.com/` |

## Installation

Télécharger le `.xpi` (ou le construire, cf. ci-dessous), puis dans
Thunderbird : *Outils → Modules complémentaires* → roue dentée → *Installer un
module depuis un fichier…*. Un avertissement « accès complet » s'affiche :
normal pour une Experiment API (voir Architecture).

## Construction

```bash
cd replywithmeeting
zip -r ../replywithmeeting.xpi . -x "*.git*"
```

Pour développer sans re-zipper : *Outils → Outils de développement →
Déboguer des modules* → *Charger un module temporaire* → `manifest.json`.

## Architecture

- `background.js` — MailExtension : lecture du message (`messages.getFull`),
  collecte des adresses, réglages (`storage.local`) ;
- `api/` — Experiment API `calMeeting` (code privilégié), nécessaire car l'API
  WebExtension stable ne couvre ni la création d'événements de calendrier, ni
  l'injection dans le menu contextuel natif au premier niveau (l'API `menus`
  regroupe les entrées multiples dans un sous-menu) :
  - entrées du menu contextuel des messages (`mailContext`) ;
  - création de l'événement (`calIEvent`, `calIAttendee`,
    `createEventWithDialog`) ;
  - bouton kMeet dans la fenêtre d'édition d'événement.

Compatibilité visée : Thunderbird 115 → 140+ (imports ESM avec repli JSM).
Testé sur Betterbird 128.

## Débogage

Console d'erreurs : `Ctrl+Maj+J`, filtre `ReplyWithMeeting`.

## Limites connues

- Une seule sélection : seul le premier message sélectionné est pris en compte.
- Le bouton kMeet n'apparaît pas en mode « éditer les événements dans un
  onglet ».
- L'Experiment API dépend d'internes Thunderbird non garantis entre versions
  majeures — à re-tester à chaque montée d'ESR.

## Marques

kMeet et Infomaniak sont des marques d'Infomaniak Network SA. Ce module est un
projet indépendant, non affilié à Infomaniak ; l'icône est un glyphe « k »
original, pas un visuel officiel.

## Licence

[MIT](LICENSE)
