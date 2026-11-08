/**
 * @file Anniversary Events Sync Script - V2.0 (Dynamic Age Update)
 * @author github.com/JohnDOEbug
 * @author kobelka // Added features and configuration
 * @author se-basti-an // Sync robustness fixes
 * @version 1.7.1 // Fehlerbehebungen: Löschen ganzer Serien, Duplikate, Zeitzone, 29. Februar
 * @description
 * Synchronisiert Geburtstage und berechnet das Alter für das AKTUELLE Jahr dynamisch.
 * Aktualisiert bestehende Serientermine, wenn das Alter/Jahr in der Beschreibung veraltet ist.
 *
 * @description
 * This script synchronizes birthdays and special events from Google
 * Contacts with a selected Google Calendar.
 * It retrieves contact information (name, events with birth year if available,
 * resource ID) and checks it against existing calendar entries (identified by
 * finding 'people/c...' anywhere in the description).
 * Entries are added, updated, or removed as needed. Each newly created calendar
 * entry is a yearly recurring event series.
 * Crucially, the script dynamically calculates the age for the current year.
 * It checks existing recurring events and automatically updates their descriptions
 * if the year or calculated age is outdated.
 * The description includes the contact ID, optionally the birth year, and
 * optionally the current age (e.g., 'In [Current Year] [Name] turns [Age]').
 * Birthday titles include a configurable prefix. Texts for descriptions and title
 * prefixes are configurable via constants at the top for easy translation.
 * Optionally, sends email notifications for created, updated, and deleted events.
 *
 * Changes in 1.7.1:
 * - Deleting removes the whole event series. Before, getEventById() returned
 *   only the first occurrence and deleteEvent() removed only that one, so all
 *   later years stayed in the calendar.
 * - An error while reading contacts or calendar events aborts the run. Before,
 *   the run continued with incomplete data and deleted or duplicated events.
 * - Exactly one birthday per contact (the contact's own entry is preferred over
 *   e.g. the person's Google profile) and the primary name instead of names[0].
 * - Duplicate series for the same contact event are detected and removed. The
 *   search window covers the current and the next year.
 * - All-day dates are read with getAllDayStartDate() (script time zone).
 * - Feb 29: series on day 60 of the year -> Feb 29 in leap years, Mar 1 otherwise.
 * - DRY_RUN: log planned actions without changing the calendar.
 * - Log output shows numbers without ".0" (e.g. "Jahr: 2026" instead of "2026.0").
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
const REPORT_RECIPIENT_EMAIL = ''; // <<< SET YOUR EMAIL HERE (or '' for no report)
const DRY_RUN = false; // true: only log planned actions, the calendar is not changed

// --- Language Configuration ---
const BIRTHDAY_TITLE_PREFIX = 'Geburtstag';
const DESC_CONTACT_ID_PREFIX = "Kontakt-ID: ";
const DESC_BORN_PREFIX = "\nGeboren: ";
const DESC_AGE_TEMPLATE_START = "\nIn ";
const DESC_AGE_TEMPLATE_MIDDLE = " wird ";
const DESC_AGE_TEMPLATE_END = " Jahre alt.";

// --- Main Function ---

/**
 * Hauptfunktion zur Synchronisierung von Jahrestagen.
 */
