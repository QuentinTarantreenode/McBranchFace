import type { HelpDict } from "./types";

export const help: HelpDict = {
  title: "Hilfe",
  search: "Hilfe durchsuchen",
  back: "Zurück",
  show: "In der App zeigen",
  noMatch: "Nichts gefunden.",
  groups: { start: "Einstieg", cleanup: "Aufräumen", git: "Git", setup: "Einrichten", reference: "Nachschlagen" },
  forView: "Zu dieser Ansicht",
  topics: [
    {
      id: "overview",
      title: "Überblick",
      summary: "Wofür McBranchFace da ist und wie das Fenster aufgebaut ist.",
      sections: [
        {
          id: "what",
          title: "Was McBranchFace macht",
          body: [
            "McBranchFace bewertet alle lokalen Branches und die Branches auf dem Server. Voreingestellt zeigt die Lokal-Liste nur gone-Branches: Branches, deren Upstream nach einem Pull Request gelöscht wurde ([gone]). Ausgeschaltet zeigt der Schalter „Nur gone“ auch die, die der Server noch hat, und nie gepushte.",
            "Jeder Branch bekommt eine Bewertung mit Nachweis. Gelöscht wird nur nach Bestätigung, immer mit Backup-Ref – jeder Löschvorgang lässt sich rückgängig machen.",
          ],
        },
        {
          id: "layout",
          title: "Aufbau des Fensters",
          body: [
            "- Links die Sidebar mit allen Repos unter deinen Ordnern, je Repo eine Karte mit seinen Worktrees darunter; ein Klick filtert die Tabelle auf ein Repo, mit Strg oder Umschalt nimmst du weitere dazu. Die Auswahl gilt in beiden Perspektiven; Git zeigt das zuletzt angeklickte Repo. Was die Zeichen auf den Karten bedeuten, steht in der Legende.",
            "- In der Mitte die Tabelle der Branches, oben umschaltbar zwischen Lokal und Online.",
            "- Rechts das Detail-Pane: oben die Bewertung, dann „Zu tun“ mit den Git-Schritten bis zum Löschen, dann die Prüfung, Notiz & Tags und die Belege.",
            "Oben wechselst du zwischen drei Ansichten, als Tabs: Dashboard (Ctrl 1), Aufräumen (Ctrl 2) und Git (Ctrl 3). Der aktive Tab geht in die Ansicht darunter über. Dashboard zählt, was ansteht, Aufräumen die sicher löschbaren Branches, Git die geänderten Dateien des Repos, das es öffnen würde. Hinter einem Trenner folgen „Verbindungen“: der Status von Azure DevOps und GitHub, ein Klick meldet an und öffnet Links. Dann die Gruppe „Daten“: Aktualisieren, die durchgestrichene Wolke für „ohne Server neu bewerten“ (der laufende Knopf dreht sein Symbol) und das Alter der Daten; ein Klick darauf zeigt, was wann aktualisiert hat. Rechts Hinweise, Commit-Suche und Verlauf, dann Fenster und Darstellung, dann Hilfe und Einstellungen.",
            "Tooltips nennen am Fuß, was ein Element außer dem Klick noch kann – etwa „Doppelklick: im Dateimanager öffnen“ oder „Rechtsklick: weitere Aktionen“.",
            "Jeden Branch-Namen kopierst du per Rechtsklick – in der Tabelle, auf den Karten der Sidebar, im Detail, in der Git-Ansicht und in Dialogen. Remote-Branches bieten den Namen mit und ohne Remote an.",
            "Die ganze Oberfläche lässt sich vergrößern: Ctrl + und Ctrl − in drei Stufen, Ctrl 0 setzt auf 115 % zurück (auch unter Settings → Darstellung).",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "dashboard",
          title: "Dashboard",
          body: [
            "Die App startet im Dashboard. Oben steht „Als Nächstes“: Reviews, die auf dich warten, eigene Pull Requests mit Änderungswünschen, Freigabe oder langer Wartezeit, Commits, die es nur lokal gibt, dann Aufräumen, gemergte Worktrees, ein Default-Branch hinter dem Server und nicht committete Änderungen. Jede Zeile hat eine Aktion; „Ausblenden“ legt sie beiseite, bis sich ihr Stand ändert.",
            "Darunter die Kacheln Pull Requests, Aufräumen, Lokale Änderungen, Worktrees und Zuletzt gelöscht. Pull Requests zeigt „Meine“ (deine und die, die auf dein Review warten) oder „Alle“. Wer du bist, sagen Azure CLI und GitHub CLI; die App fragt sie nur, Zugangsdaten nimmt sie nie.",
            "Sind in der Seitenleiste Repos ausgewählt, zeigt das Dashboard nur diese.",
          ],
          show: { perspective: "Dashboard" },
        },
        {
          id: "folders",
          title: "Ordner in der Repo-Liste",
          body: [
            "- Hinzufügen: das „+“ an der Überschrift „Ordner“ in der Sidebar, oder Ordner aus dem Explorer auf die Sidebar ziehen. Sie werden sofort gescannt. Steht ein Ordner schon in der Liste oder liegt in einem, passiert nichts; Dateien werden nicht hinzugefügt.",
            "- Entfernen: im Menü „⋯“ des Ordnerkopfs. Nach Bestätigung verschwinden nur die Repos aus der Liste, der Ordner bleibt auf der Platte. Aus den Repo-Gruppen nimmt es sie ebenfalls.",
            "- Auswählen: ein Ordnerkopf wählt wie ein Gruppenkopf. Klick wählt seine Repos, ein zweiter hebt die Auswahl auf, mit Strg fügst du sie hinzu oder nimmst sie heraus, mit Umschalt erweiterst du die Auswahl bis dorthin. Der Pfeil davor klappt den Ordner.",
            "- Ein Ordner bietet im Menü dasselbe wie eine Gruppe: Fetch, Pull und Push mit Anzahl, Branches wechseln, anlegen und übernehmen, Befehle, Pull Requests, neu bewerten. Dazu kommt, was ein Ort auf der Platte hat: Ordner, Terminal, Pfad.",
            "- Reihenfolge: einen Gruppenkopf auf einen anderen ziehen.",
            "- Doppelklick auf eine Repo-Karte, einen Worktree oder einen Gruppenkopf öffnet den Ordner im Dateimanager.",
            "- Farbe: im Menü einer Repo-Karte unter „Farbe“. Sie gilt für alle Working Copies des Repos und tönt die Karte.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "table",
          title: "Spalten, Filter, Gruppen",
          body: [
            "- Breite: am rechten Rand eines Spaltenkopfs ziehen; Doppelklick setzt sie zurück, mit Fokus gehen auch die Pfeiltasten.",
            "- Reihenfolge: einen Spaltenkopf auf einen anderen ziehen.",
            "- Die Autor-Spalte ist standardmäßig an. Online gibt es zusätzlich die Spalte „Quelle“ (Anbieter und Remote, ein Klick öffnet den Branch im Browser), einzuschalten im Kopfmenü.",
            "- Über der Tabelle filtert die Pille „Alle · Safe · Review · Blocked · Unsafe“ nach Bewertung, mehrere zugleich. Rechts oben stehen die Filter Präfixe und Tags und die Ansicht (Gruppieren, Bericht).",
            "- Kopfmenü (Rechtsklick oder „⋯“ am Kopf): sortieren, filtern, nach der Spalte gruppieren, verschieben, ausblenden, andere Spalten einblenden, zurücksetzen.",
            "Der Filter im Kopfmenü zeigt die Werte der Spalte mit Anzahl – gezählt nach allen anderen Filtern – und erlaubt Mehrfachauswahl. Aktive Filter stehen als Pillen über der Tabelle und lassen sich dort einzeln entfernen.",
            "Gruppieren geht nach Ordner, Repo, Präfix, Bewertung, Autor oder Branch-Name. Das Layout merkt sich McBranchFace getrennt für Lokal und Online.",
            "Nach Branch-Name stehen Namen, die es in mehreren Repos gibt, zuerst. Das Menü „⋯“ am Gruppenkopf wirkt auf alle Repos der Gruppe: Fast-forward, überall auschecken, überall pushen, in weiteren Repos anlegen. Jedes Repo läuft für sich, am Ende steht eine Zusammenfassung.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "find",
          title: "Commit suchen",
          body: [
            "Ctrl Shift F oder die Lupe oben rechts sucht einen Commit in allen Repos: nach SHA, Anfang des SHA oder Text der Commit-Message. Die Treffer stehen je Repo mit den Branches, die den Commit enthalten; ein Klick öffnet ihn in der Git-Historie.",
          ],
        },
        {
          id: "switch",
          title: "Branch wechseln aus der Sidebar",
          body: [
            "Die Branch-Zeile jeder Repo-Karte ist ein Dropdown, ebenso die Zeile jedes Worktrees. Oben steht eine Suche; tippst du einen Namen, den es nicht gibt, bietet das Dropdown „Neuer Branch“ an – vom aktuellen Stand oder vom Default-Branch des Servers.",
            "Darunter filtert eine Leiste die Liste: Alle, Lokal, Server (nur dort, Wechseln legt den lokalen Branch an) oder Meine (letzter Commit von einer deiner E-Mail-Adressen aus den Settings). Die Wahl bleibt beim nächsten Öffnen erhalten.",
            "Haben andere Repos denselben Branch, lokal oder auf dem Server, stehen sie mit Checkbox darunter; mit Strg oder Umschalt markierte Repos sind vorausgewählt. Gewechselt wird Repo für Repo – git kann mehrere Repos nicht in einem Schritt wechseln. Scheitert eines, bleiben die anderen gewechselt, und die Meldung bietet „Zurück“ an.",
            "Lokale Änderungen nimmst du mit (Stash und wieder einspielen) oder stashst sie. Gibt es beim Einspielen Konflikte, behält git den Stash, und das Repo zeigt die Konflikte.",
            "Ein Branch kann nur in einem Worktree gleichzeitig ausgecheckt sein; solche Einträge sind ausgegraut.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "groups",
          title: "Repo-Gruppen",
          body: [
            "Über den Ordnern stehen deine Repo-Gruppen: eigene Zusammenstellungen von Repos, etwa alle, die ein Release zusammen braucht. Ein Repo kann in mehreren Gruppen stehen. Gruppen sind etwas anderes als „Gruppieren nach“ in der Tabelle: Die ordnet nur die Zeilen.",
            "Anlegen und füllen per Drag & Drop: Zieh eine Repo-Karte oder eine Worktree-Zeile auf „Neue Gruppe“ oder auf eine Gruppe. Mit Strg oder Umschalt markierte Repos kommen mit. Aus einer Gruppe heraus kopiert das Ziehen in eine andere Gruppe, mit Umschalt verschiebt es; auf die Ordner gezogen, nimmt es das Repo aus der Gruppe. Esc bricht ab, und jede Änderung lässt sich in der Meldung rückgängig machen.",
            "Ohne Maus: „Zu Gruppe hinzufügen“ im Kontextmenü eines Repos oder Worktrees. Den Namen änderst du per Doppelklick auf den Gruppenkopf, mit F2 oder über „Umbenennen“. Beim Ordnerkopf öffnet der Doppelklick den Ordner im Dateimanager, denn einen Ordner benennt die App nicht um.",
            "Ein Klick auf den Gruppenkopf wählt die Repos der Gruppe, ein zweiter hebt die Auswahl auf; mit Strg fügst du sie der Auswahl hinzu oder nimmst sie heraus. Einzelne Repos einer Gruppe wählst du wie im Dateimanager: Klick, mit Strg einzeln dazu, mit Umschalt einen Bereich.",
            "Mit der Tastatur: ↑ und ↓ wählen, Shift+↑ und Shift+↓ erweitern, Space schaltet um, Ctrl+A wählt alle, Esc keine, ← springt zum Gruppenkopf, und Alt+← oder Alt+→ klappen alle Gruppen. Dieselben vier Werkzeuge stehen oben an „Ordner“ und „Repo-Gruppen“ und im Kontextmenü jedes Gruppenkopfs.",
            "Das Menü der Gruppe („⋯“ oder Rechtsklick) wirkt auf alle ihre Repos: Branch wechseln oder anlegen, Fetch, Pull, Push und die eigenen Befehle. Die Einträge nennen vorab, wie viele Repos betroffen sind. Pull nimmt nur Repos auf einem Branch mit Upstream, Push nur solche mit Commits, die der Server nicht hat, oder mit neuem Branch (dann mit Upstream). Die Meldung am Ende nennt, was ausgelassen wurde.",
            "Beim Wechseln zeigt die Liste jeden Branch einmal und dazu, in wie vielen Repos er existiert. Im zweiten Schritt steht jedes Repo mit dem, was dort passiert. Lokale Änderungen behandelst du einmal für alle: mitnehmen (stash, switch, stash pop) oder stashen.",
            "Dasselbe geht für einen Ordner der Sidebar, über das Menü seines Kopfes. „Branch übernehmen …“ schlägt Branches vor, die es nur in einem Teil der Repos gibt (Bereich „Nicht überall“), und legt sie in den übrigen an. Ob von HEAD oder vom Default-Branch, wählst du, sobald irgendwo angelegt wird; „Nur in … Repos anlegen“ legt an, ohne zu wechseln.",
            "Einzelne Repos bedienst du direkt in der Gruppe: Jede Zeile hat ihr eigenes Branch-Dropdown zum Wechseln und Anlegen, und ihr Kontextmenü bietet Fetch, Pull und Push nur für dieses Repo.",
            "Repo und Branch stehen in zwei Spalten. Die Kante dazwischen lässt sich ziehen und gilt für alle Gruppen; ein Doppelklick stellt 50:50 wieder her. Ist ein Name abgeschnitten, zeigt der Tooltip ihn ganz.",
            "Grau schimmernde Flächen kommen gleich: Der Stand des Repos wird noch gelesen. Bis dahin lässt sich dort nichts anklicken, auch kein Kontextmenü. Läuft in einem Repo gerade eine Git-Operation, bleibt sein Branch sichtbar, und der Tooltip sagt, worauf er wartet.",
            "Eine Working Copy, die der Scan nicht mehr findet, bleibt ausgegraut in der Gruppe, bis du sie herausnimmst.",
            "Ordner, Repos und Gruppen haben eine Identität aus Kürzel und Farbe. Die App vergibt sie selbst; über „Identität …“ im Menü wählst du eigene. Das Kürzel eines Repos ersetzt das seines Ordners überall, wo das Repo genannt wird; das einer Gruppe steht an ihrem Kopf und, solange sie gewählt ist, im Filter-Hinweis der Tabelle und in Git.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "detached",
          title: "Detached HEAD",
          body: [
            "Detached heißt: HEAD zeigt direkt auf einen Commit statt auf einen Branch. Das ist harmlos, solange du dort nichts committest – Commits im detached-Zustand gehören keinem Branch und sind nach einem Wechsel nur noch über das Reflog zu finden.",
            "Behebung: im Dropdown einen neuen Branch vom aktuellen Stand anlegen (wie git switch -c), oder auf einen bestehenden Branch wechseln. Trägt der detached HEAD Commits, die auf keinem Branch liegen, warnt die Zeile mit einem Dreieck.",
            "Hat ein Repo Worktree-Einträge, die beim Kopieren des Ordners mitkamen, zeigt die Karte ein Symbol; das Kontextmenü entfernt den Eintrag (er landet im Backup-Ordner, der Worktree selbst bleibt).",
          ],
        },
        {
          id: "refresh",
          title: "Aktualisieren",
          body: [
            "„Aktualisieren“ (F5) holt per Fetch den Stand aller Remotes und bewertet alles neu. Shift F5 bewertet ohne Server neu, ohne Netz und ohne Anbieter; die Pull Requests des letzten Laufs gelten weiter.",
            "Beim Start ist sofort da, was der letzte Lauf kannte: Branches, Bewertungen und der Git-Stand jedes Repos, leicht gedimmt, bis der frische Stand kommt. Die Zeit oben sagt, wie alt die Daten sind.",
            "Danach läuft der Start in zwei Stufen, oben als „Lokal“ und „Server“ angezeigt. Erst wird bewertet, was lokal da ist, ohne Netz; Repos, deren Branches und Dateien seit dem letzten Lauf gleich sind, übernehmen ihre Bewertung. Dann fragt ein leichter Check jeden Server, ob sich dort etwas getan hat. Nur diese Repos werden gefetcht und nach Pull Requests gefragt, der Rest behält den Stand vom letzten Lauf. Alles zu fetchen bleibt Aufgabe von „Aktualisieren“ und dem Auto-Fetch.",
            "Lokale Änderungen – Commit, Checkout, Stash – sieht McBranchFace über den Dateisystem-Watcher nach etwa einer halben Sekunde.",
            "Den Server prüft ein leichter Check alle paar Minuten (Settings → Aktualisierung & Hinweise). Nur wenn sich dort etwas geändert hat, folgt ein Fetch für dieses Repo.",
          ],
          show: { settings: "updates" },
        },
      ],
    },
    {
      id: "local",
      title: "Aufräumen · Lokal",
      summary: "Bewertungen, Nachweise, Löschen und Wiederherstellen lokaler Branches.",
      sections: [
        {
          id: "verdicts",
          title: "Bewertungen",
          body: [
            "- Safe: Der Inhalt ist nachweislich gemerged und lokal hängt nichts mehr daran.",
            "- Review: Lokal sauber, aber ohne Merge-Nachweis. Nach dem Löschen stehen die Commits nur noch im Backup-Ref.",
            "- Unsafe: Ungepushte Commits, geänderte Dateien oder ein Stash hängen am Branch.",
            "- Blocked: Der Branch ist noch ausgecheckt. „Zu tun“ im Detail-Pane bietet den Checkout des Default-Branches an.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "todo",
          title: "Zu tun und Prüfung",
          body: [
            "Ist ein Branch nicht Safe, listet das Detail-Pane unter „Zu tun“ die Git-Schritte bis zum Löschen, in der Reihenfolge, in der git sie zulässt: Änderungen committen oder stashen, Stashes prüfen, Push (beim ersten Mal mit -u), Fast-forward, den PR abschließen, den Worktree entfernen, den Default-Branch auschecken. Wo es eine Operation gibt, steht der Knopf dabei.",
            "Darunter die Prüfung: offene Punkte ausgeklappt mit Grund, bestandene zu einer grünen Zeile „n von m OK“ zusammengefasst, ein Klick zeigt sie.",
            "Den Branch, der im Haupt-Worktree ausgecheckt ist, löscht git nicht; die App bietet dafür kein Löschen an und sagt bei der Entf-Taste, warum. Ein Branch in einem Linked Worktree lässt sich per Force Delete löschen: Der Worktree wird dabei entfernt, sein Ordner wandert mit allen Dateien in die Backups. Unter „Zuletzt gelöscht“ holst du Branch und Worktree zurück oder entfernst das Backup endgültig.",
          ],
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "evidence",
          title: "Nachweise",
          body: [
            "Ein Branch gilt als gemerged, wenn sein Tip im Default-Branch enthalten ist (Merge-Commit oder Fast-Forward), wenn jeder eigene Commit dort ein patch-gleiches Gegenstück hat (Rebase oder Cherry-Pick), wenn sein Gesamt-Diff einem Commit dort entspricht (Squash-Merge), wenn ein abgeschlossener Pull Request genau diesen Stand gemerged hat oder wenn ein anderer Branch auf dem Server den Tip enthält.",
            "Der eigene Upstream zählt nicht: Gepusht ist nicht gemerged. Ein vollständig gepushter, aber nicht gemergter Branch ist deshalb Review, nicht Safe.",
            "Die Prüfung im Detail-Pane zeigt, welcher Nachweis greift und was sonst geprüft wurde.",
            "Wo eine Prüfung Commits meint – etwa „2 Commits nach dem letzten Push“ –, zeigt „Commits anzeigen“ genau diese Commits in einem eigenen Fenster, mit Suche und Datumsfilter. Die PR-Karte zeigt Titel, Quelle → Ziel, Zeitpunkte und auf Wunsch die Commits des PRs.",
          ],
        },
        {
          id: "delete",
          title: "Löschen",
          body: [
            "Safe-Branches löschst du einzeln, markiert oder alle sichtbaren auf einmal. Vor dem Löschen prüft McBranchFace jeden Branch erneut; hat sich etwas geändert, bleibt er stehen.",
            "Andere Bewertungen lassen sich nur per Force Delete löschen, mit ausdrücklicher Bestätigung der Risiken.",
          ],
        },
        {
          id: "restore",
          title: "Backup und Rückgängig",
          body: [
            "Jeder gelöschte Branch bleibt als Backup-Ref unter refs/mcbranchface/backup erhalten.",
            "Direkt nach dem Löschen macht „Rückgängig“ alles zurück. Später findest du jeden Löschvorgang unter „Zuletzt gelöscht“ (Uhr-Symbol oben) und stellst ihn dort wieder her.",
          ],
        },
      ],
    },
    {
      id: "online",
      title: "Aufräumen · Online",
      summary: "Branches auf dem Server: Bewertung, Stand, fremde Branches, lokale Kopien.",
      sections: [
        {
          id: "verdicts",
          title: "Bewertungen",
          body: [
            "- Gemerged: Der Inhalt ist nachweislich im Default-Branch; der Branch auf dem Server kann weg.",
            "- Inaktiv: Nicht gemerged, kein offener Pull Request und seit Langem ohne Commit (Schwelle in Settings → Online-Branches). Das gilt nur, wenn die Liste der Pull Requests bekannt ist: Solange sie fehlt, wird kein Branch inaktiv.",
            "- Aktiv: Jüngere Commits oder ein offener Pull Request.",
          ],
          show: { perspective: "Cleanup", scope: "Online" },
        },
        {
          id: "state",
          title: "Stand und Erreichbarkeit",
          body: [
            "Rechts neben den Tabs steht, wie alt der Stand vom Server ist. „Offline“ markiert Repos, deren Server beim letzten Abgleich nicht erreichbar war.",
            "Einzelne Repos schließt du über ihr Kontextmenü in der Sidebar von der Online-Prüfung aus.",
          ],
        },
        {
          id: "foreign",
          title: "Branches anderer",
          body: [
            "Branches, deren letzter Commit nicht von dir stammt, sind im Löschdialog abgewählt. Du kannst sie bewusst dazunehmen.",
            "Welche Adressen „du“ bist, steht in Settings → Regeln.",
          ],
          show: { settings: "rules" },
        },
        {
          id: "copies",
          title: "Lokale Kopien",
          body: [
            "Die Spalte „Lokal“ zählt die lokalen Branches, die diesen Server-Branch verfolgen. Beim Löschen auf dem Server bietet McBranchFace an, sie mitzulöschen – ebenfalls mit Backup.",
          ],
        },
      ],
    },
    {
      id: "protect",
      title: "Sperren, Ignorieren, Tags",
      summary: "Branches schützen, stummschalten und beschriften.",
      sections: [
        {
          id: "lock",
          title: "Sperren",
          body: [
            "Ein gesperrter Branch – oder ein ganzes gesperrtes Repo – wird nie gelöscht, auch nicht per Force Delete. Gesperrte stehen in einer eigenen Rubrik am Ende der Tabelle.",
            "Sperren setzt du im Kontextmenü oder im Detail-Pane; die Liste steht in Settings → Regeln.",
          ],
          show: { settings: "rules" },
        },
        {
          id: "ignore",
          title: "Ignorieren",
          body: [
            "Ignorierte Branches zählen nicht mehr für Glocke und Benachrichtigung. Sie bleiben sichtbar in der Rubrik „Ignoriert“ und lassen sich weiter markieren und löschen.",
            "Du ignorierst für 30 Tage, 90 Tage oder bis auf Weiteres. Läuft die Frist ab, meldet sich der Branch wieder.",
            "Ignorieren ist kein Schutz – dafür gibt es Sperren.",
          ],
          show: { settings: "rules" },
        },
        {
          id: "prefixes",
          title: "Präfixe",
          body: [
            "Branch-Namen erscheinen als Pfeil-Segmente wie in einer Shell-Prompt: das Präfix (feature, bugfix, hotfix …) farbig, der Rest als ein Segment dahinter. Bekannte Präfixe haben feste Farben.",
            "Führende Teile ohne Buchstaben – ein Namespace wie „1/“ oder eine Version wie „2.4/“ – stehen gedämpft davor und zählen nicht als Präfix. In „2.4/release/rc-1/main“ ist „release“ das Präfix.",
            "Der Knopf „Präfixe“ über der Tabelle zählt, wie viele Branches es je Präfix gibt – nach allen anderen Filtern – und filtert mit Mehrfachauswahl. Die Suche findet „feature/x“ auch als „feature › x“.",
          ],
        },
        {
          id: "tags",
          title: "Tags und Notizen",
          body: [
            "Im Detail-Pane hängst du an jeden Branch Tags und eine Notiz. Für ein ganzes Repo geht das über das Kontextmenü in der Sidebar; Branches erben die Repo-Tags für Filter und Suche.",
            "Der Button „Tags“ über der Tabelle filtert nach Tags. Die Suche findet Tags mit #tag und den Text der Notizen. Der Bericht enthält beides.",
            "Tags und Notizen gelten für alle Working Copies desselben Repos und werden mit den Settings exportiert.",
          ],
        },
      ],
    },
    {
      id: "alerts",
      title: "Glocke und Benachrichtigung",
      summary: "Was gemeldet wird und wann.",
      sections: [
        {
          id: "bell",
          title: "Glocke und Lenses",
          body: [
            "Die Glocke zählt Branches, die Aufmerksamkeit brauchen, nach Lenses – etwa „Lokal: Safe“, „Lokal: nie gepusht“ oder „Online: gemerged“. Ein Klick auf eine Lens öffnet die passende gefilterte Tabelle.",
            "Welche Lenses zählen, stellst du in Settings → Aktualisierung & Hinweise ein. Gesperrte und ignorierte Branches zählen nie.",
          ],
          show: { settings: "updates" },
        },
        {
          id: "notify",
          title: "Benachrichtigung",
          body: [
            "Findet ein Scan im Hintergrund neue Kandidaten, meldet das System sie einmal. Bereits gemeldete Branches meldet McBranchFace nicht erneut.",
          ],
        },
      ],
    },
    {
      id: "copies",
      title: "Working Copies",
      summary: "Dasselbe Repo in mehreren Ordnern.",
      sections: [
        {
          id: "identity",
          title: "Farbe und Label",
          body: [
            "Liegt dasselbe Repo in mehreren Ordnern, bekommen alle Kopien dieselbe Farbe und je ein Label – etwa den Ordnernamen. Eine eigene Farbe wählst du im Menü der Repo-Karte.",
            "Sperren, Ignorieren, Tags und Notizen gelten für das Repo, also für alle seine Working Copies zugleich.",
          ],
        },
        {
          id: "create",
          title: "Working Copies für parallele Arbeit",
          body: [
            "„Working Copies anlegen …“ im Kontextmenü eines Repos, eines Branches oder im Kopf der Git-Ansicht legt einen oder mehrere weitere Ordner an – etwa einen je KI-Agent, damit sich die Agents nicht gegenseitig die Dateien ändern.",
            "- Worktree: schnell und platzsparend, teilt die Objekte mit dem Original. Jeder Worktree braucht einen eigenen Branch; derselbe Branch kann nicht in zwei Worktrees ausgecheckt sein.",
            "- Eigener Klon: unabhängig vom Original, lokal geklont und ohne Anmeldung. origin zeigt danach auf denselben Server wie im Original, die Server-Branches sind die, die das Original kennt.",
            "Vorgeschlagen werden freie Ordner neben dem Repo (Name-agent-1, Name-agent-2 …) und je Kopie ein neuer Branch nach der Vorlage agent/{n}, ausgehend vom Server-Stand des Default-Branches. Vor dem Anlegen prüft der Dialog Ordner und Branch-Namen; unter „Befehle“ steht, was ausgeführt wird.",
          ],
        },
        {
          id: "cleanup",
          title: "Worktrees wieder entfernen",
          body: [
            "Worktrees stehen in der Sidebar unter ihrem Repo. Ein Klick öffnet sie in der Git-Ansicht, das Kontextmenü bietet Ordner, Terminal, Befehle und „Worktree entfernen …“.",
            "Entfernen verschiebt den Ordner in die Backups, der Branch bleibt im Repo. Unter „Zuletzt gelöscht“ holst du den Worktree zurück oder entfernst seinen Ordner endgültig. Hat der Worktree Änderungen, fragt McBranchFace ein zweites Mal, bevor es ihn mit ihnen entfernt.",
            "Ein Klon ist ein normales Repo: Er erscheint nach dem nächsten Scan als weitere Working Copy, wenn er unter einem deiner Ordner liegt. Sonst bietet der Dialog an, den Elternordner aufzunehmen.",
          ],
        },
      ],
    },
    {
      id: "git",
      title: "Git-Perspektive",
      summary: "Änderungen, Verlauf, Branches, Push und Pull.",
      sections: [
        {
          id: "changes",
          title: "Änderungen",
          body: [
            "Die Liste zeigt Konflikte, gestagte und ungestagte Dateien. Space stagt oder unstagt die markierte Datei; Verwerfen fragt nach.",
            "Unten schreibst du die Commit-Message und committest.",
            "„Alle Repos“ oben zeigt die Änderungen aller Repos, ein Block je Repo; ist links eine Auswahl oder Repo-Gruppe aktiv, nur deren Repos. Der Kopf eines Blocks stagt alles auf einmal, ← und → klappen ihn ein und aus. Ein Klick auf eine Datei öffnet ihr Repo; Diff, Commit und Git-Befehle beziehen sich dann darauf, und der Commit-Bereich nennt es.",
            "Repos ohne Änderungen stehen gesammelt in einer Zeile. Ein Repo, dessen Stand noch gelesen wird, zeigt einen grauen Platzhalter.",
            "Der Knopf neben „Alle Repos“ gruppiert die Blöcke nach den Ordnern, in denen die Repos liegen. Das Kontextmenü einer Datei zeigt sie mit „Im Dateimanager“ markiert an.",
            "Jede Ebene rückt eine Stufe ein: Ordner, Repo, Status, auf Wunsch Verzeichnis. Jeder Kopf klappt zu und verbirgt alles darunter. Alt+Klick auf den Pfeil oder Alt+← und Alt+→ klappen alle Gruppen einer Ebene; der Knopf oben rechts klappt alles. Eine Datei, die teils gestaged ist, steht in beiden Gruppen und trägt ein Doppel-Symbol.",
            "Hat ein Repo offene Pull Requests, zeigt sein Kopf einen Zähler. Ein Klick listet sie auf, ein Eintrag öffnet den Pull Request im Browser.",
          ],
          show: { perspective: "Git", gitTab: "changes" },
        },
        {
          id: "diff",
          title: "Diff",
          body: [
            "Der Diff zeigt geänderte Wörter kräftiger als die Zeile und färbt die Syntax. Oben rechts: nebeneinander statt einer Spalte, Leerraum ignorieren, mehr Kontext bis zur ganzen Datei, voriger und nächster Hunk, Suche.",
            "In den Änderungen stagt, unstagt oder verwirft die Leiste über jedem Hunk den ganzen Hunk. Einzelne Zeilen wählst du am Rand mit den Zeilennummern: Klick wählt, Umschalt erweitert, Ziehen wählt mehrere; die Leiste unten führt sie aus. Verwerfen fragt vorher und sichert die Datei in den Backup-Ordner.",
            "Mit ignoriertem Leerraum oder gekürztem Diff geht das nicht, weil der Patch dann nicht passt; neue und gelöschte Dateien nur als Ganzes, über die Dateiliste.",
            "- n / p oder Alt ↓ / ↑: nächster, voriger Hunk\n- Ctrl F: im Diff suchen, Enter springt\n- s / u: Hunk oben stagen oder unstagen\n- Esc: Auswahl aufheben",
          ],
          show: { perspective: "Git", gitTab: "changes" },
        },
        {
          id: "history",
          title: "Verlauf",
          body: [
            "Der Verlauf lädt beim Scrollen nach. Die Suche findet Commits nach Text, Autor oder SHA. Ein Klick zeigt Dateien und Diff.",
            "Über der Liste wählst du, welche Commits: ausgecheckt (HEAD), ein bestimmter Branch oder nur, was auf dem Branch neu ist gegenüber dem Default-Branch. „Log anzeigen“ im Menü einer Tabellenzeile und im Detail-Pane öffnet den Verlauf direkt für diesen Branch.",
          ],
          show: { perspective: "Git", gitTab: "history" },
        },
        {
          id: "branches",
          title: "Branches, Push und Pull",
          body: [
            "Der Branch-Umschalter oben ist derselbe wie in der Sidebar: er wechselt oder legt neue Branches an; bei lokalen Änderungen fragt er, ob sie mitgenommen werden.",
            "Fetch, Pull und Push stehen oben rechts in der Gruppe „Sync“; der Tooltip nennt jeweils den genauen Befehl. Pull ist immer ein Fast-Forward (git pull --ff-only --no-rebase): Haben sich beide Seiten geändert, passiert nichts. Push schickt nur den aktuellen Branch an seinen Upstream, auch wenn git anders konfiguriert ist.",
            "Läuft im offenen Repo eine Operation, die woanders gestartet wurde, etwa ein Pull über eine Repo-Gruppe, steht sie oben rechts. Bis sie fertig ist, warten Sync, Commit und Stagen; ihr Tooltip sagt, worauf.",
            "Die Liste „Branches“ ist eine Tabelle mit Spalten: sortieren per Klick auf den Kopf, Breiten ziehen, Spalten über das Kontextmenü des Kopfs ein- und ausblenden. Oben wählst du lokal, Server oder alle, filterst nach Upstream-Zustand, Worktree und eigenen Branches und gruppierst nach Präfix, Worktree, Upstream oder Autor. Mehrere Branches wählst du mit Strg oder Umschalt; „Im Aufräumen markieren“ übergibt sie dem sicheren Löschen.",
            "Die Anmeldung übernimmt git selbst – McBranchFace fragt nie nach Zugangsdaten.",
          ],
          show: { perspective: "Git", gitTab: "branches" },
        },
      ],
    },
    {
      id: "settings",
      title: "Settings",
      summary: "Ordner, Regeln, Hinweise, Umgebung, Export.",
      sections: [
        {
          id: "general",
          title: "Aufbau",
          body: ["Links stehen die Bereiche: Darstellung (Sprache, Theme, UI-Größe), Ordner & Scan, Aktualisierung & Hinweise, Fenster & Start, Regeln, Online-Branches, Befehle, Umgebung, Konfiguration (Export und Import) und Über. Darstellung wirkt sofort, alles andere mit „Speichern“."],
          show: { settings: "appearance" },
        },
        {
          id: "window",
          title: "Tray und Autostart",
          body: [
            "Standardmäßig schließt das Fenster ins Tray: Hintergrund-Scan, Server-Check und Benachrichtigungen laufen weiter. Das Tray-Menü öffnet, aktualisiert, schaltet Benachrichtigungen und beendet die App.",
            "„Mit dem System starten“ trägt McBranchFace in den Autostart ein (Windows, macOS, Linux); auf Wunsch startet es dann nur im Tray. Wo es keinen Tray-Bereich gibt, schließt das Fenster wie gewohnt.",
          ],
          show: { settings: "window" },
        },
        {
          id: "repos",
          title: "Ordner & Scan",
          body: ["Die Ordner, unter denen McBranchFace nach Repos sucht, mit ihrer Reihenfolge, dazu Suchtiefe, Parallelität und ob beim Scan ein Fetch läuft. Dieselbe Liste pflegst du auch direkt in der Sidebar."],
          show: { settings: "repos" },
        },
        {
          id: "rules",
          title: "Regeln",
          body: ["Deine E-Mail-Adressen, geschützte Branches, Default-Branches sowie die Listen der Sperren und Ignorierungen."],
          show: { settings: "rules" },
        },
        {
          id: "env",
          title: "Umgebung",
          body: ["Welche Werkzeuge gefunden wurden – git, Azure CLI, GitHub CLI – und wie du fehlende nachinstallierst."],
          show: { settings: "env" },
        },
        {
          id: "about",
          title: "Über und Diagnose",
          body: [
            "Version, App-Datenordner und Crash-Logs. Wurde McBranchFace unerwartet beendet, meldet es das beim nächsten Start und behält das Log in diesem Ordner.",
            "Der Diagnose-Schalter protokolliert jeden git-Aufruf und jede Aktivität mit Dauer und Ergebnis. Er ist standardmäßig aus und kostet dann nichts.",
            "„Aktivitäten anzeigen“ lässt die obere Leiste sagen, was gerade wo abgefragt wird, mit Quelle und Operation. Ein Klick darauf listet, was läuft und zuletzt lief, mit Fehler. Die Dauer steht im Log. Ausgeschaltet zeichnet die App nichts davon auf. Eigene Läufe über mehrere Repos zeigen ihren Fortschritt immer und lassen sich dort abbrechen.",
          ],
          show: { settings: "about" },
        },
      ],
    },
    {
      id: "commands",
      title: "Eigene Befehle",
      summary: "Skripte auf Repos und Branches, aus dem Kontextmenü gestartet.",
      sections: [
        {
          id: "create",
          title: "Anlegen",
          body: [
            "In Settings → Befehle legst du Name, Shell und Skript fest, dazu, ob der Befehl für alle oder nur ausgewählte Repos angeboten wird und ob auch auf Branch-Zeilen.",
            "Die Vorschau zeigt das Skript so, wie es für ein gewähltes Repo läuft; der Testlauf speichert und führt es einmal aus.",
          ],
          show: { settings: "commands" },
        },
        {
          id: "placeholders",
          title: "Platzhalter",
          body: [
            "- {{path}} – Ordner der Working Copy",
            "- {{repo}} – Name des Repos, {{identity}} – seine Identität über alle Kopien",
            "- {{branch}} – der Branch (nur auf Branch-Zeilen), {{remote}} – origin, {{default}} – der Default-Branch",
            "Werte werden für die gewählte Shell sicher gequotet eingesetzt, auch mit Leerzeichen, & oder $(…) im Namen. Deshalb keine eigenen Anführungszeichen um Platzhalter schreiben. Geschweifte Klammern der Shell selbst ({ … }, ${var}) bleiben unverändert.",
          ],
        },
        {
          id: "modes",
          title: "Terminal oder Hintergrund",
          body: [
            "Im Terminal läuft der Befehl sichtbar und interaktiv – für alles, was nachfragt.",
            "Im Hintergrund erscheint er unten rechts in der Liste der Läufe, mit Exit-Code, Dauer und Abbrechen; ein Klick zeigt die Ausgabe. Ein Fehler meldet sich mit „Ausgabe zeigen“. Nach 30 Minuten wird abgebrochen.",
          ],
        },
        {
          id: "where",
          title: "Wo die Befehle stehen",
          body: [
            "Im Kontextmenü eines Repos in der Sidebar, eines Ordners (dann für alle Repos darin), einer Branch-Zeile und als Knopf „Befehle“ im Detail-Pane.",
            "Befehle laufen mit deinen Rechten. Sie kommen nur aus deinen Settings; ein Import zeigt sie vorher zur Prüfung.",
          ],
        },
        {
          id: "prompts",
          title: "Als Prompt kopieren",
          body: [
            "Für die Arbeit mit einem KI-Assistenten: Das Kontextmenü einer Branch-Zeile und der Knopf „Prompt“ im Detail-Pane kopieren eine fertige Anleitung als Markdown in die Zwischenablage.",
            "- Merge in den Default-Branch\n- Pull Request anlegen, nur ohne offenen PR\n- Branch aufräumen\n- Rebase auf den Default-Branch",
            "Merge und Rebase gibt es nur für Branches mit eigenen Commits. Jeder Prompt nennt Ziel, Ausgangslage (Repo, Ordner, Commits, uncommitted changes, Nachweis, PR), die exakten git-Befehle und Regeln: Der Assistent fragt vor jedem Push und jedem Löschen, meldet Konflikte statt zu raten und nennt den SHA, mit dem sich der Branch wiederherstellen lässt.",
            "Settings → Prompts ändert die vier Texte oder legt eigene Vorlagen an. {{branch}}, {{default}}, {{situation}}, {{steps.merge}} und die anderen Variablen setzen die Werte des Branches ein; jeder Chip sagt, was er enthält, die Vorschau zeigt das Ergebnis an einem echten Branch. Eine eigene Vorlage kann einen Skill deines Assistenten nennen und legt fest, wo sie angeboten wird (lokal, online, beide) und ob nur mit eigenen Commits.",
          ],
        },
      ],
    },
    {
      id: "legend",
      title: "Legende",
      summary: "Jedes Zeichen der Oberfläche, so wie es aussieht, mit seiner Bedeutung.",
      sections: [
        {
          id: "verdicts",
          title: "Bewertungen",
          body: ["Die Pille vorn in jeder Zeile sagt, was mit dem Branch los ist. Lokal und Online bewerten verschieden."],
          legend: {
            visual: "verdicts",
            items: {
              Safe: "Lokal: nachweislich gemergt, lokal hängt nichts mehr dran. Kann weg.",
              Review: "Lokal: sauber, aber ohne Merge-Nachweis. Vor dem Löschen prüfen.",
              Unsafe: "Lokal: ungepushte Commits, uncommitted changes oder Stashes. Löschen verliert Arbeit.",
              Blocked: "Lokal: noch ausgecheckt, so nicht löschbar.",
              Merged: "Online: der Inhalt ist im Default-Branch. Der Branch auf dem Server kann weg.",
              Inactive: "Online: nicht gemergt, lange kein Commit.",
              Active: "Online: nicht gemergt, jüngst bearbeitet oder mit offenem PR.",
            },
          },
          show: { perspective: "Cleanup" },
        },
        {
          id: "segments",
          title: "Branch-Namen",
          body: ["Branch-Namen stehen als Segmente wie in einem Shell-Prompt. Nur der letzte Teil kürzt sich, wenn der Platz fehlt."],
          legend: {
            visual: "segments",
            items: {
              remote: "Grau vorn: das Remote, hier origin. Fehlt bei lokalen Branches.",
              namespace: "Grau vorn: ein Namespace ohne Buchstaben, etwa eine Versionsnummer.",
              prefix: "Farbig: das Präfix, die Art der Arbeit. Jedes Präfix hat seine eigene Farbe.",
              rest: "Neutral: der eigentliche Name.",
            },
          },
        },
        {
          id: "sidebar",
          title: "Sidebar",
          body: ["Jedes Repo ist eine Karte. Alle Zeichen haben einen Tooltip; hier stehen sie zusammen."],
          legend: {
            visual: "sidebar",
            items: {
              repoGroup: "Eine Repo-Gruppe: Klick filtert die Tabelle auf ihre Repos, „⋯“ öffnet die Aktionen für alle.",
              repoIcon: "Kürzel des Ordners, in dem das Repo liegt: dasselbe am Ordnerkopf, auf der Karte, in der Tabelle und im Detail. Der Tooltip nennt den Pfad.",
              copyLabel: "Nur wenn zwei Kopien im selben Ordner liegen: der Name der Working Copy, in der Farbe des Ordners.",
              gone: "gone-Branches: lokale Branches, deren Upstream auf dem Server gelöscht ist. Dasselbe Zeichen steht summiert am Ordner.",
              goneUnsafe: "Rot: darunter sind Branches mit Arbeit, die sonst nirgends liegt.",
              ahead: "ahead: Commits des ausgecheckten Branches, die noch nicht gepusht sind.",
              behind: "behind: Commits auf dem Server, noch nicht gepullt. Pull oder Fast-forward holt sie.",
              dirty: "Geänderte Dateien im Ordner, noch nicht committet.",
              stash: "Stashes des Repos, für alle Worktrees zusammen.",
              foreign: "Ein Worktree dieses Repos liegt außerhalb der Ordner der Sidebar.",
              note: "Eine Notiz zum Repo; der Tooltip zeigt sie.",
              more: "Weitere Zeichen, die nicht mehr in die Zeile passen; der Tooltip nennt sie.",
              locked: "Das ganze Repo ist gesperrt: keiner seiner Branches wird gelöscht.",
              onlineExcluded: "Von der Online-Prüfung ausgenommen.",
              problem: "Ein Problem beim Scan oder Fetch; der Tooltip sagt, welches.",
            },
          },
        },
        {
          id: "worktree",
          title: "Worktree-Zeilen",
          body: ["Unter einer Karte steht je Worktree eine Zeile. Drei Formen für drei Dinge."],
          legend: {
            visual: "worktree",
            items: {
              worktree: "Der Worktree, ein zweiter Ordner desselben Repos.",
              detached: "Detached HEAD: der Worktree steht auf keinem Branch, sondern auf einem Commit.",
              stranded: "Commits, die auf keinem Branch liegen. Leg einen Branch an, bevor du wechselst.",
            },
          },
        },
        {
          id: "table",
          title: "Tabelle",
          body: ["Kleine Zeichen in der Spalte Branch und rechts daneben sagen, was an einem Branch hängt."],
          legend: {
            visual: "table",
            items: {
              unpushed: "Ungepushte Commits ohne Nachweis; ein Klick zeigt sie.",
              dirty: "Uncommitted changes im Worktree des Branches.",
              checkedOut: "In einem Worktree ausgecheckt, dort sauber.",
              stashes: "Stashes auf diesem Branch.",
              locked: "Gesperrt: wird nie gelöscht.",
              ignored: "Für Hinweise ignoriert; bleibt in der Liste.",
              note: "Eigene Notiz zum Branch.",
              gone: "Upstream auf dem Server gelöscht, der Ref steht im Tooltip. Die lokale Kopie ist der letzte Stand.",
              copies: "Online: so viele Working Copies haben den Branch lokal.",
            },
          },
          show: { perspective: "Cleanup", scope: "Local" },
        },
        {
          id: "topbar",
          title: "Aktualisieren",
          body: ["Oben in der Gruppe „Daten“, rechts neben den Verbindungen. Der Knopf, der gerade läuft, dreht sein Symbol."],
          legend: {
            visual: "topbar",
            items: {
              refresh: "Aktualisieren (F5): Fetch in allen Repos, dann neu bewerten.",
              local: "Ohne Server neu bewerten (Shift F5): schnell, auf dem Stand des letzten Fetch.",
            },
          },
        },
      ],
    },
    { id: "keys", title: "Tastenkürzel", summary: "Alle Kürzel auf einen Blick.", sections: [] },
    { id: "errors", title: "Fehlermeldungen", summary: "Was eine Meldung bedeutet und was du tun kannst.", sections: [] },
  ],
};
