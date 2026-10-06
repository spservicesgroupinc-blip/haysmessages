// Fictional records used only in isolated tests, never in the production app.
const headers = ['Job Number','Customer','Estimator','Insurance Carrier','Primary Adjuster','Referred By','Foreman','Date Received','Division','Date Inspected','Marketing Person','Total Estimates','Job Status','Reason For Closing','Last Journal Note Entered'];
const salesRows = [headers,
  ['TEST-001','North customer','Estimator One','Carrier A','Adjuster A','Referral A','Foreman A','8/1/26 8:38 AM','Structure','8/5/2026','Marketer A','$1,234.50','Pending Sales','','<b>Estimate sent.</b></br>Awaiting signature.'],
  ['TEST-002','South customer','Estimator Two','Carrier B','','','','10/1/2026','Remodel','','',null,'Pending Sales','','Need an estimate.'],
  ['TEST-003','Zero amount customer','Estimator One','','','','','9/16/26','Warranty','','',0,'Pending Sales','','<img src=x onerror="alert(1)">'],
  ['TEST-004','Invalid date customer','Estimator Two','','','','','2/30/2026','Structure','','','not a number','Closed','',''],
];
module.exports = { salesRows, headers };