function anniversaryEvents() {
  var calendarId = TARGET_CALENDAR_ID;
  var recipientEmail = REPORT_RECIPIENT_EMAIL;
  var currentYear = new Date().getFullYear();

  // Numbers are passed as strings: Logger.log() formats numbers as "2026.0".
  Logger.log("Skriptlauf gestartet. Kalender-ID: %s, Jahr: %s%s", calendarId, String(currentYear), DRY_RUN ? " (DRY RUN)" : "");

  // 1. Ereignisse aus Google Kontakten abrufen
  var contactEvents = getAllContactsEvents();
  Logger.log("Kontaktereignisse gefunden: %s", String(contactEvents.length));

  // 2. Bestehende Ereignisse aus Google Kalender abrufen
  var calendarEvents = getAllCalendarEvents(calendarId, currentYear);
  Logger.log("Kalender-Serien (mit Kontakt-ID) gefunden: %s", String(calendarEvents.length));

  // 3. Vergleichen und Aktionen bestimmen (CREATE, UPDATE, DELETE)
  var syncActions = compareAndSyncEvents(contactEvents, calendarEvents, currentYear);
  Logger.log("Sync-Aktionen erforderlich: %s", String(syncActions.length));

  // 4. Sync-Aktionen ausführen
  var createdEventsLog = [];
  var deletedEventsLog = [];
  var updatedEventsLog = [];

  syncActions.forEach(actionObj => {
    if (DRY_RUN) {
      Logger.log("[DRY RUN] %s", describeAction(actionObj));
      return;
    }

    if (actionObj.action === 'DELETE') {
      var deletedEventTitle = deleteCalendarEvent(calendarId, actionObj.eventId);
      if (deletedEventTitle) {
        deletedEventsLog.push(deletedEventTitle);
        Logger.log("Aktion: Lösche Serie '%s' (%s)", deletedEventTitle, actionObj.reason);
      }
    } else if (actionObj.action === 'CREATE') {
      var createdEventTitle = createCalendarEvent(calendarId, actionObj.data);
      if (createdEventTitle) {
        createdEventsLog.push(createdEventTitle);
        Logger.log("Aktion: Erstelle Event '%s'", createdEventTitle);
      }
    } else if (actionObj.action === 'UPDATE') {
      var updatedEventTitle = updateCalendarEvent(actionObj.eventObject, actionObj.newDescription);
      if (updatedEventTitle) {
        updatedEventsLog.push(updatedEventTitle);
        Logger.log("Aktion: Aktualisiere Alter/Jahr in Event '%s'", updatedEventTitle);
      }
    }
  });

  // 5. Bericht per E-Mail senden
  if ((createdEventsLog.length > 0 || deletedEventsLog.length > 0 || updatedEventsLog.length > 0) && recipientEmail) {
    createdEventsLog.sort();
    deletedEventsLog.sort();
    updatedEventsLog.sort();
    var reportSubject = 'Anniversaries Google Calendar Report - ' + new Date().toLocaleDateString();
    var reportBody = 'Anniversary Sync Report:\n\n';

    reportBody += '--- Neu Erstellte Ereignisse ---\n';
    reportBody += createdEventsLog.length > 0 ? createdEventsLog.join('\n') : '(Keine)';

    reportBody += '\n\n--- Aktualisierte Ereignisse (Alter angepasst) ---\n';
    reportBody += updatedEventsLog.length > 0 ? updatedEventsLog.join('\n') : '(Keine)';

    reportBody += '\n\n--- Gelöschte Ereignisse ---\n';
    reportBody += deletedEventsLog.length > 0 ? deletedEventsLog.join('\n') : '(Keine)';

    try {
      MailApp.sendEmail(recipientEmail, reportSubject, reportBody);
    } catch (e) {
      Logger.log("Fehler beim Senden des Berichts: %s", e);
    }
  }
  Logger.log("Skriptlauf beendet.");
}


// --- Helper Functions ---

function getAllContactsEvents() {
  var contactsEvents = [];
  var seenKeys = {};
  var pageToken;
  var pageSize = 100;
  var currentYear = new Date().getFullYear();

  // Identical entries (same contact, title and date) are added only once.
  function addEvent(contactEvent) {
    var key = contactEvent.contactId + "::" + contactEvent.title + "::" +
              (contactEvent.leapDay ? "2-29" : (contactEvent.date.getMonth() + 1) + "-" + contactEvent.date.getDate());
    if (seenKeys[key]) return;
    seenKeys[key] = true;
    contactsEvents.push(contactEvent);
  }

  do {
    var response;
    try {
      response = People.People.Connections.list('people/me', {
        personFields: "names,birthdays,events",
        pageSize: pageSize,
        pageToken: pageToken
      });
    } catch (error) {
      // Abort the run: with an incomplete contact list, the events of all
      // missing contacts would be treated as obsolete and deleted.
      throw new Error("Fehler beim Abrufen der Kontakte: " + error);
    }

    var connections = response.connections;
    if (connections) {
      connections.forEach(function(contact) {
        // The order of names is not guaranteed; use the primary one.
        var nameEntry = pickPrimary(contact.names);
        var name = nameEntry && nameEntry.displayName ? nameEntry.displayName : "Unknown Name";

        // --- GEBURTSTAGE VERARBEITEN ---
        // A contact can carry several birthdays from different sources (the
        // contact itself, the person's Google profile, ...). Use exactly one.
        var birthday = pickBirthday(contact.birthdays);
        if (birthday) {
          var birthYear = birthday.date.year;
          var birthdayTitle = (BIRTHDAY_TITLE_PREFIX ? BIRTHDAY_TITLE_PREFIX + " " : "") + name;

          // Beschreibung für das AKTUELLE Jahr vorausberechnen
          var expectedDescription = DESC_CONTACT_ID_PREFIX + contact.resourceName;
          if (birthYear) {
            expectedDescription += DESC_BORN_PREFIX + birthYear;
            var ageTurning = currentYear - birthYear;
            expectedDescription += DESC_AGE_TEMPLATE_START + currentYear +
                                   DESC_AGE_TEMPLATE_MIDDLE + name + " " + ageTurning +
                                   DESC_AGE_TEMPLATE_END;
          }

          addEvent({
            title: birthdayTitle,
            name: name,
            date: toEventDate(birthday.date, currentYear),
            leapDay: isLeapDay(birthday.date),
            contactId: contact.resourceName,
            birthYear: birthYear || null,
            expectedDescription: expectedDescription
          });
        }

        // --- ANDERE EREIGNISSE VERARBEITEN ---
        if (contact.events) {
          contact.events.forEach(function(event) {
            if (event.date && event.formattedType && event.date.month && event.date.day) {
              var expectedDescription = DESC_CONTACT_ID_PREFIX + contact.resourceName;

              addEvent({
                title: event.formattedType + ": " + name,
                name: name,
                date: toEventDate(event.date, currentYear),
                leapDay: isLeapDay(event.date),
                contactId: contact.resourceName,
                birthYear: null,
                expectedDescription: expectedDescription
              });
            }
          });
        }
      });
    }
    pageToken = response.nextPageToken;
  } while (pageToken);
  return contactsEvents;
}

