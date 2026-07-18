/* ============================================================
   Kai Home Care — New Client Intake
   Vanilla JS. No dependencies, no build step.
   ============================================================ */
(function () {
  'use strict';

  /* ==========================================================
     1. CONFIGURATION — edit these values as the business changes
     ========================================================== */

  var CONFIG = {
    // Business values shown to employees and used in qualification logic
    STANDARD_HOURLY_RATE: 42,      // dollars per hour
    MINIMUM_VISIT_HOURS: 4,        // minimum billable hours per visit
    SERVICE_AREA: 'Oahu',

    /* ------------------------------------------------------
       SUBMISSION INTEGRATION
       Choose one: 'demo' | 'netlify' | 'webhook'

       'demo'    Nothing leaves the browser. Safe for testing.
       'netlify' Posts url-encoded data to NETLIFY_FORM_PATH.
                 Requires a hidden static form in index.html named
                 the same as NETLIFY_FORM_NAME so Netlify detects it
                 at deploy time. See README step 5.
       'webhook' Posts JSON to WEBHOOK_URL.
                 Point this at a serverless function or gateway you
                 control. Never place an API key or secret in this
                 file — it ships to the browser. Put the secret on
                 the server side of the endpoint instead.
       ------------------------------------------------------ */
    SUBMISSION_MODE: 'demo',
    NETLIFY_FORM_NAME: 'kai-intake',
    NETLIFY_FORM_PATH: '/',
    WEBHOOK_URL: '',               // e.g. '/.netlify/functions/intake'
    SUBMIT_TIMEOUT_MS: 15000
  };

  /* ==========================================================
     2. OPTION LISTS
     ========================================================== */

  var OPTIONS = {
    mainConcerns: [
      'Falls or unsafe walking', 'Bathing or hygiene', 'Dressing',
      'Toileting or incontinence', 'Meals, nutrition, or hydration',
      'Missed medications', 'Memory loss or confusion',
      'Cannot safely be left alone', 'Loneliness or isolation',
      'Family caregiver exhaustion', 'Household upkeep', 'Transportation',
      'Recent hospital or rehabilitation discharge',
      'Avoiding or delaying facility placement', 'Other'
    ],
    servicesRequested: [
      'Bathing', 'Grooming', 'Dressing', 'Toileting', 'Incontinence care',
      'Walking assistance', 'Transfers', 'Meal preparation',
      'Light housekeeping', 'Laundry', 'Shopping or errands',
      'Companionship', 'Safety supervision', 'Medication reminders',
      'Family respite', 'Transportation or appointment escort',
      'Dementia support or redirection', 'Other'
    ],
    clinicalTasks: [
      'Medication preparation', 'Medication administration', 'Injections',
      'Wound care', 'Catheter care', 'Feeding tube care',
      'Vital-sign monitoring', 'Skilled nursing assessment', 'Other',
      'Caller is unsure'
    ],
    safetyConcerns: [
      'None known', 'Recent falls', 'Wandering or leaving the home',
      'Significant confusion', 'Resistance to care', 'Verbal aggression',
      'Physical aggression', 'Cannot follow basic instructions',
      'Unsafe home conditions', 'Threatening household member',
      'Unsecured weapons', 'Active substance abuse in the home',
      'Other', 'Unsure'
    ],
    requestedDays: [
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
      'Saturday', 'Sunday', 'Flexible', 'Unsure'
    ],
    preferredTimes: [
      'Morning', 'Midday', 'Afternoon', 'Evening', 'Overnight',
      'Flexible', 'Unsure'
    ],
    attendees: [
      'Client', 'Caller', 'Care decision-maker', 'Financial decision-maker',
      'Other family member', 'Other'
    ]
  };

  // Clinical tasks Kai cannot perform under any circumstance
  var SKILLED_TASKS = [
    'Medication preparation', 'Medication administration', 'Injections',
    'Wound care', 'Catheter care', 'Feeding tube care',
    'Skilled nursing assessment'
  ];

  // Safety concerns that raise a YELLOW
  var SAFETY_YELLOW = [
    'Recent falls', 'Wandering or leaving the home', 'Significant confusion',
    'Resistance to care', 'Verbal aggression', 'Cannot follow basic instructions',
    'Unsafe home conditions', 'Active substance abuse in the home',
    'Other', 'Unsure'
  ];

  // Safety concerns that raise a RED
  var SAFETY_RED = [
    'Physical aggression', 'Threatening household member', 'Unsecured weapons'
  ];

  var SECTIONS = [
    'Contact', 'Why Now?', 'Care Needed', 'Safety and Transfers',
    'Schedule and Payment', 'Assessment Close', 'Summary and Disposition'
  ];

  var SESSION_KEY = 'kai_intake_draft_v1';

  /* ==========================================================
     3. STATE
     ========================================================== */

  var state = {
    current: 0,
    visited: [true, false, false, false, false, false, false],
    dirty: false,
    submitted: false,
    overridden: false,
    lastReco: ''
  };

  var els = {};

  /* ==========================================================
     4. UTILITIES
     ========================================================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // Escape any user-entered content before it is rendered as HTML
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    return '$' + Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2);
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function val(name) {
    var el = document.querySelector('[name="' + name + '"]');
    if (!el) return '';
    if (el.type === 'radio') {
      var checked = document.querySelector('[name="' + name + '"]:checked');
      return checked ? checked.value : '';
    }
    if (el.type === 'checkbox' && document.querySelectorAll('[name="' + name + '"]').length === 1) {
      return el.checked ? el.value : '';
    }
    return el.value.trim();
  }

  function multi(name) {
    return $$('[name="' + name + '"]:checked').map(function (el) { return el.value; });
  }

  function has(list, item) { return list.indexOf(item) !== -1; }

  function anyOf(list, candidates) {
    return candidates.some(function (c) { return has(list, c); });
  }

  function nowLocalISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function show(el, visible) {
    if (!el) return;
    el.hidden = !visible;
  }

  /* ==========================================================
     5. DYNAMIC OPTION RENDERING
     ========================================================== */

  function buildOptionGroups() {
    // Multi-select card groups
    $$('[data-cards]').forEach(function (host) {
      var key = host.getAttribute('data-cards');
      host.innerHTML = OPTIONS[key].map(function (opt) {
        var id = key + '-' + slug(opt);
        return '<label class="cardopt" for="' + id + '">' +
               '<input type="checkbox" id="' + id + '" name="' + key + '" value="' + esc(opt) + '">' +
               '<span>' + esc(opt) + '</span></label>';
      }).join('');
    });

    // Multi-select checkbox groups
    $$('[data-checks]').forEach(function (host) {
      var key = host.getAttribute('data-checks');
      host.innerHTML = OPTIONS[key].map(function (opt) {
        var id = key + '-' + slug(opt);
        return '<label class="opt" for="' + id + '">' +
               '<input type="checkbox" id="' + id + '" name="' + key + '" value="' + esc(opt) + '">' +
               '<span>' + esc(opt) + '</span></label>';
      }).join('');
    });

    // Hours-per-visit radios reference the configured minimum
    var hoursHost = $('[data-radios="hoursPerVisit"]');
    if (hoursHost) {
      var m = CONFIG.MINIMUM_VISIT_HOURS;
      var hourOpts = [
        'Under Kai\u2019s minimum (fewer than ' + m + ' hours)',
        'Kai\u2019s minimum (' + m + ' hours)',
        '5\u20138 hours', '9\u201312 hours',
        'Longer or live-in request', 'Unsure'
      ];
      hoursHost.innerHTML = hourOpts.map(function (opt) {
        var id = 'hours-' + slug(opt);
        return '<label class="opt" for="' + id + '">' +
               '<input type="radio" id="' + id + '" name="hoursPerVisit" value="' + esc(opt) + '">' +
               '<span>' + esc(opt) + '</span></label>';
      }).join('');
    }

    // Inject configured business values into the copy
    $$('[data-bind="minHours"]').forEach(function (n) { n.textContent = CONFIG.MINIMUM_VISIT_HOURS; });
    $$('[data-bind="rate"]').forEach(function (n) { n.textContent = money(CONFIG.STANDARD_HOURLY_RATE); });

    var script = $('#rateScript');
    if (script) {
      script.innerHTML = '&ldquo;Our current rate is ' + esc(money(CONFIG.STANDARD_HOURLY_RATE)) +
        ' per hour with a ' + esc(CONFIG.MINIMUM_VISIT_HOURS) +
        '-hour visit minimum. Does that appear workable for your family?&rdquo;';
    }

    // Side navigation
    var list = $('#sideNavList');
    list.innerHTML = SECTIONS.map(function (name, i) {
      return '<li><button type="button" class="navitem" data-goto="' + i + '">' +
             '<span class="dot">' + (i + 1) + '</span>' +
             '<span>' + esc(name) + '</span></button></li>';
    }).join('');
  }

  /* ==========================================================
     6. CONDITIONAL DISPLAY LOGIC
     Reveal follow-up questions only when they are relevant.
     ========================================================== */

  function applyConditionals() {
    var clinical = val('clinicalRequested');
    show($('[data-conditional="clinicalTasks"]'), clinical === 'Yes' || clinical === 'Unsure');

    show($('[data-conditional="existingProvider"]'), val('existingClinical') === 'Yes');

    var needsHelp = val('needsTransferHelp');
    show($('[data-conditional="transferDetail"]'),
      needsHelp === 'Yes' || needsHelp === 'Sometimes' || needsHelp === 'Unsure');

    var safety = multi('safetyConcerns');
    var safetyDetailNeeded = safety.length > 0 && !(safety.length === 1 && safety[0] === 'None known');
    show($('[data-conditional="safetyDetail"]'), safetyDetailNeeded);

    show($('[data-conditional="petsDetail"]'), val('pets') === 'Yes');

    show($('[data-conditional="assessmentDetail"]'), val('willingToSchedule') === 'Yes');

    show($('[data-conditional="overrideReason"]'), state.overridden);

    // "None known" is mutually exclusive with the other safety concerns
    enforceExclusive('safetyConcerns', 'None known');
  }

  function enforceExclusive(groupName, exclusiveValue) {
    var boxes = $$('[name="' + groupName + '"]');
    var exclusiveBox = boxes.filter(function (b) { return b.value === exclusiveValue; })[0];
    if (!exclusiveBox) return;
    var otherChecked = boxes.some(function (b) { return b !== exclusiveBox && b.checked; });
    if (exclusiveBox.checked && otherChecked) {
      // The most recent interaction wins; handled in the change listener
      return;
    }
  }

  /* ==========================================================
     7. QUALIFICATION LOGIC
     Produces a status (green/yellow/red/gray), a recommended
     disposition, and the reasons behind it.
     ========================================================== */

  function evaluate() {
    var reasons = { red: [], yellow: [] };
    var forced = null;   // a red disposition that takes priority

    /* --- Service area --- */
    var oahu = val('livesOnOahu');
    if (oahu === 'No') {
      reasons.red.push('Client does not live on ' + CONFIG.SERVICE_AREA + '.');
      forced = forced || 'Outside Service Area';
    } else if (oahu === 'Unsure') {
      reasons.yellow.push('Island of residence not confirmed.');
    }

    /* --- Scope: clinical tasks --- */
    var clinicalAsked = val('clinicalRequested');
    var tasks = multi('clinicalTasks');
    var provider = val('clinicalProvider');
    var skilledAsked = anyOf(tasks, SKILLED_TASKS);

    if (clinicalAsked === 'Yes' || clinicalAsked === 'Unsure') {
      if (skilledAsked && provider === 'Kai is expected to provide them') {
        reasons.red.push('Kai is expected to perform skilled clinical tasks.');
        forced = forced || 'Outside Current Scope';
      } else if (tasks.length || clinicalAsked === 'Unsure') {
        reasons.yellow.push('Clinical tasks discussed. Division of responsibility needs clarification.');
      }
    }
    if (val('existingClinical') === 'Unsure') {
      reasons.yellow.push('Existing hospice or home health involvement is unclear.');
    }

    /* --- Transfers --- */
    var needsHelp = val('needsTransferHelp');
    var transferAssessed = needsHelp === 'Yes' || needsHelp === 'Sometimes' || needsHelp === 'Unsure';

    if (transferAssessed) {
      var bears = val('bearsWeight');
      var follows = val('followsDirections');
      var assist = val('assistLevel');
      var lift = val('mechanicalLift');
      var twoPerson = val('twoPersonTransfer');

      var transferRed = false;
      if (bears === 'No') { transferRed = true; reasons.red.push('Client cannot bear weight.'); }
      if (follows === 'No') { transferRed = true; reasons.red.push('Client cannot participate in transfers.'); }
      if (lift === 'Yes') { transferRed = true; reasons.red.push('Mechanical lift is used or recommended.'); }
      if (twoPerson === 'Yes') { transferRed = true; reasons.red.push('Two-person transfer required.'); }
      // Normalize curly and straight apostrophes so the match is reliable
      if (assist.replace(/\u2019/g, "'") === "Lifts nearly all of the client's weight") {
        transferRed = true;
        reasons.red.push('Caregiver would lift nearly all of the client\u2019s weight.');
      }
      if (transferRed) forced = forced || 'Outside Current Scope';

      var transferYellow = false;
      if (bears === 'Partially') { transferYellow = true; reasons.yellow.push('Client is only partially weight bearing.'); }
      if (bears === 'Unsure') { transferYellow = true; reasons.yellow.push('Weight-bearing ability unclear.'); }
      if (follows === 'Sometimes' || follows === 'Unsure') {
        transferYellow = true; reasons.yellow.push('Client inconsistently follows transfer directions.');
      }
      if (assist === 'Provides substantial lifting assistance') {
        transferYellow = true; reasons.yellow.push('Substantial lifting assistance may be required.');
      }
      if (assist === 'Unsure' || lift === 'Unsure' || twoPerson === 'Unsure' || twoPerson === 'Sometimes') {
        transferYellow = true; reasons.yellow.push('Transfer details are unclear.');
      }
      if (needsHelp === 'Unsure') {
        transferYellow = true; reasons.yellow.push('Whether the client needs transfer help is unclear.');
      }

      show($('[data-flag="transferRed"]'), transferRed);
      show($('[data-flag="transferYellow"]'), !transferRed && transferYellow);
    } else {
      show($('[data-flag="transferRed"]'), false);
      show($('[data-flag="transferYellow"]'), false);
    }

    if (val('mobility') === 'Mostly remains in a chair or bed') {
      reasons.yellow.push('Client is mostly chair or bed bound. Confirm transfer method.');
    }
    if (val('mobility') === 'Unsure') {
      reasons.yellow.push('Mobility level unclear.');
    }

    /* --- Safety and behavior --- */
    var safety = multi('safetyConcerns');
    var safetyRedHit = anyOf(safety, SAFETY_RED);
    if (safetyRedHit) {
      reasons.red.push('Safety concern reported that may create immediate danger to staff.');
      forced = forced || 'Outside Current Scope';
    }
    SAFETY_YELLOW.forEach(function (c) {
      if (has(safety, c)) reasons.yellow.push('Safety concern: ' + c + '.');
    });
    show($('[data-flag="safetyRed"]'), safetyRedHit);

    if (val('pets') === 'Yes') {
      var pm = val('petsManageable');
      if (pm === 'No' || pm === 'Unsure') reasons.yellow.push('Pet manageability around visitors is unclear.');
    }

    /* --- Schedule and finances --- */
    var hours = val('hoursPerVisit');
    var underMin = hours.indexOf('Under') === 0;
    var liveIn = hours.indexOf('Longer or live-in') === 0;
    if (underMin) reasons.yellow.push('Requested visit length is below the ' + CONFIG.MINIMUM_VISIT_HOURS + '-hour minimum.');
    if (liveIn) reasons.yellow.push('Longer or live-in request requires operational review.');
    if (hours === 'Unsure') reasons.yellow.push('Hours per visit not yet known.');

    var hoursFlag = $('[data-flag="hoursYellow"]');
    if (hoursFlag) {
      if (underMin) {
        hoursFlag.textContent = 'Below Kai\u2019s ' + CONFIG.MINIMUM_VISIT_HOURS +
          '-hour minimum. Confirm whether the family will accept the minimum.';
        show(hoursFlag, true);
      } else if (liveIn) {
        hoursFlag.textContent = 'Longer or live-in requests require operational review before scheduling.';
        show(hoursFlag, true);
      } else {
        show(hoursFlag, false);
      }
    }

    var workable = val('financiallyWorkable');
    if (workable === 'No') {
      reasons.red.push('Family states the rate and minimum are not workable.');
      forced = forced || 'Not Financially Qualified';
    } else if (workable === 'Likely, but another decision-maker must approve') {
      reasons.yellow.push('Rate requires another decision-maker\u2019s approval.');
    } else if (workable === 'Unsure') {
      reasons.yellow.push('Financial fit is unclear.');
    }

    if (val('acceptsMinimum') === 'No') {
      reasons.red.push('Family will not accept the ' + CONFIG.MINIMUM_VISIT_HOURS + '-hour visit minimum.');
      forced = forced || 'Not Financially Qualified';
    } else if (val('acceptsMinimum') === 'Unsure') {
      reasons.yellow.push('Acceptance of the visit minimum is unconfirmed.');
    }

    var pp = val('privatePayUnderstood');
    if (pp === 'No' || pp === 'Unsure') {
      reasons.yellow.push('Private-pay responsibility has not been confirmed with the family.');
    }
    show($('[data-flag="privatePayYellow"]'), pp === 'No' || pp === 'Unsure');

    if (val('paymentSource') === 'Unsure') {
      reasons.yellow.push('Payment source not identified.');
    }

    /* --- Assessment close --- */
    var willing = val('willingToSchedule');
    var declined = willing === 'No';
    var notReady = willing === 'Not ready' || willing === 'Needs to speak with someone else';

    /* --- Completeness --- */
    var coreAnswered = !!(val('intakeEmployee') && val('callerName') && val('clientName') &&
      val('clientCity') && oahu && val('whatChanged') && val('urgency') &&
      val('clinicalRequested') && val('mobility') && val('needsTransferHelp') &&
      val('hoursPerVisit') && workable && willing);

    /* --- Status --- */
    var status;
    if (reasons.red.length) status = 'red';
    else if (!coreAnswered) status = 'gray';
    else if (reasons.yellow.length) status = 'yellow';
    else status = 'green';

    /* --- Recommended disposition --- */
    var reco;
    if (forced) {
      reco = forced;
    } else if (declined) {
      reco = 'Family Declined';
    } else if (status === 'gray') {
      reco = 'Supervisor Review Before Scheduling';
    } else if (status === 'yellow') {
      reco = notReady ? 'Follow Up Later' : 'Supervisor Review Before Scheduling';
    } else if (notReady) {
      reco = 'Follow Up Later';
    } else if (willing === 'Yes' && val('assessmentDate') && val('assessmentTime')) {
      reco = 'Assessment Scheduled';
    } else {
      reco = 'Schedule Assessment';
    }

    return {
      status: status,
      recommendation: reco,
      reasons: reasons.red.concat(reasons.yellow),
      complete: coreAnswered
    };
  }

  /* ==========================================================
     8. STATUS DISPLAY
     Status uses an icon and a text label, never color alone.
     ========================================================== */

  var STATUS_META = {
    green:  { cls: 'badge-green',  icon: '\u2713', text: 'Likely Qualified' },
    yellow: { cls: 'badge-yellow', icon: '\u26A0', text: 'Supervisor Review' },
    red:    { cls: 'badge-red',    icon: '\u2715', text: 'Not Currently a Fit' },
    gray:   { cls: 'badge-gray',   icon: '\u25CB', text: 'Incomplete' }
  };

  function renderStatus(result) {
    var meta = STATUS_META[result.status];
    var badge = $('#statusBadge');
    badge.className = 'badge ' + meta.cls;
    $('.badge-icon', badge).textContent = meta.icon;
    $('.badge-text', badge).textContent = meta.text;

    // Section-level inline flags
    show($('[data-flag="oahuNo"]'), val('livesOnOahu') === 'No');
    show($('[data-flag="oahuUnsure"]'), val('livesOnOahu') === 'Unsure');
    var dm = val('decisionMakerInvolved');
    show($('[data-flag="dmNote"]'), dm === 'No' || dm === 'Unsure');
    show($('[data-flag="scopeRed"]'),
      anyOf(multi('clinicalTasks'), SKILLED_TASKS) &&
      val('clinicalProvider') === 'Kai is expected to provide them');
    show($('[data-flag="financeRed"]'), val('financiallyWorkable') === 'No');
  }

  function renderRecommendation(result) {
    state.lastReco = result.recommendation;
    var box = $('#recoBox');
    box.className = 'reco is-' + result.status;
    $('#recoValue').textContent = result.recommendation;
    $('#recoReasons').innerHTML = result.reasons.map(function (r) {
      return '<li>' + esc(r) + '</li>';
    }).join('');

    // Default the employee disposition to the recommendation until overridden
    var sel = $('#q54');
    if (!state.overridden) sel.value = result.recommendation;
  }

  /* ==========================================================
     9. SUMMARY GENERATION
     All values are escaped before rendering.
     ========================================================== */

  function line(label, value) {
    if (value === '' || value == null || (Array.isArray(value) && !value.length)) return '';
    var v = Array.isArray(value) ? value.join(', ') : value;
    return '<dt>' + esc(label) + '</dt><dd>' + esc(v) + '</dd>';
  }

  function block(title, rows) {
    var body = rows.filter(Boolean).join('');
    if (!body) return '';
    return '<h4>' + esc(title) + '</h4><dl>' + body + '</dl>';
  }

  function buildSummary(result) {
    var transferStatus = [];
    if (val('bearsWeight')) transferStatus.push('Bears weight: ' + val('bearsWeight'));
    if (val('followsDirections')) transferStatus.push('Follows directions: ' + val('followsDirections'));
    if (val('assistLevel')) transferStatus.push('Assist level: ' + val('assistLevel'));
    if (val('mechanicalLift')) transferStatus.push('Mechanical lift: ' + val('mechanicalLift'));
    if (val('twoPersonTransfer')) transferStatus.push('Two-person transfer: ' + val('twoPersonTransfer'));

    var schedule = [];
    if (val('startDate')) schedule.push('Start: ' + val('startDate'));
    if (multi('requestedDays').length) schedule.push('Days: ' + multi('requestedDays').join(', '));
    if (multi('preferredTimes').length) schedule.push('Times: ' + multi('preferredTimes').join(', '));
    if (val('hoursPerVisit')) schedule.push('Hours per visit: ' + val('hoursPerVisit'));
    if (val('visitsPerWeek')) schedule.push('Visits per week: ' + val('visitsPerWeek'));

    var followUp = [];
    if (val('followUpOwner')) followUp.push('Owner: ' + val('followUpOwner'));
    if (val('followUpDate')) followUp.push('Due: ' + val('followUpDate'));

    var html = '';

    html += block('Call', [
      line('Intake employee', val('intakeEmployee')),
      line('Date and time', val('inquiryDateTime').replace('T', ' ')),
      line('Recommended disposition', result.recommendation),
      line('Final disposition', val('finalDisposition')),
      line('Override reason', val('overrideReason'))
    ]);

    html += block('Caller', [
      line('Name', val('callerName')),
      line('Relationship', val('callerRelationship')),
      line('Callback number', val('callbackNumber')),
      line('Email', val('callerEmail'))
    ]);

    html += block('Client', [
      line('Name', val('clientName')),
      line('Approximate age', val('clientAge')),
      line('City or neighborhood', val('clientCity')),
      line('Lives on ' + CONFIG.SERVICE_AREA, val('livesOnOahu')),
      line('Care decision-maker', val('careDecisionMaker')),
      line('Financial decision-maker', val('financialDecisionMaker')),
      line('Decision-maker involved', val('decisionMakerInvolved'))
    ]);

    html += block('Why they called', [
      line('What changed', val('whatChanged')),
      line('Main concerns', multi('mainConcerns')),
      line('Urgency', val('urgency')),
      line('Desired outcome', val('desiredOutcome')),
      line('Risk if no help', val('riskIfNoHelp'))
    ]);

    html += block('Services requested', [
      line('Assistance requested', multi('servicesRequested')),
      line('Typical visit', val('typicalVisit')),
      line('Clinical tasks requested', val('clinicalRequested')),
      line('Which clinical tasks', multi('clinicalTasks')),
      line('Expected to perform them', val('clinicalProvider')),
      line('Existing hospice or home health', val('existingClinical')),
      line('Provider', val('existingProviderName'))
    ]);

    html += block('Mobility and transfers', [
      line('Mobility', val('mobility')),
      line('Needs transfer help', val('needsTransferHelp')),
      line('Transfer status', transferStatus)
    ]);

    html += block('Safety', [
      line('Concerns', multi('safetyConcerns')),
      line('Detail', val('safetyDetail')),
      line('Pets', val('pets')),
      line('Pets manageable', val('petsManageable'))
    ]);

    html += block('Schedule and payment', [
      line('Requested schedule', schedule),
      line('Rate and minimum explained', val('rateExplained') ? 'Yes' : 'No'),
      line('Financially workable', val('financiallyWorkable')),
      line('Accepts minimum', val('acceptsMinimum')),
      line('Payment source', val('paymentSource')),
      line('Private-pay understood', val('privatePayUnderstood'))
    ]);

    html += block('Assessment', [
      line('Willing to schedule', val('willingToSchedule')),
      line('Client can attend', val('clientAttends')),
      line('Care decision-maker can attend', val('careDmAttends')),
      line('Financial party can attend', val('financialDmAttends')),
      line('Date', val('assessmentDate')),
      line('Time', val('assessmentTime')),
      line('Address', val('assessmentAddress')),
      line('Attending', multi('attendees')),
      line('Access notes', val('accessNotes'))
    ]);

    html += block('Follow-up', [
      line('Notes for assessor or supervisor', val('assessorNotes')),
      line('Follow-up', followUp)
    ]);

    if (result.reasons.length) {
      html += '<h4>Qualification notes</h4><ul class="reco-reasons">' +
        result.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    }

    $('#summaryOut').innerHTML = html || '<p>No information entered yet.</p>';
  }

  // Plain-text version for the clipboard
  function summaryText() {
    var out = [];
    $$('#summaryOut > *').forEach(function (node) {
      if (node.tagName === 'H4') {
        out.push('', node.textContent.toUpperCase(), '-'.repeat(node.textContent.length));
      } else if (node.tagName === 'DL') {
        var kids = Array.prototype.slice.call(node.children);
        for (var i = 0; i < kids.length; i += 2) {
          out.push(kids[i].textContent + ': ' + (kids[i + 1] ? kids[i + 1].textContent : ''));
        }
      } else if (node.tagName === 'UL') {
        $$('li', node).forEach(function (li) { out.push('- ' + li.textContent); });
      }
    });
    return ('KAI HOME CARE — NEW CLIENT INTAKE\n' + out.join('\n')).trim();
  }

  /* ==========================================================
     10. VALIDATION
     ========================================================== */

  function clearErrors(section) {
    $$('.err', section).forEach(function (e) { e.textContent = ''; });
    $$('.is-invalid', section).forEach(function (e) { e.classList.remove('is-invalid'); });
  }

  function setError(key, msg, field) {
    var slot = document.querySelector('[data-err-for="' + key + '"]');
    if (slot) slot.textContent = msg;
    if (field) field.classList.add('is-invalid');
  }

  function validateSection(index) {
    var section = $('.section[data-section="' + index + '"]');
    clearErrors(section);
    var ok = true;
    var firstBad = null;

    // Required text, select, and textarea fields
    $$('[data-required]', section).forEach(function (field) {
      if (field.closest('[hidden]')) return;
      if (!field.value.trim()) {
        setError(field.id, 'This field is required.', field);
        ok = false;
        firstBad = firstBad || field;
      } else if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim())) {
        setError(field.id, 'Enter a valid email address.', field);
        ok = false;
        firstBad = firstBad || field;
      }
    });

    // Required radio groups
    $$('[data-required-group]', section).forEach(function (group) {
      if (group.closest('[hidden]') && group.hidden) return;
      var name = group.getAttribute('data-required-group');
      if (!val(name)) {
        setError(name, 'Please select an answer.');
        ok = false;
        firstBad = firstBad || $('input', group);
      }
    });

    // Section 5 requires the rate acknowledgment
    if (index === 4 && !val('rateExplained')) {
      setError('rateExplained', 'Confirm that the rate and minimum were explained before continuing.');
      ok = false;
      firstBad = firstBad || document.querySelector('[name="rateExplained"]');
    }

    // Section 7 requires an override reason when the disposition is changed
    if (index === 6 && state.overridden && !val('overrideReason')) {
      setError('q55', 'An explanation is required when overriding the recommendation.', $('#q55'));
      ok = false;
      firstBad = firstBad || $('#q55');
    }

    if (firstBad && firstBad.focus) {
      firstBad.focus({ preventScroll: false });
    }
    return ok;
  }

  /* ==========================================================
     11. NAVIGATION
     ========================================================== */

  function goTo(index, skipValidation) {
    if (index === state.current) return;
    if (index > state.current && !skipValidation) {
      for (var i = state.current; i < index; i++) {
        if (!validateSection(i)) { render(); return; }
        state.visited[i + 1] = true;
      }
    }
    state.current = Math.max(0, Math.min(SECTIONS.length - 1, index));
    state.visited[state.current] = true;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderNav() {
    $$('.navitem').forEach(function (btn) {
      var i = Number(btn.getAttribute('data-goto'));
      btn.classList.toggle('is-current', i === state.current);
      btn.classList.toggle('is-done', state.visited[i] && i !== state.current);
      btn.disabled = !state.visited[i];
      btn.setAttribute('aria-current', i === state.current ? 'step' : 'false');
      var dot = $('.dot', btn);
      dot.textContent = (state.visited[i] && i < state.current) ? '\u2713' : String(i + 1);
    });

    $$('.section').forEach(function (s) {
      s.hidden = Number(s.getAttribute('data-section')) !== state.current;
    });

    $('#prevBtn').disabled = state.current === 0;
    $('#nextBtn').hidden = state.current === SECTIONS.length - 1;
    $('#navCounter').textContent = 'Section ' + (state.current + 1) + ' of ' + SECTIONS.length +
      ' \u2014 ' + SECTIONS[state.current];

    var pct = ((state.current + 1) / SECTIONS.length) * 100;
    $('#mProgFill').style.width = pct + '%';
    $('#mProgLabel').textContent = 'Section ' + (state.current + 1) + ' of ' + SECTIONS.length +
      ': ' + SECTIONS[state.current];
  }

  /* ==========================================================
     12. SESSION PERSISTENCE
     sessionStorage only. Cleared when the tab closes or the
     intake is submitted or reset. Never localStorage.
     ========================================================== */

  function collect() {
    var data = {};
    $$('input, select, textarea').forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') {
        if (!data[el.name]) data[el.name] = [];
        if (el.checked) data[el.name].push(el.value);
      } else if (el.type === 'radio') {
        if (el.checked) data[el.name] = el.value;
      } else {
        data[el.name] = el.value;
      }
    });
    return data;
  }

  function saveDraft() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        data: collect(),
        current: state.current,
        visited: state.visited,
        overridden: state.overridden,
        savedAt: new Date().toISOString()
      }));
    } catch (e) {
      // Storage may be unavailable in private modes. Fail quietly.
    }
  }

  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function restore(draft) {
    var d = draft.data || {};
    Object.keys(d).forEach(function (name) {
      var value = d[name];
      var fields = $$('[name="' + name + '"]');
      if (!fields.length) return;
      if (Array.isArray(value)) {
        fields.forEach(function (f) { f.checked = value.indexOf(f.value) !== -1; });
      } else if (fields[0].type === 'radio') {
        fields.forEach(function (f) { f.checked = f.value === value; });
      } else if (fields[0].type === 'checkbox') {
        fields[0].checked = !!value;
      } else {
        fields[0].value = value;
      }
    });
    state.current = draft.current || 0;
    state.visited = draft.visited || state.visited;
    state.overridden = !!draft.overridden;
  }

  /* ==========================================================
     13. SUBMISSION
     Replace or extend submitIntake() to integrate with a real
     backend. The success message only appears after the promise
     resolves successfully.
     ========================================================== */

  function submitIntake(payload) {
    if (CONFIG.SUBMISSION_MODE === 'demo') {
      // Demo mode: nothing leaves the browser.
      return new Promise(function (resolve) {
        setTimeout(function () {
          console.info('[Kai Intake] Demo mode. Payload not transmitted.', payload);
          resolve({ mode: 'demo' });
        }, 500);
      });
    }

    if (CONFIG.SUBMISSION_MODE === 'netlify') {
      var body = new URLSearchParams();
      body.append('form-name', CONFIG.NETLIFY_FORM_NAME);
      Object.keys(payload).forEach(function (k) {
        var v = payload[k];
        body.append(k, Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v));
      });
      return fetchWithTimeout(CONFIG.NETLIFY_FORM_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
    }

    if (CONFIG.SUBMISSION_MODE === 'webhook') {
      if (!CONFIG.WEBHOOK_URL) {
        return Promise.reject(new Error('No webhook URL is configured. Set CONFIG.WEBHOOK_URL in app.js.'));
      }
      return fetchWithTimeout(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    return Promise.reject(new Error('Unknown SUBMISSION_MODE: ' + CONFIG.SUBMISSION_MODE));
  }

  function fetchWithTimeout(url, opts) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, CONFIG.SUBMIT_TIMEOUT_MS);
    opts.signal = controller.signal;
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('Server responded with ' + res.status);
      return res;
    }).catch(function (err) {
      clearTimeout(timer);
      throw (err.name === 'AbortError' ? new Error('The request timed out.') : err);
    });
  }

  function handleSubmit() {
    var msg = $('#submitMsg');
    msg.className = 'submit-msg';
    msg.textContent = '';

    // Validate every section before submitting
    for (var i = 0; i < SECTIONS.length; i++) {
      if (!validateSection(i)) {
        goTo(i, true);
        msg.className = 'submit-msg bad';
        msg.textContent = 'Some required answers are missing in section ' + (i + 1) + '.';
        return;
      }
    }

    var result = evaluate();
    var payload = collect();
    payload.recommendedDisposition = result.recommendation;
    payload.qualificationStatus = STATUS_META[result.status].text;
    payload.qualificationReasons = result.reasons;
    payload.summaryText = summaryText();

    var btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = 'Submitting\u2026';

    submitIntake(payload).then(function (res) {
      state.submitted = true;
      state.dirty = false;
      clearDraft();
      msg.className = 'submit-msg ok';
      msg.textContent = (res && res.mode === 'demo')
        ? 'Demo mode: the intake was validated successfully. No data was transmitted.'
        : 'Intake submitted successfully.';
      btn.textContent = 'Submitted';
    }).catch(function (err) {
      msg.className = 'submit-msg bad';
      msg.textContent = 'Submission failed: ' + err.message +
        ' Copy or print the summary so the information is not lost, then try again.';
      btn.disabled = false;
      btn.textContent = 'Submit Intake';
    });
  }

  /* ==========================================================
     14. RENDER
     ========================================================== */

  function render() {
    applyConditionals();
    var result = evaluate();
    state.lastReco = result.recommendation;
    renderStatus(result);
    renderNav();
    if (state.current === SECTIONS.length - 1) {
      renderRecommendation(result);
      buildSummary(result);
    }
  }

  /* ==========================================================
     15. EVENT WIRING
     ========================================================== */

  function startApp(draft) {
    $('#welcome').hidden = true;
    $('#app').hidden = false;
    if (draft) restore(draft);
    if (!val('inquiryDateTime')) $('#q2').value = nowLocalISO();
    render();
    var first = $('#q1');
    if (first && !first.value) first.focus();
  }

  function resetAll() {
    $$('input, select, textarea').forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else el.value = '';
    });
    state.current = 0;
    state.visited = [true, false, false, false, false, false, false];
    state.dirty = false;
    state.submitted = false;
    state.overridden = false;
    clearDraft();
    $('#q2').value = nowLocalISO();
    var btn = $('#submitBtn');
    btn.disabled = false;
    btn.textContent = 'Submit Intake';
    $('#submitMsg').textContent = '';
    $('#submitMsg').className = 'submit-msg';
    render();
    window.scrollTo({ top: 0 });
  }

  function openModal() {
    $('#modal').hidden = false;
    $('#modalConfirm').focus();
  }
  function closeModal() { $('#modal').hidden = true; }

  function wire() {
    // Welcome screen
    $('#startBtn').addEventListener('click', function () { startApp(null); });

    var draft = loadDraft();
    if (draft && draft.data) {
      $('#resumeNote').hidden = false;
      $('#resumeBtn').addEventListener('click', function () { startApp(draft); });
      $('#discardBtn').addEventListener('click', function () {
        clearDraft();
        $('#resumeNote').hidden = true;
      });
    }

    // Any change re-evaluates the intake
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.name) return;
      state.dirty = true;

      // "None known" clears the other safety concerns and vice versa
      if (t.name === 'safetyConcerns') {
        if (t.value === 'None known' && t.checked) {
          $$('[name="safetyConcerns"]').forEach(function (b) {
            if (b.value !== 'None known') b.checked = false;
          });
        } else if (t.checked) {
          var none = $$('[name="safetyConcerns"]').filter(function (b) { return b.value === 'None known'; })[0];
          if (none) none.checked = false;
        }
      }

      // Employee overriding the system recommendation
      if (t.name === 'finalDisposition') {
        state.overridden = t.value !== state.lastReco;
      }

      render();
      saveDraft();
    });

    document.addEventListener('input', function (e) {
      if (!e.target.name) return;
      state.dirty = true;
      // Clear an error as soon as the field is filled in
      if (e.target.classList.contains('is-invalid') && e.target.value.trim()) {
        e.target.classList.remove('is-invalid');
        var slot = document.querySelector('[data-err-for="' + e.target.id + '"]');
        if (slot) slot.textContent = '';
      }
      if (state.current === SECTIONS.length - 1) render();
    });

    // Debounced session save on typing
    var saveTimer;
    document.addEventListener('input', function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 600);
    });

    // Navigation
    $('#nextBtn').addEventListener('click', function () {
      if (validateSection(state.current)) goTo(state.current + 1, true);
      else render();
    });
    $('#prevBtn').addEventListener('click', function () { goTo(state.current - 1, true); });
    $('#sideNavList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-goto]');
      if (!btn || btn.disabled) return;
      var target = Number(btn.getAttribute('data-goto'));
      goTo(target, target < state.current);
    });

    // Summary actions
    $('#copyBtn').addEventListener('click', function () {
      var text = summaryText();
      var done = function () {
        $('#copyBtn').textContent = 'Copied';
        setTimeout(function () { $('#copyBtn').textContent = 'Copy Summary'; }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done); });
      } else {
        legacyCopy(text, done);
      }
    });

    $('#printBtn').addEventListener('click', function () { window.print(); });
    $('#newBtn').addEventListener('click', openModal);
    $('#resetBtn').addEventListener('click', openModal);
    $('#modalCancel').addEventListener('click', closeModal);
    $('#modalConfirm').addEventListener('click', function () { closeModal(); resetAll(); });
    $('#submitBtn').addEventListener('click', handleSubmit);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
    });

    // Warn before leaving an incomplete intake
    window.addEventListener('beforeunload', function (e) {
      if (state.dirty && !state.submitted) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }

  function legacyCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb(); }
    catch (err) { window.alert('Copy failed. Select the summary text manually.'); }
    document.body.removeChild(ta);
  }

  /* ==========================================================
     16. BOOT
     ========================================================== */

  function init() {
    try {
      buildOptionGroups();
      wire();
    } catch (err) {
      console.error('[Kai Intake] Initialization error:', err);
      var w = $('.welcome-card');
      if (w) {
        var p = document.createElement('p');
        p.className = 'welcome-note';
        p.textContent = 'The intake tool failed to load. Refresh the page, and report this if it continues.';
        w.appendChild(p);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
