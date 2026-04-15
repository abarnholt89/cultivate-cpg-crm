// ─── Configuration ──────────────────────────────────────────────────────────

var CONFIG = {
  BASE_URL: "https://cultivate-cpg-crm.vercel.app",
};

// ─── Entry Points ────────────────────────────────────────────────────────────

/**
 * Called when a Gmail message is opened (contextual trigger).
 */
function buildContextualCard(e) {
  try {
    var messageId = e.gmail.messageId;
    var accessToken = e.gmail.accessToken;

    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);

    var from = message.getFrom();
    var subject = message.getSubject();
    var threadId = message.getThread().getId();

    var options = fetchOptions_();
    if (options.error) {
      return buildErrorCard_("Failed to load options: " + options.error);
    }

    var senderDomain = extractDomain_(from);
    var detectedRetailerId = detectRetailerByDomain_(senderDomain, options.retailers);

    return buildActivityCard_(
      from,
      subject,
      messageId,
      threadId,
      options.retailers,
      options.brands,
      options.activityTypes,
      detectedRetailerId
    );
  } catch (err) {
    return buildErrorCard_("Error loading sidebar: " + err.message);
  }
}

/**
 * Shown when no email is open (homepage / universal action).
 */
function buildHomepageCard() {
  var card = CardService.newCardBuilder();
  card.setHeader(
    CardService.newCardHeader()
      .setTitle("Cultivate CPG CRM")
      .setSubtitle("Open an email to log a CRM activity")
  );

  var section = CardService.newCardSection();
  section.addWidget(
    CardService.newTextParagraph().setText(
      "Select an email in your inbox to log retailer activity."
    )
  );
  card.addSection(section);

  return card.build();
}

/**
 * Called from the compose trigger (when composing a new email).
 */
function buildComposeCard(e) {
  try {
    var options = fetchOptions_();
    if (options.error) {
      return buildErrorCard_("Failed to load options: " + options.error);
    }

    return buildActivityCard_(
      "",
      "",
      "",
      "",
      options.retailers,
      options.brands,
      options.activityTypes,
      null
    );
  } catch (err) {
    return buildErrorCard_("Error loading compose card: " + err.message);
  }
}

// ─── Card Builders ────────────────────────────────────────────────────────────

function buildActivityCard_(from, subject, messageId, threadId, retailers, brands, activityTypes, detectedRetailerId) {
  var card = CardService.newCardBuilder();

  card.setHeader(
    CardService.newCardHeader()
      .setTitle("Log CRM Activity")
      .setSubtitle("Cultivate CPG")
  );

  // ── Email context section ─────────────────────────────────────────────────
  if (from || subject) {
    var contextSection = CardService.newCardSection().setHeader("Email");
    if (from) {
      contextSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel("From")
          .setText(from)
      );
    }
    if (subject) {
      contextSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel("Subject")
          .setText(subject)
      );
    }
    card.addSection(contextSection);
  }

  // ── Activity form section ─────────────────────────────────────────────────
  var formSection = CardService.newCardSection().setHeader("Activity Details");

  // Retailer dropdown
  var retailerSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Retailer")
    .setFieldName("retailerId");

  retailers.forEach(function (r) {
    retailerSelect.addItem(
      r.name,
      String(r.id),
      String(r.id) === String(detectedRetailerId)
    );
  });
  formSection.addWidget(retailerSelect);

  // Brand checkboxes (multi-select)
  var brandSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .setTitle("Brand(s)")
    .setFieldName("brandIds");

  brands.forEach(function (b) {
    brandSelect.addItem(b.name, String(b.id), false);
  });
  formSection.addWidget(brandSelect);

  // Activity type dropdown
  var typeSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Activity Type")
    .setFieldName("activityTypeKey");

  activityTypes.forEach(function (t) {
    typeSelect.addItem(t.label, t.key, false);
  });
  formSection.addWidget(typeSelect);

  // Summary textarea
  formSection.addWidget(
    CardService.newTextInput()
      .setFieldName("summary")
      .setTitle("Summary")
      .setHint("Brief description of this activity...")
      .setMultiline(true)
  );

  // Submit button — passes email context as Action parameters
  var submitAction = CardService.newAction()
    .setFunctionName("onSubmitActivity")
    .setParameters({
      messageId: messageId || "",
      threadId: threadId || "",
      from: from || "",
      subject: subject || "",
    });

  formSection.addWidget(
    CardService.newTextButton()
      .setText("Log Activity")
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(submitAction)
  );

  card.addSection(formSection);

  return card.build();
}