/**
 * Returns the entry flagged as primary by the People API, otherwise the first.
 */
function pickPrimary(entries) {
  if (!entries || entries.length === 0) return null;
  return entries.find(entry => entry.metadata && entry.metadata.primary) || entries[0];
}

/**
 * Returns one birthday with day and month: the contact's own entry if present,
 * otherwise the primary one.
 */
function pickBirthday(birthdays) {
  var withDate = (birthdays || []).filter(b => b.date && b.date.month && b.date.day);
  if (withDate.length === 0) return null;
  return withDate.find(b => b.metadata && b.metadata.source && b.metadata.source.type === 'CONTACT') ||
         pickPrimary(withDate);
}

function isLeapDay(peopleDate) {
  return peopleDate.month === 2 && peopleDate.day === 29;
}

/**
 * People API date -> date in the current year. Feb 29 gets the leap year 2000,
 * otherwise JavaScript would roll it over to Mar 1 in non-leap years.
 */
function toEventDate(peopleDate, currentYear) {
  if (isLeapDay(peopleDate)) return new Date(2000, 1, 29);
  return new Date(currentYear, peopleDate.month - 1, peopleDate.day);
}


function getAllCalendarEvents(calendarId, year) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    throw new Error("Kalender nicht gefunden: " + calendarId);
  }

  // Current and next year: series whose current-year occurrence is missing
  // (e.g. leftovers of an incomplete deletion) are found as well.
  var startDate = new Date(year, 0, 1);
  var endDate = new Date(year + 2, 0, 1);
  const peopleIdPattern = /(people\/c\d+)/;

  // No try/catch: with an empty list every contact event would be created again.
  var events = calendar.getEvents(startDate, endDate);

  // A recurring event is returned once per occurrence; keep the earliest
  // occurrence of each series.
  var seriesById = new Map();
  events.forEach(event => {
    var description = event.getDescription();
    var match = description ? description.match(peopleIdPattern) : null;
    if (!match || !match[1]) return;

    // For all-day events getStartTime() returns midnight in the calendar's
    // time zone, getAllDayStartDate() in the script's time zone, which is
    // the one used for all comparisons.
    var date = event.isAllDayEvent() ? event.getAllDayStartDate() : event.getStartTime();
    var id = event.getId();
    var known = seriesById.get(id);
    if (known && known.date <= date) return;

    seriesById.set(id, {
      eventObject: event, // NEU: Das Event-Objekt direkt speichern für spätere Updates
      contactId: match[1],
      title: event.getTitle(),
      date: date,
      eventId: id,
      description: description // NEU: Die aktuelle Beschreibung speichern
    });
  });

  return Array.from(seriesById.values()).sort((a, b) => a.date - b.date);
}


