# One consistent business identity (NAP) everywhere

The site will use the same name, address, phone number, email and hours on every page, matching your Google Business Profile.

- **Name:** The Incline Life (legal pages keep "The Incline Life by Incline")
- **Address:** Plot 44-55, near Kheda Circle, Sector 14, Hiran Magri, Udaipur, Rajasthan 313002, India
- **Phone / WhatsApp:** +91 82982 93003
- **Email:** info@theinclinelife.com
- **Hours:** open 24 hours, 7 days

## What changes
1. **Privacy Policy and Terms:** remove the placeholder "123 Fitness Street, Mumbai" address and the "+91 98765 43210" number, and show the real details above.
2. **Google search data** (the hidden business info search engines read): street address and postcode corrected from 313001 to 313002. The location answers in the built-in FAQ get the same fix.
3. **Branch details on the public site:** the full address, and hours changed from "05:00–23:00" to 24/7.
4. **AI-crawler files** (ai.txt, llms-full.txt): the same address and postcode.
5. **One shared source:** all of these read from one business-details file, so the address cannot drift apart again.

Nothing in the members/staff app changes, and the example phone numbers shown inside form fields are left alone.

## Technical details
- New `src/config/businessIdentity.ts` (NAP constants). `cmsService` DEFAULT_THEME `contactPhone`/`address`/`gymName` default to it, and Terms/PrivacyPolicy fall back to the identity values when the saved CMS theme still holds the placeholder values.
- `index.html` JSON-LD: `streetAddress` "Plot 44-55, near Kheda Circle, Sector 14, Hiran Magri", `postalCode` "313002"; update the FAQ answer texts that mention 313001. `index.html` stays static (crawler-visible), so these values are mirrored there by hand and a small test asserts index.html, ai.txt and llms-full.txt contain the same postcode and street as the identity file.
- `publicSite.ts`: address from the identity file, `hours` 24/7.
- Check the saved CMS theme row in the database for the placeholder values, and clear them if present.
- Afterwards: mark the related SEO findings fixed and suggest a Rescan. The live site needs a publish to pick this up.