function buildErrorCard_(message) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle("Error"));
  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(message));
  card.addSection(section);
  return card.build();
}

function buildSuccessCard_(retailerName) {
  var card = CardService.newCardBuilder();
  card.setHeader(
    CardService.newCardHeader()
      .setTitle("Activity Logged")
      .setSubtitle("Cultivate CPG CRM")
  );
  var section = CardService.newCardSection();
  section.addWidget(
    CardService.newTextParagraph().setText(
      "Activity successfully logged" +
        (retailerName ? " for " + retailerName : "") +
        "."
    )
  );
  card.addSection(section);
  return card.build();
}

// ─── Form Submit Handler ──────────────────────────────────────────────────────

/**
 * Called when the "Log Activity" button is pressed.
 * POSTs to /api/crm-activities/create.
 */
function onSubmitActivity(e) {
  try {
    var formInputs = e.commonEventObject.formInputs || {};
    var params = e.commonEventObject.parameters || {};

    // Log raw formInputs for debugging — view under Apps Script → Executions
    Logger.log("onSubmitActivity formInputs: " + JSON.stringify(formInputs));

    var retailerId = getSelectValue_(formInputs, "retailerId");
    var brandIds = getMultiSelectValues_(formInputs, "brandIds");
    var activityTypeKey = getSelectValue_(formInputs, "activityTypeKey");
    var summary = getTextValue_(formInputs, "summary");

    var messageId = params.messageId || "";
    var threadId = params.threadId || "";
    var senderEmail = params.from || "";
    var subject = params.subject || "";

    Logger.log("Parsed — retailerId: " + retailerId + ", brandIds: " + JSON.stringify(brandIds) + ", activityTypeKey: " + activityTypeKey);

    if (!retailerId || brandIds.length === 0 || !activityTypeKey) {
      var missing = [];
      if (!retailerId) missing.push("retailerId");
      if (brandIds.length === 0) missing.push("brandIds");
      if (!activityTypeKey) missing.push("activityTypeKey");
      Logger.log("Missing fields: " + missing.join(", "));
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification()
            .setText("Please fill in: " + missing.join(", "))
            .setType(CardService.NotificationType.WARNING)
        )
        .build();
    }

    var payload = {
      retailerId: retailerId,
      brandIds: brandIds,
      activityTypeKey: activityTypeKey,
      summary: summary || "",
      senderEmail: senderEmail,
      subject: subject,
      gmailMessageId: messageId,
      gmailThreadId: threadId,
      source: "gmail_addon",
    };

    Logger.log("POST payload: " + JSON.stringify(payload));

    var response = UrlFetchApp.fetch(CONFIG.BASE_URL + "/api/crm-activities/create", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();
    Logger.log("Response " + statusCode + ": " + responseText);

    if (statusCode < 200 || statusCode >= 300) {
      var errMsg = "Server error (" + statusCode + ")";
      try {
        var errJson = JSON.parse(responseText);
        if (errJson.error) errMsg = errJson.error;
      } catch (_) {}
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification()
            .setText("Error: " + errMsg)
            .setType(CardService.NotificationType.ERROR)
        )
        .build();
    }

    // Resolve retailer name for the success card
    var retailerName = "";
    try {
      var opts = fetchOptions_();
      var matched = (opts.retailers || []).filter(function (r) {
        return String(r.id) === String(retailerId);
      })[0];
      if (matched) retailerName = matched.name;
    } catch (_) {}

    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().pushCard(buildSuccessCard_(retailerName))
      )
      .build();
  } catch (err) {
    Logger.log("onSubmitActivity error: " + err.message + "\n" + err.stack);
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText("Unexpected error: " + err.message)
          .setType(CardService.NotificationType.ERROR)
      )
      .build();
  }
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

/**
 * Fetches retailers, brands, and activity types from the CRM API.
 */
