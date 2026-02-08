// ============================================================
// GDPR Compliance Audit Report — Sample Data
// All data here mirrors real scan output from craftpolicy.com
// ============================================================

export const reportData = {
  // ── Meta ──────────────────────────────────────────────────
  meta: {
    scanId: "aud_9277b115724ebbe5",
    scanDate: "February 8, 2026",
    scanDateFull: "2/8/2026, 12:31:34 AM",
    scannerVersion: "1.0.0",
    targetUrl: "https://www.craftpolicy.com/",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    auditType: "Automated Scan + Human-Assisted Verification",
    preparedFor: "CraftPolicy",
    preparedBy: "CraftPolicy Compliance Team",
  },

  // ── Executive Summary ─────────────────────────────────────
  executive: {
    complianceStatus: "High Risk",
    statusDescription: "Immediate action recommended",
    topFindings: [
      {
        title: "Tracking Before Consent",
        severity: "critical" as const,
        summary:
          "19 tracking requests detected before any user consent was obtained, including Google Tag Manager, Facebook Pixel, and LinkedIn.",
      },
      {
        title: "Missing Reject Button",
        severity: "critical" as const,
        summary:
          "Cookie banner lacks an equally prominent 'Reject All' button, making consent non-compliant under GDPR Article 7(4).",
      },
      {
        title: "Undeclared Cookie Inventory",
        severity: "high" as const,
        summary:
          "10 cookies detected but 0 declared in cookie policy, creating a transparency gap under GDPR Article 13.",
      },
    ],
    businessImpact: [
      "Potential regulatory fines up to 4% of annual global turnover (GDPR Art. 83)",
      "Invalid consent foundation affects all downstream advertising data and attribution",
      "Increased exposure to noyb-style complaints and DPA investigations",
    ],
    miniRoadmap: {
      immediate: "Block all tracking scripts until user consent is obtained",
      twoWeeks: "Redesign cookie banner with compliant Reject/Accept buttons",
      thirtyDays:
        "Complete cookie declaration, privacy policy updates, and governance setup",
    },
  },

  // ── Scope & Methodology ───────────────────────────────────
  scope: {
    whatWeTested: [
      "Cookie implementation and categorization accuracy",
      "Consent banner design and user experience compliance",
      "Pre-consent tracking behaviour (network request analysis)",
      "Privacy policy completeness against GDPR requirements",
      "Google Consent Mode V2 configuration and defaults",
      "Post-consent and post-reject cookie behaviour (human-assisted)",
    ],
    howWeTested: [
      {
        method: "Automated Network Scan",
        description:
          "Captured all outgoing requests during initial page load before any user interaction to detect pre-consent tracking.",
      },
      {
        method: "Human-Assisted Browser Session",
        description:
          "Real runtime behaviour observed after explicit Reject and Accept actions to verify consent is respected.",
      },
      {
        method: "Privacy Policy Analysis",
        description:
          "Evaluated policy text against a 4-tier GDPR criteria framework covering 20+ legal requirements.",
      },
      {
        method: "Cookie Declaration Audit",
        description:
          "Cross-referenced detected cookies against the published cookie policy to identify transparency gaps.",
      },
    ],
    limitations: [
      "Single-page scan; sub-pages may contain additional trackers",
      "Dynamic ad scripts may vary by session or geography",
      "Privacy policy evaluation is text-based and does not confirm legal enforceability",
    ],
  },

  // ── High-Risk Finding #1 ──────────────────────────────────
  finding1: {
    headline: "Tracking Technologies Active Before User Consent",
    severity: "critical" as const,
    confidence: "High" as const,
    confidenceReason:
      "Based on direct network request capture during initial page load, confirmed by human-assisted verification.",
    observation:
      "19 third-party tracking requests were detected during the initial page load, before any user interaction with the cookie consent banner. These include Google Tag Manager, Google Analytics (G-CYHKV5PQJZ), Google Ads (AW-1750718145), Facebook Pixel (connect.facebook.net), and LinkedIn tracking.",
    legalContext:
      "ePrivacy Directive Article 5(3) requires prior informed consent before storing or accessing information on a user's device. GDPR Article 6(1)(a) requires consent to be freely given, specific, informed, and unambiguous. The CJEU Planet49 ruling (C-673/17) confirmed that cookies require active opt-in consent.",
    businessRisk:
      "Fines under GDPR can reach up to 4% of annual global turnover or EUR 20 million, whichever is greater. All advertising data collected without valid consent is legally tainted, potentially invalidating conversion data and audience segments used for ad spend optimization. Additionally, regulators increasingly focus on pre-consent tracking as a priority enforcement area.",
    recommendation:
      "Implement a consent-first architecture: delay all non-essential script execution until after the user explicitly grants consent. Configure Google Consent Mode V2 with all default states set to 'denied'. Use a tag management system that respects consent signals before firing any tags.",
    effort: "Medium" as const,
    topEvidence: [
      {
        type: "Network Request",
        domain: "www.googletagmanager.com",
        url: "https://www.googletagmanager.com/gtm.js?id=GTM-538R3C84",
        timing: "0.49s",
      },
      {
        type: "Network Request",
        domain: "www.googletagmanager.com",
        url: "https://www.googletagmanager.com/gtag/js?id=AW-1750718145&cx=c&gtm=4e6241",
        timing: "0.82s",
      },
      {
        type: "Network Request",
        domain: "www.googletagmanager.com",
        url: "https://www.googletagmanager.com/gtag/js?id=G-CYHKV5PQJZ&cx=c&gtm=4e6241",
        timing: "0.82s",
      },
      {
        type: "Network Request",
        domain: "connect.facebook.net",
        url: "https://connect.facebook.net/en_US/fbevents.js",
        timing: "0.82s",
      },
      {
        type: "Network Request",
        domain: "www.linkedin.com",
        url: "https://www.linkedin.com/px/li_sync",
        timing: "1.04s",
      },
    ],
    totalEvidenceCount: 19,
  },

  // ── High-Risk Finding #2 ──────────────────────────────────
  finding2: {
    headline: "Cookie Banner Missing Equally Prominent Reject Button",
    severity: "critical" as const,
    confidence: "High" as const,
    confidenceReason:
      "Visual inspection confirmed during human-assisted browser session.",
    observation:
      "The cookie consent banner does not include an equally visible and accessible 'Reject All' button on its first layer. Users can only accept cookies with a single prominent action, while declining requires navigating to a secondary settings panel.",
    legalContext:
      "GDPR Article 7(4) and the EDPB Guidelines 05/2020 on consent require that withdrawing or refusing consent must be as easy as giving it. The noyb enforcement framework specifically targets 'dark pattern' banners that make rejection harder than acceptance. Multiple DPAs (CNIL, Austrian DPA, Belgian DPA) have issued fines for this exact violation.",
    businessRisk:
      "Consent obtained through a non-compliant banner may be deemed invalid by regulators, retroactively invalidating all data processed under that consent. This creates cascading risk for advertising attribution, email marketing databases, and analytics data integrity. CNIL fined Google EUR 150M and Facebook EUR 60M specifically for lacking easy reject options.",
    recommendation:
      "Add a 'Reject All' button with identical visual prominence (same size, colour weight, and position) as the 'Accept All' button on the first layer of the consent banner. Ensure granular category controls are accessible but not required for basic reject/accept choices.",
    effort: "Small" as const,
  },

  // ── Medium/Low Findings ───────────────────────────────────
  mediumFindings: [
    {
      title: "No Cookie Declaration / Policy Gap",
      severity: "high" as const,
      description:
        "10 cookies detected but none declared in a cookie policy. Users have no way to understand what data is being collected, by whom, and for what purpose.",
      businessImpact:
        "Violates GDPR transparency requirements. Enforcement trend shows increasing DPA focus on cookie policy completeness.",
      recommendation: "Create a comprehensive cookie policy listing all cookies by category, vendor, purpose, and retention period.",
    },
    {
      title: "Google Consent Mode V2 Defaults Not Set to 'Denied'",
      severity: "medium" as const,
      description:
        "Google Consent Mode V2 is detected and configured, but default consent states are set to 'not_set' instead of 'denied'. This means tags may fire in an ambiguous consent state.",
      businessImpact:
        "May result in data collection before explicit consent, similar to pre-consent tracking. Google's own documentation recommends defaults set to 'denied'.",
      recommendation: "Update all consent mode defaults to 'denied' until the user grants explicit consent.",
    },
    {
      title: "Privacy Policy Evaluation Incomplete",
      severity: "medium" as const,
      description:
        "The privacy policy was evaluated against the GDPR criteria framework and scored 0/100. No criteria could be verified, suggesting the policy is either missing, inaccessible, or does not address required topics.",
      businessImpact:
        "A missing or incomplete privacy policy is a standalone GDPR violation under Articles 12-14 and can result in separate enforcement action.",
      recommendation: "Draft or revise the privacy policy to cover all GDPR-required disclosures including data controller details, legal bases, data subject rights, retention periods, and international transfers.",
    },
    {
      title: "Cookies Loaded from Undeclared Third Parties",
      severity: "medium" as const,
      description:
        "Cookies from LinkedIn (li_sugr, bcookie, lidc), Facebook (_fbp, ar_debug), and Cloudflare (__cf_bm) were detected but not attributed to any disclosed vendor relationship.",
      businessImpact:
        "Undisclosed data processors create risk under GDPR Article 28 (processor agreements) and Article 13 (transparency).",
      recommendation: "Audit all third-party vendor relationships, establish Data Processing Agreements (DPAs), and disclose all processors in the privacy policy.",
    },
  ],

  // ── Cookie & Tracker Inventory ────────────────────────────
  cookies: [
    { name: "ar_debug", category: "Social Media", vendor: "Facebook", purpose: "Unknown purpose — requires manual review", lifespan: "Session", declared: false },
    { name: "li_sugr", category: "Advertising", vendor: "LinkedIn", purpose: "LinkedIn — Advertising and analytics", lifespan: "Session", declared: false },
    { name: "bcookie", category: "Advertising", vendor: "LinkedIn", purpose: "LinkedIn — Advertising and analytics", lifespan: "Session", declared: false },
    { name: "lidc", category: "Advertising", vendor: "LinkedIn", purpose: "LinkedIn — Advertising and analytics", lifespan: "Session", declared: false },
    { name: "UserMatchHistory", category: "Social Media", vendor: "LinkedIn", purpose: "Unknown purpose — requires manual review", lifespan: "Session", declared: false },
    { name: "AnalyticsSyncHistory", category: "Social Media", vendor: "LinkedIn", purpose: "Unknown purpose — requires manual review", lifespan: "Session", declared: false },
    { name: "bscookie", category: "Social Media", vendor: "LinkedIn", purpose: "Cookie consent — User privacy preferences", lifespan: "Session", declared: false },
    { name: "__cf_bm", category: "Functional", vendor: "Cloudflare", purpose: "Bot management and security", lifespan: "Session", declared: false },
    { name: "_fbp", category: "Analytics", vendor: "Facebook", purpose: "Facebook Pixel — Browser tracking", lifespan: "Session", declared: false },
    { name: "CookieScriptConsent", category: "Necessary", vendor: "CookieScript", purpose: "Cookie consent — User privacy preferences", lifespan: "Session", declared: false },
  ],

  // ── Consent Compliance Checklist ──────────────────────────
  consentChecklist: [
    { requirement: "No tracking before consent", status: "fail" as const, severity: "critical" as const },
    { requirement: "Reject button present", status: "fail" as const, severity: "critical" as const },
    { requirement: "No pre-ticked boxes", status: "pass" as const, severity: "critical" as const },
    { requirement: "Fair button design", status: "pass" as const, severity: "high" as const },
    { requirement: "No legitimate interest for ads", status: "pass" as const, severity: "critical" as const },
    { requirement: "Cookies properly categorized", status: "pass" as const, severity: "medium" as const },
    { requirement: "Consent withdrawal available", status: "pass" as const, severity: "high" as const },
  ],

  // ── GDPR & ePrivacy Compliance Matrix ─────────────────────
  complianceMatrix: [
    {
      requirement: "Prior consent before cookies (ePrivacy Art. 5(3))",
      status: "fail" as const,
      evidence: "19 tracking requests before consent",
      businessImpact: "Fines up to 4% global turnover; tainted ad data",
      fix: "Consent-first tag management",
    },
    {
      requirement: "Equal prominence reject option (GDPR Art. 7(4))",
      status: "fail" as const,
      evidence: "No Reject All button on first layer",
      businessImpact: "Invalid consent; retroactive data liability",
      fix: "Redesign banner with equal Reject/Accept buttons",
    },
    {
      requirement: "Cookie declaration transparency (GDPR Art. 13)",
      status: "fail" as const,
      evidence: "0 of 10 cookies declared",
      businessImpact: "Enforcement action; user trust erosion",
      fix: "Publish comprehensive cookie policy",
    },
    {
      requirement: "Privacy policy completeness (GDPR Art. 12-14)",
      status: "fail" as const,
      evidence: "0/100 criteria evaluated",
      businessImpact: "Standalone GDPR violation; separate fines",
      fix: "Draft GDPR-compliant privacy policy",
    },
    {
      requirement: "Data processor disclosure (GDPR Art. 28)",
      status: "fail" as const,
      evidence: "Undeclared third-party vendors",
      businessImpact: "Processor agreement violations",
      fix: "Audit vendors; establish DPAs",
    },
    {
      requirement: "No pre-ticked consent boxes (CJEU Planet49)",
      status: "pass" as const,
      evidence: "No pre-ticked boxes detected",
      businessImpact: "N/A — compliant",
      fix: "N/A",
    },
    {
      requirement: "Consent withdrawal mechanism (GDPR Art. 7(3))",
      status: "pass" as const,
      evidence: "Withdrawal option available",
      businessImpact: "N/A — compliant",
      fix: "N/A",
    },
    {
      requirement: "Google Consent Mode V2 (industry standard)",
      status: "warning" as const,
      evidence: "Detected but defaults set to 'not_set'",
      businessImpact: "Ambiguous consent state; potential data leakage",
      fix: "Set all defaults to 'denied'",
    },
  ],

  // ── Privacy Policy Analysis (Tier 1-4 Criteria) ───────────
  privacyPolicyAnalysis: {
    finalScore: 0,
    finalTotal: 100,
    tiers: [
      {
        id: "tier1",
        name: "Tier 1 - Critical",
        severity: "critical" as const,
        percentage: 0,
        maxPoints: 40,
        earnedPoints: 0,
        criteria: [
          {
            name: "Data Controller Identification",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The privacy policy does not clearly identify the data controller, including full legal name, registered address, and contact details as required by GDPR Article 13(1)(a).",
          },
          {
            name: "Legal Basis for Processing",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No legal basis is stated for any processing activity. GDPR Article 13(1)(c) requires the controller to specify the legal basis (consent, contract, legitimate interest, etc.) for each purpose.",
          },
          {
            name: "Purpose of Data Processing",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not describe the specific purposes for which personal data is processed. This is a fundamental requirement under GDPR Article 13(1)(c).",
          },
          {
            name: "Data Subject Rights",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No information is provided about the data subject's rights (access, rectification, erasure, restriction, portability, objection) as required by GDPR Articles 15-22 and Article 13(2)(b).",
          },
          {
            name: "Right to Lodge a Complaint",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not inform users of their right to lodge a complaint with a supervisory authority as required by GDPR Article 13(2)(d).",
          },
          {
            name: "Data Protection Officer Contact",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No DPO contact details are provided. If a DPO is appointed, their contact details must be disclosed under GDPR Article 13(1)(b). If no DPO is required, a general data protection contact should still be provided.",
          },
          {
            name: "Data Retention Periods",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No retention periods or criteria for determining retention are specified. GDPR Article 13(2)(a) requires disclosure of the storage period or the criteria used to determine it.",
          },
          {
            name: "International Data Transfers",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not address whether personal data is transferred to third countries or international organisations. GDPR Article 13(1)(f) requires disclosure of such transfers and the safeguards applied.",
          },
        ],
      },
      {
        id: "tier2",
        name: "Tier 2 - High",
        severity: "high" as const,
        percentage: 0,
        maxPoints: 25,
        earnedPoints: 0,
        criteria: [
          {
            name: "Categories of Personal Data",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not list the categories of personal data collected (e.g., name, email, IP address, cookies). Transparency requires users understand what data is collected.",
          },
          {
            name: "Recipients or Categories of Recipients",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No recipients or categories of recipients of personal data are disclosed. GDPR Article 13(1)(e) requires this information.",
          },
          {
            name: "Automated Decision-Making & Profiling",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not address the existence of automated decision-making, including profiling (GDPR Article 13(2)(f)). If profiling occurs, meaningful information about the logic involved must be provided.",
          },
          {
            name: "Cookie Policy Integration",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No cookie policy is integrated or referenced. A separate or integrated cookie disclosure is expected to cover all cookies, their purposes, vendors, and retention periods.",
          },
          {
            name: "Third-Party Data Sources",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "If personal data is not obtained directly from the data subject, the source must be disclosed under GDPR Article 14(2)(f). The policy does not address this.",
          },
        ],
      },
      {
        id: "tier3",
        name: "Tier 3 - Medium",
        severity: "medium" as const,
        percentage: 0,
        maxPoints: 20,
        earnedPoints: 0,
        criteria: [
          {
            name: "Children's Data Protection",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No provisions for children's data protection are described. If the service is accessible to children, specific consent mechanisms (GDPR Article 8) must be addressed.",
          },
          {
            name: "Data Breach Notification Process",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not describe the data breach notification process. While not strictly required in the privacy policy, best practice is to inform users how they will be notified in case of a breach (GDPR Articles 33-34).",
          },
          {
            name: "Policy Update Mechanism",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No mechanism for notifying users of policy changes is described. Best practice requires informing users how and when policy updates will be communicated.",
          },
          {
            name: "Consent Withdrawal Mechanism",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy does not describe how users can withdraw their consent. GDPR Article 7(3) requires that withdrawal of consent be as easy as giving it, and the policy should explain the process.",
          },
        ],
      },
      {
        id: "tier4",
        name: "Tier 4 - Low",
        severity: "low" as const,
        percentage: 0,
        maxPoints: 15,
        earnedPoints: 0,
        criteria: [
          {
            name: "Plain Language & Accessibility",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "The policy text could not be evaluated for readability. GDPR Article 12(1) requires that information be provided in a concise, transparent, intelligible, and easily accessible form using clear and plain language.",
          },
          {
            name: "Multilingual Availability",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No multilingual version of the privacy policy was detected. If the website serves users in multiple EU languages, providing translated policies is best practice.",
          },
          {
            name: "Last Updated Date",
            score: 0,
            maxScore: 5,
            status: "fail" as const,
            explanation: "No 'last updated' or effective date was found on the privacy policy. Including a visible date helps demonstrate ongoing compliance and transparency.",
          },
        ],
      },
    ],
  },

  // ── Human-Assisted Consent Analysis ───────────────────────
  humanAssisted: {
    afterReject: { cookies: 2, trackingRequests: 0 },
    afterAccept: { cookies: 5, trackingRequests: 0 },
    newAfterAccept: 3,
    cookiesAfterAccept: [
      { name: "_gcl_au", domain: ".craftpolicy.com", category: "Marketing" },
      { name: "_ga", domain: ".craftpolicy.com", category: "Analytics" },
      { name: "_ga_CYHKV5PQJZ", domain: ".craftpolicy.com", category: "Analytics" },
    ],
  },

  // ── Risk Assessment Breakdown ─────────────────────────────
  riskBreakdown: [
    {
      category: "Tracking Before Consent",
      percentage: 100,
      severity: "critical" as const,
      description: "19 tracking requests detected before user consent — maximum risk exposure",
    },
    {
      category: "Cookie Banner Compliance",
      percentage: 88,
      severity: "critical" as const,
      description: "1 banner design / UX violation (noyb checklist) — missing reject button",
    },
    {
      category: "Privacy Policy Completeness",
      percentage: 0,
      severity: "high" as const,
      description: "0 GDPR criteria evaluated — policy appears missing or inaccessible",
    },
    {
      category: "Cookie Declaration Accuracy",
      percentage: 0,
      severity: "high" as const,
      description: "Cookie policy not provided for comparison — 10 cookies undeclared",
    },
  ],
} as const;
