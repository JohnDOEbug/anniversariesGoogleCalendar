/**
 * @file Anniversary Events Sync Script - V2.0 (Dynamic Age Update)
 * @author github.com/JohnDOEbug 
 * @author kobelka // Added features and configuration
 * @version 1.7.0 // Update-Funktion für dynamisches Alter hinzugefügt
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

  Logger.log("Skriptlauf gestartet. Kalender-ID: %s, Jahr: %s", calendarId, currentYear);

  // 1. Ereignisse aus Google Kontakten abrufen
  var contactEvents = getAllContactsEvents();
  Logger.log("Kontaktereignisse gefunden: %s", contactEvents.length);

  // 2. Bestehende Ereignisse aus Google Kalender abrufen
  var calendarEvents = getAllCalendarEvents(calendarId, currentYear);
  Logger.log("Kalenderereignisse (mit Kontakt-ID) gefunden: %s", calendarEvents.length);

  // 3. Vergleichen und Aktionen bestimmen (CREATE, UPDATE, DELETE)
  var syncActions = compareAndSyncEvents(contactEvents, calendarEvents);
  Logger.log("Sync-Aktionen erforderlich: %s", syncActions.length);

  // 4. Sync-Aktionen ausführen
  var createdEventsLog = [];
  var deletedEventsLog = [];
  var updatedEventsLog = [];

  syncActions.forEach(actionObj => {
    if (actionObj.action === 'DELETE') {
      var deletedEventTitle = deleteCalendarEvent(calendarId, actionObj.eventId);
      if (deletedEventTitle) {
        deletedEventsLog.push(deletedEventTitle);
        Logger.log("Aktion: Lösche Event '%s'", deletedEventTitle);
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
  var pageToken;
  var pageSize = 100;
  var currentYear = new Date().getFullYear();

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
          var name = contact.names && contact.names[0] ? contact.names[0].displayName : "Unknown Name";

          // --- GEBURTSTAGE VERARBEITEN ---
          if (contact.birthdays) {
            contact.birthdays.forEach(function(birthday) {
              if (birthday.date && birthday.date.month && birthday.date.day) {
                var birthYear = birthday.date.year;
                var eventDate = new Date(currentYear, birthday.date.month - 1, birthday.date.day);
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

                contactsEvents.push({
                  title: birthdayTitle,
                  name: name,
                  date: eventDate,
                  contactId: contact.resourceName,
                  birthYear: birthYear || null,
                  expectedDescription: expectedDescription // NEU: Vorgefertigte Beschreibung speichern
                });
              }
            });
          }

          // --- ANDERE EREIGNISSE VERARBEITEN ---
          if (contact.events) {
            contact.events.forEach(function(event) {
              if (event.date && event.formattedType && event.date.month && event.date.day) {
                var eventDate = new Date(currentYear, event.date.month - 1, event.date.day);
                var expectedDescription = DESC_CONTACT_ID_PREFIX + contact.resourceName;

                contactsEvents.push({
                  title: event.formattedType + ": " + name,
                  name: name,
                  date: eventDate,
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
    } catch (error) {
      Logger.log("Fehler beim Abrufen der Kontakte: " + error);
      break;
    }
  } while (pageToken);
  return contactsEvents;
}


function getAllCalendarEvents(calendarId, year) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return [];
  
  var startDate = new Date(year, 0, 1);
  var endDate = new Date(year + 1, 0, 1);
  const peopleIdPattern = /(people\/c\d+)/;

  try {
    var events = calendar.getEvents(startDate, endDate);
    return events
      .map(event => {
          var description = event.getDescription();
          var match = description ? description.match(peopleIdPattern) : null;
          if (match && match[1]) {
             return { 
                 eventObject: event, // NEU: Das Event-Objekt direkt speichern für spätere Updates
                 contactId: match[1],
                 title: event.getTitle(), 
                 date: event.getStartTime(),
                 eventId: event.getId(),
                 description: description // NEU: Die aktuelle Beschreibung speichern
             };
          }
          return null;
      })
      .filter(item => item !== null);
  } catch (e) {
    Logger.log("Fehler beim Abrufen von Kalenderereignissen: " + e);
    return [];
  }
}


function compareAndSyncEvents(contactEvents, calendarEvents) {
  const syncActions = [];
  const calendarEventMap = new Map();
  
  function isSameDayAndMonth(date1, date2) {
    const d1 = new Date(date1); const d2 = new Date(date2);
    return d1.getDate() === d2.getDate() && d1.getMonth() === d2.getMonth();
  }

  // Kalender-Events in Map sortieren
  calendarEvents.forEach(calEvent => {
    const key = calEvent.contactId + "::" + calEvent.title;
    if (!calendarEventMap.has(key)) { calendarEventMap.set(key, []); }
    calendarEventMap.get(key).push(calEvent);
  });

  // Kontakte mit Kalender vergleichen (CREATE und UPDATE)
  contactEvents.forEach(contactEvent => {
    const key = contactEvent.contactId + "::" + contactEvent.title;
    const potentialMatches = calendarEventMap.get(key);
    let foundMatch = potentialMatches ? potentialMatches.find(calEvent => isSameDayAndMonth(calEvent.date, contactEvent.date)) : null;
    
    if (!foundMatch) {
      // Existiert nicht -> Erstellen
      syncActions.push({ action: 'CREATE', data: contactEvent });
    } else {
      // Existiert -> Prüfen ob die Beschreibung (das Alter/Jahr) veraltet ist
      if (foundMatch.description !== contactEvent.expectedDescription) {
        syncActions.push({ 
          action: 'UPDATE', 
          eventObject: foundMatch.eventObject, 
          newDescription: contactEvent.expectedDescription,
          title: foundMatch.title 
        });
      }
    }
  });

  // Kalender mit Kontakten vergleichen (DELETE)
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
    
    if (!foundMatch) {
      syncActions.push({ action: 'DELETE', eventId: calendarEvent.eventId, title: calendarEvent.title });
    }
  });

  return syncActions;
}


function createCalendarEvent(calendarId, event) {
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) return null;
  
  var currentYear = new Date().getFullYear();
  var startDate = new Date(currentYear, event.date.getMonth(), event.date.getDate());
  
  // Die Vorausberechnete Beschreibung nutzen
  var descriptionText = event.expectedDescription; 

  try {
    var series = calendar.createAllDayEventSeries(
      event.title, startDate, CalendarApp.newRecurrence().addYearlyRule(), { description: descriptionText }
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


function deleteCalendarEvent(calendarId, eventId) {
   var calendar = CalendarApp.getCalendarById(calendarId);
   if (!calendar) return null;
   
   try { 
     var eventToDelete = calendar.getEventById(eventId); 
     if (eventToDelete) {
       var title = eventToDelete.getTitle();
       eventToDelete.deleteEvent(); 
       return title; 
     }
   } catch (e) { 
     Logger.log("Fehler beim Löschen des Events: " + e); 
   }
   return null;
}