function fetchOptions_() {
  try {
    var response = UrlFetchApp.fetch(CONFIG.BASE_URL + "/api/gmail-addon-options", {
      method: "get",
      muteHttpExceptions: true,
    });

    var statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      return { retailers: [], brands: [], activityTypes: [], error: "HTTP " + statusCode };
    }

    var data = JSON.parse(response.getContentText());
    return {
      retailers: data.retailers || [],
      brands: data.brands || [],
      activityTypes: data.activityTypes || [],
      error: null,
    };
  } catch (err) {
    return { retailers: [], brands: [], activityTypes: [], error: err.message };
  }
}

// ─── Domain Detection ─────────────────────────────────────────────────────────

/**
 * Extracts the domain keyword from an email "Name <email>" or bare address.
 * e.g. "john@kroger.com" → "kroger"
 */
function extractDomain_(fromHeader) {
  if (!fromHeader) return "";
  var emailMatch = fromHeader.match(/<([^>]+)>/);
  var email = emailMatch ? emailMatch[1] : fromHeader.trim();
  var atIndex = email.indexOf("@");
  if (atIndex === -1) return "";
  var domain = email.slice(atIndex + 1).toLowerCase();
  return domain.split(".")[0];
}

/**
 * Tries to match the sender's domain keyword against retailer names.
 * Returns the matched retailer ID, or null.
 */
function detectRetailerByDomain_(domainKeyword, retailers) {
  if (!domainKeyword || !retailers || retailers.length === 0) return null;
  var kw = domainKeyword.toLowerCase();
  for (var i = 0; i < retailers.length; i++) {
    var name = (retailers[i].name || "").toLowerCase();
    if (name.indexOf(kw) !== -1 || kw.indexOf(name.split(" ")[0]) !== -1) {
      return retailers[i].id;
    }
  }
  return null;
}

// ─── CardService Form Utilities ───────────────────────────────────────────────

/**
 * Extracts a single value from a formInputs field.
 * Tries multiple shapes Gmail may use depending on the trigger type:
 *   1. field.stringInputs.value[0]   — standard contextual shape
 *   2. field.listInputs.value[0]     — alternate compose trigger shape
 *   3. first inner.value[0] found    — fallback for any other shape
 */
function getSelectValue_(formInputs, fieldName) {
  try {
    var field = formInputs[fieldName];
    if (!field) return null;

    if (field.stringInputs && field.stringInputs.value && field.stringInputs.value.length > 0) {
      return field.stringInputs.value[0];
    }

    if (field.listInputs && field.listInputs.value && field.listInputs.value.length > 0) {
      return field.listInputs.value[0];
    }

    var keys = Object.keys(field);
    for (var i = 0; i < keys.length; i++) {
      var inner = field[keys[i]];
      if (inner && inner.value && inner.value.length > 0) {
        return inner.value[0];
      }
    }

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Extracts all selected values from a formInputs field (e.g. CHECK_BOX).
 * Tries the same shapes as getSelectValue_.
 */
function getMultiSelectValues_(formInputs, fieldName) {
  try {
    var field = formInputs[fieldName];
    if (!field) return [];

    if (field.stringInputs && field.stringInputs.value && field.stringInputs.value.length > 0) {
      return field.stringInputs.value;
    }

    if (field.listInputs && field.listInputs.value && field.listInputs.value.length > 0) {
      return field.listInputs.value;
    }

    var keys = Object.keys(field);
    for (var i = 0; i < keys.length; i++) {
      var inner = field[keys[i]];
      if (inner && inner.value && inner.value.length > 0) {
        return inner.value;
      }
    }

    return [];
  } catch (_) {
    return [];
  }
}

/**
 * Extracts a single text value from a formInputs field (e.g. TextInput).
 */
function getTextValue_(formInputs, fieldName) {
  try {
    var field = formInputs[fieldName];
    if (!field) return "";

    if (field.stringInputs && field.stringInputs.value && field.stringInputs.value.length > 0) {
      return field.stringInputs.value[0];
    }

    if (field.listInputs && field.listInputs.value && field.listInputs.value.length > 0) {
      return field.listInputs.value[0];
    }

    var keys = Object.keys(field);
    for (var i = 0; i < keys.length; i++) {
      var inner = field[keys[i]];
      if (inner && inner.value && inner.value.length > 0) {
        return inner.value[0];
      }
    }

    return "";
  } catch (_) {
    return "";
  }
}
