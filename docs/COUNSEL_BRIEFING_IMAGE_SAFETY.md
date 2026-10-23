# Counsel briefing — Suuqiye listing photo safety

Prepared 2026-10-17 from `docs/IMAGE_SAFETY.md` (§3, §5, §7, §10). **This is a fact-and-question briefing, not legal advice. It takes no position on whether Suuqiye is covered by, or exempt from, any law.** Nothing described here is live: the photo-scan feature is built locally, not deployed, not billed, and enforcement is OFF.

## 0. Context for counsel

Suuqiye is a classifieds marketplace (mobile app and web) where sellers upload listing photos. Operator and users are based in or near Ethiopia/Somalia; infrastructure providers are Cloudflare (storage, Workers), Supabase (database/auth) and, if approved, Google Cloud Vision (general image screening). Details of the operator entity, hosting regions and user geography should be supplied by the owner; they are not recorded in the repository.

**Current design that raises the questions below**
- A planned server-side scan would send each uploaded photo to Google Cloud Vision (labels, SafeSearch, OCR) before publication. SafeSearch is **not** CSAM detection and the system claims no CSAM protection.
- The current, **undeployed** Worker pipeline code **deletes the private original immediately** when a rejected photo carries either the `prohibited_content` issue (SafeSearch adult/violence very-likely) or the `weapon` issue (confident weapon detection). **There is no separate suspected-CSAM branch in this code**; if suspected CSAM were classified into either issue, the original could be deleted. Nothing yet separates ordinary policy rejects from suspected illegal material.
- Implementation status: this behaviour exists in code and is unit-tested with fake storage only. The Worker is not deployed, migration 0048 is not applied, enforcement is OFF and the scan URL is not configured (per checks already performed). No suspected-CSAM material has been stored or deleted by this system. **Production storage, actual access controls, log handling and real-world retention have not been verified because the system is not deployed.**
- Defaults: `purge_scan_evidence()` exists in the unapplied migration 0048 with a 30-day default (`evidence_retention_days`); nothing schedules it, so no purge is active.
- Missing today: a CSAM detection provider, a quarantine state, an escalation role/runbook, a reporting workflow.
- Policy already adopted: no illegal imagery is collected, generated, stored or circulated for testing; suspicious uploads are not published; production launch of the public photo pipeline is gated on counsel sign-off.

## 1. Statutory text read (secondary source — counsel to confirm against official text)

