# Booking service dock assets

The booking screen follows the second selected October 5, 2026 design: Arabic RTL search, a live map and a white service dock with illustrated vehicle choices.

- Vehicle photos and the Wasil wordmark were generated specifically for this interface from the selected reference. WebP assets include alpha transparency and are served from the user app only.
- Icons: Tabler Icons 3.35.0, MIT; vendored unchanged shape markup in `apps/user/public/icons.js`. License: `docs/licenses/tabler-icons-MIT.txt`.
- Font: Tajawal, regular/medium/bold/extra-bold, SIL Open Font License; local font files avoid third-party font requests. License: `docs/licenses/tajawal-OFL.txt`.

Main categories stay visible before locations are set. Changing category replaces only the service choices, retaining the map, pins, addresses and each category's most recently chosen vehicle. All home services remain separate catalog entries, including the three water tanker sizes. Light vehicles expose small, medium (existing pickup-d ID), large and standard. Standard uses the same existing small-pickup demo tariff; pricing remains explicitly experimental in the quote, and nothing is charged.
