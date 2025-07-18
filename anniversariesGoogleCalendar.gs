/**
 * @file Anniversary Events Sync Script
 * @author github.com/JohnDOEbug 
 * @author kobelka // Added features and configuration
 * @version 1.6.0 // Versionsnummer angepasst
 * @description
 * This script synchronizes birthdays and special events from Google
 * Contacts with a selected Google Calendar.
 * It retrieves contact information (name, events with birth year if available,
 * resource ID) and checks it against existing calendar entries (identified by
 * finding 'people/c...' anywhere in the description). Entries are added or removed
 * as needed. Each newly created calendar entry is a yearly recurring event series.
 * The description includes 'Kontakt-ID: people/c...', optionally the birth year
 * ('Geboren: JJJJ'), and optionally the age ('In JJJJ wird Name X Jahre alt.').
 * Birthday titles include a configurable prefix. Texts for descriptions and title
 * prefix are configurable via constants at the top for easy translation.
 * Optionally, sends email notifications for created/deleted events.
 *
 * Usage:
 * - Create a Google Apps Script project (script.google.com).
 * - Copy this entire script into the editor (Code.gs).
 * - Set configuration constants below (Calendar ID, Email, Language Strings).
 * - Add Google People API v1 service.
 * - Run anniversaryEvents() manually once and grant permissions.
 * - Set up a time-driven trigger for anniversaryEvents.
 */

// --- Configuration ---
const TARGET_CALENDAR_ID = 'xxxxxxxxxxxxxxxxxxx@group.calendar.google.com'; // <<< SET YOUR CALENDAR ID HERE
const REPORT_RECIPIENT_EMAIL = '; // <<< SET YOUR EMAIL HERE (or '' for no report)

// --- Language Configuration ---
// Prefix/Postfix for birthday event titles (e.g., "Birthday"). Set to '' for no prefix or postfix.
const BIRTHDAY_TITLE_PREFIX = 'Geburtstag';
const BIRTHDAY_TITLE_POSTFIX = '';

// Label before the contact resource ID in the event description. IMPORTANT: Keep the space at the end.
const DESC_CONTACT_ID_PREFIX = "Kontakt-ID: ";

// Label before the birth year in the event description. IMPORTANT: Keep the \n (newline) and space.
const DESC_BORN_PREFIX = "\nGeboren: ";

// Template parts for the age line in the description (e.g., "In 2025 becomes John Doe 42 years old.")
// IMPORTANT: Keep the \n (newline) at the start of TEMPLATE_START. Keep spaces around TEMPLATE_MIDDLE. Keep space before TEMPLATE_END.
const DESC_AGE_TEMPLATE_START = "\nIn ";            // Text before the current year.
const DESC_AGE_TEMPLATE_MIDDLE = " wird ";          // Text between current year and name/age.
const DESC_AGE_TEMPLATE_END = " Jahre alt.";        // Text after the age number.

// --- Main Function ---

/**
 * Hauptfunktion zur Synchronisierung von Jahrestagen.
 */