Source: [Cornell LII, 18 U.S.C. § 2258A](https://www.law.cornell.edu/uscode/text/18/2258A), read 2026-10-17. This is a **secondary reproduction** of the U.S. Code, summarised here rather than quoted in full. Counsel should work from the official U.S. Code / Statutes at Large. Paragraph references below follow that source and its amendment notes.

| Topic | What the source says (summary) |
|---|---|
| Mandatory reporting, § 2258A(a) | A "provider" that obtains **actual knowledge** of facts or circumstances showing an apparent violation of listed federal child-exploitation statutes (including 18 U.S.C. §§ 2251, 2251A, 2252, 2252A, 2252B, 2260; § 1591 involving a minor; § 2422(b)) must, **as soon as reasonably possible**, give NCMEC its contact information and report to the CyberTipline. |
| Discretionary reporting and contents, § 2258A(b) | A provider **may** report planned or imminent violations. Including identifying information, historical and geographic data, visual depictions or the complete communication in a report is **at the provider's option**, where within its custody or control. |
| Preservation, § 2258A(h) per amendment notes | A completed CyberTipline submission is treated as a request to preserve the reported contents for **1 year** (providers may preserve longer voluntarily). Preservation is to follow the NIST Cybersecurity Framework within a stated period after enactment of those paragraphs. |
| Penalties, § 2258A(e) | Knowing and willful failure to report: up to $600,000 (first) / $850,000 (subsequent) for providers with fewer than 100,000,000 monthly active users; $850,000 / $1,000,000 at or above that. |
| Amendment history per the source's notes | Pub. L. 118-59 (REPORT Act, May 7, 2024): 90 days → 1 year; added NIST-related paragraphs; raised penalties. Pub. L. 115-395 (2018): earlier 90-day period. Pub. L. 119-60 listed (see §2). |

## 2. Unverified claims and interpretations

These must not be relied on until counsel or primary sources confirm them.

1. **Applicability to Suuqiye.** Whether Suuqiye is a "provider" within the statute's definitions, whether the U.S. statute reaches a non-U.S. operator and non-U.S. users, and what "actual knowledge" would mean for an automated scan or staff review. *Not assessed.*
2. **Pub. L. 119-60** (div. H, title LXXXII, § 8202(i), Dec. 18, 2025). The Code's source notes list it as amending § 2258A. Only secondary annotations were found; one reports it added the words "and all supplemental data included in the report" to an introductory clause. **Primary text not read; content unverified.** Whether any later enactment changed § 2258A was not checked.
3. **Paragraph numbering** of the preservation and NIST provisions beyond what the source's amendment notes state.
4. **Relationship between preservation and deletion.** The current, undeployed Worker code deletes the private original of rejected photos flagged `prohibited_content` or `weapon`, with no separate suspected-CSAM branch; actual production behaviour has not been verified. Whether this deletion is legally acceptable, even for ordinary policy rejects, is a question for counsel, not an established policy decision. Whether and when deletion of material that may be apparent CSAM is permitted, required or prohibited is unassessed.
5. **Detection providers** (all from third-party summaries; no vendor documentation read, no enquiry made):
   - Microsoft PhotoDNA Cloud Service — reported free to vetted organisations; eligibility for Suuqiye unverified.
   - Thorn Safer — reported paid/vetted; pricing and fit unverified.
   - Google Content Safety API / CSAI Match — reported free to qualifying partners; one report of a declined applicant; eligibility unverified.
   - Cloudflare CSAM Scanning Tool — reported to scan served/cached content; treated as **unsuitable as a pre-publication gate** unless Cloudflare documentation shows otherwise.
   - None is confirmed as suitable, available to an Ethiopia-based business, or able to act before publication.
6. **Technical assumptions** (staging-only checks, not legal): Cloudflare private-bucket and Images-binding behaviour, EXIF stripping, Vision model performance, false-negative rates. Hash matching finds only known material; classifiers miss and over-flag; residual risk is non-zero for any option.
7. **Google Vision pricing** was read from the official page but not reconciled in a billing console (cost, not a legal point).

## 3. Questions for counsel

**A. Legal coverage and jurisdiction (register decision 1)**
1. Is Suuqiye, as an Ethiopia-based operator of a marketplace with user-uploaded photos, a "provider" under 18 U.S.C. § 2258A or any other law imposing reporting or preservation duties? Does the answer depend on U.S. users, U.S.-based infrastructure (Cloudflare, Supabase, Google) or other nexus?
2. Which Ethiopian, Somali (if users or content are there), U.S., EU/UK or other laws on child sexual abuse material, reporting, data protection and evidence handling apply to the operator, its staff and its providers?
3. Do any of those laws create duties to report to a local authority or hotline, and does reporting to NCMEC satisfy, conflict with, or sit alongside them?

**B. Reporting obligations (register decision 4)**
4. What is the trigger (knowledge standard) for each applicable duty, and how does it apply to automated flags versus human review? Does a classifier flag alone create knowledge?
5. Who must report, to whom, by what deadline, and with what content? Which report contents are optional under the statute and which should we include or exclude?
6. Who should be the designated, trained person, and what training, supervision and staff-welfare measures are expected?
7. What may the seller be told? Current intent: a generic notice only, with no accusation and no reference to suspected illegal content. Is that lawful and prudent, including any tipping-off concerns?

**C. Preservation, quarantine and deletion (register decisions 2 and 5)**
8. For material that may be apparent CSAM, what must be preserved, for how long, in what form, and under what security and audit standards? Does the NIST-related requirement apply to us and what does compliance involve?
9. May we, must we, or must we not delete such material? Please advise on a rule that **separates** ordinary policy rejects (where immediate deletion may remain appropriate) from suspected illegal material, rather than a blanket preserve-everything or delete-everything rule.
10. Who may view quarantined material, under what authorisation and logging? How do we avoid staff viewing beyond what is legally necessary?
11. What retention periods and access rules should override the 30-day default for flagged items, and what is the lawful basis and deletion trigger at the end?
12. Is the existing evidence trail (audit log, hashes, scan records) itself personal data or sensitive evidence needing special handling?

**D. Detection providers and data transfer (register decisions 3 and 6)**
13. What are the legal and privacy implications of sending user photos to Google Cloud Vision, and of sending potentially illegal material to any third-party screening provider, including cross-border transfer and each provider's retention? What must the privacy policy and data-processing terms say?
14. What are the legal constraints and risks of onboarding with each provider listed in §2, including a vendor's own reporting obligations and our responsibilities when a provider returns a match?
15. If no pre-publication CSAM option is available to us, is launching the general scan acceptable with other controls, or must publication of user photos wait?

**E. Operations and approvals (register decision 7)**
16. What happens to the listing and the seller's account on a suspected-illegal hit (hold, suspend, ban, notify), and what appeal or review right applies?
17. How may we test the pipeline without handling illegal material? Current rule: vendor-supplied test mechanisms or mocks only. Is that sufficient?
18. What contractual and regulatory sign-off do you require before any vendor application, paid service, staging migration or production launch? These remain behind the owner's explicit per-step approval.

## 4. Source and change-control notes

- Facts about the system come from `docs/IMAGE_SAFETY.md`; the nine open decisions are in its §10 and are unchanged by this briefing.
- No vendor was contacted, no service enabled, no cost incurred, no migration applied, nothing deployed, no application code changed. Enforcement and the scan URL remain OFF.