function compareAndSyncEvents(contactEvents, calendarEvents, currentYear) {
  const syncActions = [];
  const calendarEventMap = new Map();
  const claimedSeries = new Set();

  function isLeapYear(year) {
    return new Date(year, 1, 29).getMonth() === 1;
  }

  // Feb 29 events match Feb 29, and Mar 1 in non-leap years.
  function matchesDate(contactEvent, calDate) {
    const d = new Date(calDate);
    if (contactEvent.leapDay) {
      return (d.getMonth() === 1 && d.getDate() === 29) ||
             (d.getMonth() === 2 && d.getDate() === 1 && !isLeapYear(d.getFullYear()));
    }
    return d.getMonth() === contactEvent.date.getMonth() && d.getDate() === contactEvent.date.getDate();
  }

  // Kalender-Serien in Map sortieren (frühestes Vorkommen zuerst)
  calendarEvents.forEach(calEvent => {
    const key = calEvent.contactId + "::" + calEvent.title;
    if (!calendarEventMap.has(key)) { calendarEventMap.set(key, []); }
    calendarEventMap.get(key).push(calEvent);
  });

  // Kontakte mit Kalender vergleichen (CREATE und UPDATE).
  // Each contact event claims exactly one matching series.
  contactEvents.forEach(contactEvent => {
    const key = contactEvent.contactId + "::" + contactEvent.title;
    const potentialMatches = calendarEventMap.get(key) || [];
    const foundMatch = potentialMatches.find(calEvent =>
      !claimedSeries.has(calEvent.eventId) && matchesDate(contactEvent, calEvent.date));

    if (!foundMatch) {
      // Existiert nicht -> Erstellen
      syncActions.push({ action: 'CREATE', data: contactEvent, title: contactEvent.title });
      return;
    }

    claimedSeries.add(foundMatch.eventId);

    // Existiert -> Prüfen ob die Beschreibung (das Alter/Jahr) veraltet ist.
    // Only the current-year occurrence is updated.
    if (foundMatch.date.getFullYear() === currentYear &&
        foundMatch.description !== contactEvent.expectedDescription) {
      syncActions.push({
        action: 'UPDATE',
        eventObject: foundMatch.eventObject,
        newDescription: contactEvent.expectedDescription,
        title: foundMatch.title
      });
    }
  });

  // Kalender mit Kontakten vergleichen (DELETE): every series that was not
  // claimed is obsolete or a duplicate of a claimed one.
  calendarEvents.forEach(calendarEvent => {
    if (claimedSeries.has(calendarEvent.eventId)) return;

    const isDuplicate = contactEvents.some(contactEvent =>
      contactEvent.contactId === calendarEvent.contactId &&
      contactEvent.title === calendarEvent.title &&
      matchesDate(contactEvent, calendarEvent.date));

    syncActions.push({
      action: 'DELETE',
      eventId: calendarEvent.eventId,
      title: calendarEvent.title,
      date: calendarEvent.date,
      reason: isDuplicate ? 'duplicate' : 'obsolete'
    });
  });

  return syncActions;
}


/**
 * One log line per sync action (used for DRY_RUN).
 */
function describeAction(actionObj) {
  if (actionObj.action === 'DELETE') {
    return "DELETE (" + actionObj.reason + ", gefunden am " +
           Utilities.formatDate(actionObj.date, Session.getScriptTimeZone(), "yyyy-MM-dd") + "): " + actionObj.title;
  }
  return actionObj.action + ": " + actionObj.title;
}


function createCalendarEvent(calendarId, event) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return null;

  var currentYear = new Date().getFullYear();
  var startDate = new Date(currentYear, event.date.getMonth(), event.date.getDate());
  var recurrence = CalendarApp.newRecurrence().addYearlyRule();

  if (event.leapDay) {
    // Day 60 of the year = Feb 29 in leap years, Mar 1 otherwise.
    startDate = new Date(currentYear, 0, 60);
    recurrence = recurrence.onlyOnYearDay(60);
  }

  // Die Vorausberechnete Beschreibung nutzen
  var descriptionText = event.expectedDescription;

  try {
    var series = calendar.createAllDayEventSeries(
      event.title, startDate, recurrence, { description: descriptionText }
    );
    series.setTransparency(CalendarApp.EventTransparency.TRANSPARENT);
    return event.title;
  } catch (e) {
    Logger.log("Fehler beim Erstellen des Events: " + e);
    return null;
  }
}

// NEUE FUNKTION: Aktualisiert nur die Beschreibung (das Alter) eines bestehenden Termins
function updateCalendarEvent(eventObject, newDescription) {
  try {
    eventObject.setDescription(newDescription);
    return eventObject.getTitle();
  } catch (e) {
    Logger.log("Fehler beim Aktualisieren der Event-Beschreibung: " + e);
    return null;
  }
}


/**
 * Deletes the whole event series. getEventById() returns only the first
 * occurrence of a series and deleteEvent() removes only that occurrence,
 * so all later years would remain in the calendar.
 */
function deleteCalendarEvent(calendarId, eventId) {
   var calendar = CalendarApp.getCalendarById(calendarId);
   if (!calendar) return null;

   try {
     var seriesToDelete = calendar.getEventSeriesById(eventId);
     if (seriesToDelete) {
       var title = seriesToDelete.getTitle();
       seriesToDelete.deleteEventSeries();
       return title;
     }
   } catch (e) {
     Logger.log("Fehler beim Löschen des Events: " + e);
   }
   return null;
}