function anniversaryEvents() {
  var calendarId = TARGET_CALENDAR_ID;
  var recipientEmail = REPORT_RECIPIENT_EMAIL;
  var currentYear = new Date().getFullYear();

  Logger.log("Skriptlauf gestartet. Kalender-ID: %s, Jahr: %s", calendarId, currentYear);
  Logger.log("Konfigurierter Geburtstagstitel-Präfix: '%s'", BIRTHDAY_TITLE_PREFIX);
  Logger.log("Konfigurierter Geburtstagstitel-Postfix: '%s'", BIRTHDAY_TITLE_POSTFIX);

  // 1. Ereignisse aus Google Kontakten abrufen
  var contactEvents = getAllContactsEvents();
  Logger.log("Kontaktereignisse gefunden: %s", contactEvents.length);

  // 2. Bestehende Ereignisse aus Google Kalender abrufen (sucht nach people/c... ID)
  var calendarEvents = getAllCalendarEvents(calendarId, currentYear);
  Logger.log("Kalenderereignisse (mit 'people/c...' ID) gefunden: %s", calendarEvents.length);

  // 3. Vergleichen und Aktionen bestimmen
  var syncActions = compareAndSyncEvents(contactEvents, calendarEvents);
  Logger.log("Sync-Aktionen erforderlich: %s", syncActions.length);
  if (syncActions.length > 0) {
      Logger.log("Sync-Aktionen Details: %s", JSON.stringify(syncActions, null, 2));
  } else {
      Logger.log("Keine Änderungen nötig, Kalender ist synchron.");
  }

  // 4. Sync-Aktionen ausführen (Erstellen/Löschen)
  var createdEventsLog = [];
  var deletedEventsLog = [];

  syncActions.forEach(action => {
    if (action.eventId) { // Löschen
      var deletedEventTitle = deleteCalendarEvent(calendarId, action.eventId);
      if (deletedEventTitle) {
        deletedEventsLog.push(deletedEventTitle);
        Logger.log("Aktion: Lösche Event '%s' (ID: %s)", deletedEventTitle, action.eventId);
      }
    } else { // Erstellen
      var createdEventTitle = createCalendarEvent(calendarId, action);
      if (createdEventTitle) {
        createdEventsLog.push(createdEventTitle);
        Logger.log("Aktion: Erstelle Event '%s'", createdEventTitle);
      }
    }
  });

  // 5. Bericht per E-Mail senden
  if ((createdEventsLog.length > 0 || deletedEventsLog.length > 0) && recipientEmail) {
    createdEventsLog.sort();
    deletedEventsLog.sort();
    var reportSubject = 'Anniversaries Google Calendar Report - ' + new Date().toLocaleDateString();
    var reportBody = 'Anniversary Sync Report:\n\n';
    reportBody += '--- Erstellte Ereignisse ---\n'; // Report text could also be constants if needed
    reportBody += createdEventsLog.length > 0 ? createdEventsLog.join('\n') : '(Keine)';
    reportBody += '\n\n--- Gelöschte Ereignisse ---\n'; // Report text could also be constants if needed
    reportBody += deletedEventsLog.length > 0 ? deletedEventsLog.join('\n') : '(Keine)';
    try {
      MailApp.sendEmail(recipientEmail, reportSubject, reportBody);
      Logger.log("Bericht gesendet an %s.", recipientEmail);
    } catch (e) {
      Logger.log("Fehler beim Senden des Berichts an %s: %s", recipientEmail, e);
    }
  } else {
      Logger.log("Kein Bericht gesendet (keine Änderungen oder keine E-Mail).");
  }
  Logger.log("Skriptlauf beendet.");
}


// --- Helper Functions ---

/**
 * Ruft alle jubiläumsbezogenen Ereignisse aus Google Contacts ab.
 * Speichert Namen, Geburtsjahr und verwendet Präfix für Geburtstagstitel.
 *
 * @returns {Array<Object>} Array von Kontaktereignis-Objekten mit name, title, date, contactId, birthYear.
 */
function getAllContactsEvents() {
  var contactsEvents = [];
  var pageToken;
  var pageSize = 100;
  var currentYear = new Date().getFullYear(); // Fallback-Jahr

  do {
    try {
      var response = People.People.Connections.list('people/me', {
        personFields: "names,birthdays,events",
        pageSize: pageSize,
        pageToken: pageToken
      });

      var connections = response.connections;
      if (connections) {
        connections.forEach(function(contact) {
          // Name extrahieren
          var name = contact.names && contact.names[0] ? contact.names[0].displayName : "Unknown Name";

          // --- GEBURTSTAGE VERARBEITEN ---
          if (contact.birthdays) {
            contact.birthdays.forEach(function(birthday) {
              if (birthday.date && birthday.date.month && birthday.date.day) {
                var birthYear = birthday.date.year;
                var eventYearForDate = birthYear || currentYear;
                var eventDate = new Date(eventYearForDate, birthday.date.month - 1, birthday.date.day);

                // Titel mit konfiguriertem Präfix erstellen
                var birthdayTitle = (BIRTHDAY_TITLE_PREFIX ? BIRTHDAY_TITLE_PREFIX + " " : "") + name;
                // Postfix ergänzen
                birthdayTitle = birthdayTitle + (BIRTHDAY_TITLE_POSTFIX ? " " + BIRTHDAY_TITLE_POSTFIX : "");

                // 'name' Feld hinzufügen
                contactsEvents.push({
                  title: birthdayTitle,
                  name: name, // Reinen Namen separat speichern
                  date: eventDate,
                  contactId: contact.resourceName,
                  birthYear: birthYear || null
                });
              }
            });
          }

          // --- ANDERE EREIGNISSE VERARBEITEN ---
          if (contact.events) {
            contact.events.forEach(function(event) {
              if (event.date && event.formattedType && event.date.month && event.date.day) {
                var eventYearForDate = event.date.year || currentYear;
                var eventDate = new Date(eventYearForDate, event.date.month - 1, event.date.day);

                // 'name' Feld hinzufügen
                contactsEvents.push({
                  title: event.formattedType + ": " + name,
                  name: name, // Reinen Namen separat speichern
                  date: eventDate,
                  contactId: contact.resourceName,
                  birthYear: null
                });
              }
            });
          }
        });
      }
      pageToken = response.nextPageToken;
    } catch (error) {
      Logger.log("Fehler beim Abrufen der Kontakte: " + error);
      break;
    }
  } while (pageToken);
  return contactsEvents;
}


