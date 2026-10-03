# Concept 5 — implemented interfaces

Selected reference: the blue / mint concept provided by the owner in the Transport conversation.

User: white mobile surface, destination search, three full-width illustrated sky/royal-blue/mint service cards, five-item navigation with central new-order action, request form, quote, account dialog, order list and status detail sheet.
Captain: white / mint home, request detail sheet with route diagram and real order price, accept / local dismiss, assigned trip stages and completion confirmation, completed-order totals. Active assigned trips remain accessible when available-order display is disabled.

The artwork is an original SVG recreation of the reference's visual direction, not a screenshot of the poster embedded as an application. Light still means pickups; heavy excludes water trucks; home includes gas, sweet water and three water-truck sizes. No passenger transport requirements were added.

Auth boundaries, frontend servers, private API origin, database, administration and URLs are unchanged. No runtime dependencies were added. The duplicated base.css files live inside each independent frontend build context.

Route drawings are explicitly illustrative: GPS, navigation, travel time, phone/chat integration and real payment are not activated by a design update. Names, ratings and paid earnings are not fabricated. Offers show an honest empty state. Captain decline is session-local dismissal because no dispatch/rejection endpoint exists yet.

Checks: existing HTTP isolation / account / persistence suite, independent Docker builds, Chromium and WebKit browser scenarios at mobile sizes, escaped address rendering, login preserving request state, invalidated quotes, failed creation retry, decline without acceptance, acceptance conflict, all trip transitions and delivery confirmation. Public browser verification is GET-only and never creates production test accounts or orders.
