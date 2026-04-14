// ─── Configuration ──────────────────────────────────────────────────────────
// Update BASE_URL to your deployed Next.js app URL (e.g. https://your-app.vercel.app)
var CONFIG = {
  BASE_URL: "https://your-app.vercel.app",
  ADDON_API_KEY: "", // Optional: set a shared secret and validate it server-side
};

// ─── Entry Points ────────────────────────────────────────────────────────────

/**
 * Called when a Gmail message is opened. Builds the contextual card.
 */
function buildContextualCard(e) {
  try {
    var messageId = e.gmail.messageId;
    var accessToken = e.gmail.accessToken;

    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);

    var from = message.getFrom();       // e.g. "John Smith <john@kroger.com>"
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
      .setImageStyle(CardService.ImageStyle.CIRCLE)
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

// ─── Card Builder ────────────────────────────────────────────────────────────

function buildActivityCard_(from, subject, messageId, threadId, retailers, brands, activityTypes, detectedRetailerId) {
  var card = CardService.newCardBuilder();

  card.setHeader(
    CardService.newCardHeader()
      .setTitle("Log CRM Activity")
      .setSubtitle("Cultivate CPG")
  );

  // ── Email context section ─────────────────────────────────────────────────
  var contextSection = CardService.newCardSection().setHeader("Email");
  contextSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel("From")
      .setText(from || "(unknown)")
  );
  contextSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel("Subject")
      .setText(subject || "(no subject)")
  );
  card.addSection(contextSection);

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

  // Brand dropdown
  var brandSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Brand")
    .setFieldName("brandId");

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

  // Hidden fields passed through form parameters via Action parameters
  var submitAction = CardService.newAction()
    .setFunctionName("onSubmitActivity")
    .setParameters({
      messageId: messageId,
      threadId: threadId,
      from: from,
      subject: subject,
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
 * POSTs to /api/crm-activities/approve with all activity fields.
 */
function onSubmitActivity(e) {
  try {
    var formInputs = e.commonEventObject.formInputs;
    var params = e.commonEventObject.parameters || {};

    var retailerId = getSelectValue_(formInputs, "retailerId");
    var brandId = getSelectValue_(formInputs, "brandId");
    var activityTypeKey = getSelectValue_(formInputs, "activityTypeKey");
    var summary = getTextValue_(formInputs, "summary");

    var messageId = params.messageId || "";
    var threadId = params.threadId || "";
    var senderEmail = params.from || "";
    var subject = params.subject || "";

    if (!retailerId || !brandId || !activityTypeKey) {
      return CardService.newActionResponseBuilder()
        .setNotification(
          CardService.newNotification()
            .setText("Please select a retailer, brand, and activity type.")
            .setType(CardService.NotificationType.WARNING)
        )
        .build();
    }

    var payload = {
      retailerId: retailerId,
      brandId: brandId,
      activityTypeKey: activityTypeKey,
      summary: summary || "",
      senderEmail: senderEmail,
      subject: subject,
      gmailMessageId: messageId,
      gmailThreadId: threadId,
      source: "gmail_addon",
    };

    var response = UrlFetchApp.fetch(CONFIG.BASE_URL + "/api/crm-activities/approve", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();

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

    // Show success card
    var retailerName = "";
    try {
      var opts = fetchOptions_();
      var matched = (opts.retailers || []).find(function (r) {
        return String(r.id) === String(retailerId);
      });
      if (matched) retailerName = matched.name;
    } catch (_) {}

    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().pushCard(buildSuccessCard_(retailerName))
      )
      .build();
  } catch (err) {
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
 * @returns {{ retailers, brands, activityTypes, error }}
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
 * Extracts the domain from an email address or "Name <email>" string.
 * Returns the part before the TLD, e.g. "kroger.com" → "kroger".
 */
function extractDomain_(fromHeader) {
  if (!fromHeader) return "";
  var emailMatch = fromHeader.match(/<([^>]+)>/);
  var email = emailMatch ? emailMatch[1] : fromHeader.trim();
  var atIndex = email.indexOf("@");
  if (atIndex === -1) return "";
  var domain = email.slice(atIndex + 1).toLowerCase(); // e.g. "kroger.com"
  return domain.split(".")[0]; // e.g. "kroger"
}

/**
 * Tries to match the sender's domain keyword against the retailer name list.
 * Returns the matched retailer ID, or null if no match.
 */
function detectRetailerByDomain_(domainKeyword, retailers) {
  if (!domainKeyword || !retailers || retailers.length === 0) return null;
  var kw = domainKeyword.toLowerCase();

  // Exact keyword match inside retailer name
  for (var i = 0; i < retailers.length; i++) {
    var name = (retailers[i].name || "").toLowerCase();
    if (name.includes(kw) || kw.includes(name.split(" ")[0])) {
      return retailers[i].id;
    }
  }

  return null;
}

// ─── CardService Form Utilities ───────────────────────────────────────────────

function getSelectValue_(formInputs, fieldName) {
  try {
    var field = formInputs[fieldName];
    if (!field) return null;
    // DROPDOWN returns { stringInputs: { value: [selectedValue] } }
    var vals = field.stringInputs && field.stringInputs.value;
    return vals && vals.length > 0 ? vals[0] : null;
  } catch (_) {
    return null;
  }
}

function getTextValue_(formInputs, fieldName) {
  try {
    var field = formInputs[fieldName];
    if (!field) return "";
    var vals = field.stringInputs && field.stringInputs.value;
    return vals && vals.length > 0 ? vals[0] : "";
  } catch (_) {
    return "";
  }
}