/**
 * Ruft vorhandene relevante Ereignisse aus dem Google Kalender für ein bestimmtes Jahr ab.
 * Filtert Ereignisse, die eine 'people/c...' ID (altes oder neues Format) in der Beschreibung enthalten.
 *
 * @param {string} calendarId Die ID des Google Kalenders.
 * @param {number} year Das Jahr, für das Ereignisse abgerufen werden sollen.
 * @returns {Array<Object>} Array von Kalenderereignis-Objekten.
 */
function getAllCalendarEvents(calendarId, year) {
  Logger.log("Versuche Kalender abzurufen mit ID: %s", calendarId);
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    Logger.log("FEHLER: Kalender konnte nicht abgerufen werden. ID: %s.", calendarId);
    return [];
  }
  Logger.log("Kalender erfolgreich abgerufen: %s", calendar.getName());
  var startDate = new Date(year, 0, 1);
  var endDate = new Date(year + 1, 0, 1);

  // Sucht nach 'people/c...' ID irgendwo in der Beschreibung (für Abwärtskompatibilität)
  const peopleIdPattern = /(people\/c\d+)/;

  try {
    var events = calendar.getEvents(startDate, endDate);
    Logger.log("Kalenderereignisse im Zieljahr gefunden (gesamt): %s", events.length);

    var filteredEvents = events
      .map(event => {
          var description = event.getDescription();
          var match = description ? description.match(peopleIdPattern) : null;
          if (match && match[1]) {
             return { event: event, contactId: match[1] };
            }
          return null;
      })
      .filter(item => item !== null)
      .map(item => ({
          title: item.event.getTitle(), date: item.event.getStartTime(),
          contactId: item.contactId, eventId: item.event.getId()
      }));

    Logger.log("Gefilterte Kalenderereignisse (mit 'people/c...' ID): %s", filteredEvents.length);
    return filteredEvents;
  } catch (e) {
    Logger.log("Fehler beim Abrufen von Kalenderereignissen für ID %s: %s", calendarId, e);
    return [];
  }
}


/**
 * Vergleicht Kontaktereignisse und Kalenderereignisse, um Sync-Aktionen zu bestimmen.
 *
 * @param {Array<Object>} contactEvents Array von Ereignissen aus Kontakten.
 * @param {Array<Object>} calendarEvents Array von Ereignissen aus dem Kalender.
 * @returns {Array<Object>} Array von Sync-Aktionen.
 */
