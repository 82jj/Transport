# Selected booking design QA

final result: passed

## Target and evidence

- Target: the **second displayed** design selected by the user on 2026-10-05, with navy category tabs, realistic white vehicles, blue selection state, map and a white service dock.
- Original reference: `/workspace/scratch/4712e504332e/generated_images/exec-9c8904fc-3da8-426e-a815-cf9dd93e12cc.png` (853 × 1844). The reference is also included in the left side of the committed comparison images.
- Browser-rendered implementation: [final mobile capture](docs/qa/booking-final.jpg), [full comparison](docs/qa/comparison-final.webp), [selector detail comparison](docs/qa/selector-comparison.webp).
- CSS viewport: 390 × 844, light theme, Arabic RTL, device scale 1. The cloud browser used an isolated same-origin preview frame. Its 1363 × 936 browser capture was cropped to the measured frame; the reference was normalized to 390 × 844 before comparison. Final document width/height/scroll-height: 390/844/844.
- State: heavy category, flatbed selected, both locations selected. The source shows an open suggestions list; the implementation correctly dismisses it after a selection. Suggestions were separately opened, clicked and verified above the map.
- The preview uses real Google map imagery with **explicitly labeled fixed test data** for search/coordinates/route. This is visual evidence, not a new claim of live Google Places or routing verification. Production map modules continue using the configured provider.

## Findings and iteration history

- Resolved P2: the first measured layout let the map consume too much height, pushing the primary action toward the fixed navigation. Reduced the responsive map height and placed the optional accompaniment disclosure in the dock heading. The action is fully visible above navigation.
- Resolved P2: the [earlier comparison](docs/qa/comparison-before.webp) shows a persistent scrollbar reducing the usable width to 375 px. The page was 2 px taller than the 844 px viewport. Adjusted the map allowance by 4 px; the final measured document is exactly 390 × 844 with no horizontal or vertical overflow in the completed-location state.
- Resolved P2: categories with more than three subtypes needed a discoverability cue. Their carousel now reveals part of the next card and says “اسحب للمزيد”; all four pickup choices and all five home services remain independently selectable.
- Resolved functional preview issue: insecure local HTTP did not expose `crypto.randomUUID`. Search tokens now use cryptographic `getRandomValues` when UUID is unavailable; production HTTPS retains UUID behavior.
- No unresolved P0/P1/P2 visual findings.

## Required fidelity surfaces

- **Typography:** local Tajawal regular/medium/bold/extra-bold; legible 16 px editable text, 15–16 px service labels and strong navy headings. Arabic shaping, right alignment, focus states and labels are intact. Small navigation and helper text remain subordinate.
- **Spacing/layout:** search fields above the map; full-width map; rounded white dock; three main category tabs; three heavy vehicle cards; full-width primary action and fixed five-item navigation. Compared the full viewport and a separate selector crop. Long addresses remain editable rather than expanding the layout; extra subtype choices scroll horizontally.
- **Colors/tokens:** white/light slate surfaces, navy `#083775` selected category and blue `#0875ff` selection/CTA. Restrained borders and limited shadows match the selected direction.
- **Images/icons:** individually generated, transparent photoreal miniature vehicles with consistent white/gray palette and left-facing three-quarter view; no CSS drawings substitute for vehicle art. All images loaded successfully. The Wasil wordmark follows the source; navigation and UI controls use vendored Tabler icon geometry.
- **Copy/content:** the main CTA is “متابعة”; subtype choices are specific vehicles/services and submit their catalog IDs. Experimental pricing remains clearly identified in the quote. The existing optional “لن أتواجد مع الكابتن” control remains available without dominating the primary screen.

## Interaction and regression evidence

- Cloud-browser checks: heavy/flatbed selection, all main category switches, standard pickup and large water tanker selection, horizontal reveal of extra choices, optional accompaniment disclosure, location suggestions above the map, selecting both locations, persistent vehicle choice and pin rendering.
- Console inspection identified the local HTTP token issue and confirmed no further application TypeErrors after its fix. Browser-extension metadata errors are unrelated to the app.
- Initial CI run `37263350207` passed all 26 Node tests, isolated Docker builds, and all booking/map/order regression scenarios in **both Chromium and WebKit**, including all 12 subtype choices, correct quote IDs, category memory, stable map identity, GPS and long-press pins. The separate onboarding browser test still used the old CTA label; its selector was updated to “متابعة” for the final rerun.
- No live accounts, orders or captain location updates were created during design QA.

## Accepted differences / follow-up polish

- Google controls, map labels, map extent and pin shapes reflect the existing real map integration. The source's invented map artwork and route are not rasterized into the application.
- The completed selection state hides suggestions, and retains the real route-status text. Opening suggestions naturally changes the map's available height.
- P3: exact vehicle body details and small icon strokes differ slightly from the generated mock; vehicle category, rendering style, scale and selection treatment are consistent.

Implementation checklist: visual comparison complete; core interactions exercised; source fixes and updated browser selector ready for final CI.