function compareAndSyncEvents(contactEvents, calendarEvents) {
  const syncActions = [];
  const calendarEventMap = new Map();
  function isSameDayAndMonth(date1, date2) {
    const d1 = new Date(date1); const d2 = new Date(date2);
    return d1.getDate() === d2.getDate() && d1.getMonth() === d2.getMonth();
  }
  calendarEvents.forEach(calEvent => {
    const key = calEvent.contactId + "::" + calEvent.title;
    if (!calendarEventMap.has(key)) { calendarEventMap.set(key, []); }
    calendarEventMap.get(key).push(calEvent);
  });
  contactEvents.forEach(contactEvent => {
    const key = contactEvent.contactId + "::" + contactEvent.title;
    const potentialMatches = calendarEventMap.get(key);
    let foundMatch = potentialMatches ? potentialMatches.some(calEvent => isSameDayAndMonth(calEvent.date, contactEvent.date)) : false;
    if (!foundMatch) { syncActions.push(contactEvent); }
  });
  const contactEventMap = new Map();
  contactEvents.forEach(contEvent => {
    const key = contEvent.contactId + "::" + contEvent.title;
    if (!contactEventMap.has(key)) { contactEventMap.set(key, []); }
    contactEventMap.get(key).push(contEvent);
  });
  calendarEvents.forEach(calendarEvent => {
    const key = calendarEvent.contactId + "::" + calendarEvent.title;
    const potentialMatches = contactEventMap.get(key);
    let foundMatch = potentialMatches ? potentialMatches.some(contEvent => isSameDayAndMonth(contEvent.date, calendarEvent.date)) : false;
    if (!foundMatch) { syncActions.push({ eventId: calendarEvent.eventId, title: calendarEvent.title }); }
  });
  return syncActions;
}


/**
 * Erstellt eine wiederkehrende Ganztagesereignis-Serie in Google Calendar.
 * Verwendet Konstanten für die Texte in der Beschreibung.
 *
 * @param {string} calendarId Die ID des Google Kalenders.
 * @param {Object} event Das Ereignis-Objekt.
 * @returns {string|null} Den Titel der erstellten Ereignisserie oder null bei Fehler.
 */
function createCalendarEvent(calendarId, event) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    Logger.log("FEHLER in createCalendarEvent: Kalender nicht gefunden/zugreifbar. ID: %s", calendarId);
    return null;
  }
  var title = event.title; var name = event.name; var contactId = event.contactId;
  var birthYear = event.birthYear; var eventDate = event.date;
  var currentYear = new Date().getFullYear();
  var startDate = new Date(currentYear, eventDate.getMonth(), eventDate.getDate());

  // --- Beschreibung mit Konstanten zusammenbauen ---
  var descriptionText = DESC_CONTACT_ID_PREFIX + contactId; // Benutzt Konstante

  if (birthYear) {
    descriptionText += DESC_BORN_PREFIX + birthYear; // Benutzt Konstante

    var ageTurning = currentYear - birthYear;
    // Benutzt Konstanten für die Alterszeile
    descriptionText += DESC_AGE_TEMPLATE_START + currentYear +
                       DESC_AGE_TEMPLATE_MIDDLE + name + " " + ageTurning +
                       DESC_AGE_TEMPLATE_END;
  }
  // --- Ende Beschreibung ---

  try {
    var series = calendar.createAllDayEventSeries(
      title, startDate, CalendarApp.newRecurrence().addYearlyRule(), { description: descriptionText }
    );
    series.setTransparency(CalendarApp.EventTransparency.TRANSPARENT);
    return title;
  } catch (e) {
    Logger.log("Fehler beim Erstellen des Kalender-Serienereignisses für '%s': %s", title, e);
    return null;
  }
}


/**
 * Löscht ein Ereignis aus Google Calendar anhand seiner ID.
 *
 * @param {string} calendarId Die ID des Google Kalenders.
 * @param {string} eventId Die ID des zu löschenden Ereignisses.
 * @returns {string|null} Den Titel des gelöschten Ereignisses oder null bei Fehler/Nicht gefunden.
 */
function deleteCalendarEvent(calendarId, eventId) {
   var calendar = CalendarApp.getCalendarById(calendarId);
   if (!calendar) {
      Logger.log("FEHLER in deleteCalendarEvent: Kalender nicht gefunden/zugreifbar. ID: %s", calendarId);
      return null;
   }
   var eventToDelete = null;
   try { eventToDelete = calendar.getEventById(eventId); }
   catch (e) { Logger.log("Fehler beim Abrufen des zu löschenden Events (ID: %s): %s", eventId, e); return null; }
   if (eventToDelete) {
     var title = eventToDelete.getTitle();
     try { eventToDelete.deleteEvent(); return title; }
     catch (e) { Logger.log("Fehler beim Löschen des Events '%s' (ID: %s): %s", title, eventId, e); return null; }
   } else { Logger.log('Zu löschendes Event nicht gefunden: ID: %s', eventId); return null; }
}

// --- Ende des Skripts --- 
